## Context

Phase 5 (`overnight-maintenance`, shipped 2026-04-23) created the `discovery` substrate and the passive description-graph feeder. The three tables (`discovery_candidates`, `discovery_rejections`, `nightly_runs`), the single legal mutation path `src/lib/discovery/candidates.ts#proposeCandidate`, and the scoring/scan pipeline all exist and are populating via the nightly launchd agent.

What phase 5 explicitly left out: any user-facing reader. `discovery_candidates` rows accumulate unread. Phase 5's own spec listed "V1 has no active discovery surface" as an ADDED requirement to `discovery`; phase 6 replaces that requirement with the inverse.

The user (single operator) has asked for this surface now that the substrate is warm. They've also confirmed the nightly is installed under launchd and will start emitting real candidate rows overnight.

The umbrella (`openspec/changes/consumption-first/proposal.md`) described phase 6 at the bullet level. `cleanup-inventory.md` §2c enumerates the expected files, §3 enumerates the expected API routes. This design fills in the architectural choices left open by those bullets.

Stakeholders: single user + the curation agent. No multi-tenant concerns, no auth, no rate-limiting beyond the Data API's own daily quota.

## Goals / Non-Goals

**Goals:**

- Active half of `discovery`: an agent-initiated `search_youtube` tool plus a user-gated approval surface on `/inbox`.
- Preserve phase 5's single-legal-mutation-path contract: every write to `discovery_candidates` goes through `proposeCandidate`. The new agent tool `propose_import` is a thin wrapper, not a parallel writer.
- Graceful degrade when `YOUTUBE_API_KEY` is absent: `search_youtube` surfaces a tool-error; the rest of the app — including description-graph + approve/dismiss of existing candidates — is unaffected.
- Same anti-algorithm stance as the rest of Folio: no recommender, no infinite scroll, no auto-approve. Every new corpus entry is a click.
- Approve flow reuses existing YouTube import helpers (`importVideos`, `upsertChannel`) — no new ingestion code.

**Non-Goals:**

- No thumbnail/metadata hydration pre-approval. We show what the Data API returns; full metadata arrives on approve via the existing import path.
- No auto-approve-above-threshold. Score is information, not authorization.
- No retention policy for `discovery_candidates` that stay `proposed` indefinitely. One user; add prune verbs later if the rail gets cluttered.
- No `/inbox` redesign beyond adding the Proposed rail at the top. Existing triage UI is untouched.
- No replacement of `/settings/youtube`. OAuth library import stays as-is; active search is additive.
- No new launchd job. Phase 6 is strictly on-demand.
- No search-result caching table. One user, cheap quota, transient queries.
- No agent autonomy for `search_youtube` — the model must not call it without an explicit user ask.

## Decisions

### 1. `search_youtube` hits the Data API directly; no Folio-side cache

**Decision.** The `src/lib/discovery/search.ts` wrapper calls YouTube Data API v3 `search.list` on every invocation. No cache table, no query-keyed memoization.

**Why not** a cache table? Because this is a single-user tool with a 100-searches/day free quota. Caching saves nothing the user cares about and introduces a new staleness failure mode. If quota ever becomes a problem (it won't), add a cache then.

**Why not** memoize in-process? `src/lib/agent/run.ts` is request-scoped in Next.js 16's RSC/route environment; in-process caching buys nothing beyond the life of a single message turn. Not worth the code.

### 2. `propose_import` is a tool over `proposeCandidate`, not a parallel writer

**Decision.** The agent's `propose_import` tool in `src/lib/agent/tools.ts` delegates directly to `proposeCandidate(...)` from phase 5, with `sourceKind = 'description_link'` when the target came from `search_youtube` (no other sourceKind fits cleanly — this is a search result, not a description link, but the enum is CHECK-constrained and we refuse to re-migrate for a cosmetic fix).

**Alternative considered:** extend the `source_kind` CHECK constraint to add `'active_search'`. Rejected: one-use enum values are migration cost for zero behaviour change. The `sourceVideoId` foreign key is satisfied by passing the current-conversation-context video id if known, else a sentinel (see Decision 8).

**Why not** let the agent write candidates directly via raw SQL? Because the phase 5 invariant ("`src/lib/discovery/candidates.ts` is the single legal mutation path") would become a lie. Wrapping via tool call is the cheap, correct choice.

### 3. Dismissed-then-re-surfaced: `search_youtube` results silently drop dismissed targets

**Decision.** `propose_import` calls `isAlreadyKnown(targetId, kind)` as its first step (phase 5 already has this helper, and it already checks `discovery_rejections`). If the target is known, `propose_import` returns `{ proposed: false, reason: 'already_known' }` and the agent can relay that to the user.

**Why not** bypass the check when the agent explicitly says "re-propose"? Because re-proposing a dismissed candidate is exactly the erosion-of-trust pattern phase 5's permanent-rejection decision was designed to prevent. If the user changes their mind, they clear the rejection via `/settings/discovery` (or the DELETE API) — that's a deliberate act, not a side-effect of a search.

**UX wrinkle:** the user searches for a channel they dismissed a week ago and wonders why nothing shows up on the rail. The agent is responsible for surfacing the `already_known` result in the chat transcript, and the RUNBOOK documents the clear-rejections path.

### 4. Approve-channel: register-only, no auto-seeding of uploads

**Decision.** When a `kind='channel'` candidate is approved, the approve handler:

1. Hits the Data API `channels.list` to resolve `@handle` → `UCxxx` if necessary (and to fetch the canonical name + thumbnail for the `channels` row).
2. Inserts the `channels` row via a transaction.
3. Does **not** fetch uploads.
4. Does **not** subscribe the user to the channel on YouTube's side (we have no write scope anyway).
5. The next nightly's step 2 (OAuth `importSubscriptions`) picks up uploads **only if** the user has separately subscribed on YouTube itself.

**Why not** auto-seed the last N uploads on approve? Because that conflates "I want to know about this channel" with "I want to ingest its back-catalog." The user gets to decide the latter by either manually importing, subscribing on YouTube proper, or using `/chat` to search for specific videos.

**Trade-off:** the first approved channel sits empty in the library until the user takes a second action. Accepted — the tension between "no-surprise imports" and "useful on approve" is resolved in favour of no-surprise.

### 5. Approve-video: reuse `importVideos` with `status='saved'`

**Decision.** Approve for `kind='video'` hits the Data API `videos.list` to fetch the full video metadata (matches the `NormalizedYouTubeVideo` shape `importVideos` expects), then calls `importVideos([video], 'like', '', 'saved', counts)` — "like"-style provenance because the user explicitly asked for this.

**Why `like` not a new `discovery_approved` provenance kind?** Because the provenance table's `source_kind` CHECK constraint rejects new values without a migration, and the approve semantics ("user explicitly endorsed this") map cleanly to `like`'s weight of 1.0.

**Alternative considered:** add a new `ProvenanceKind` + migration. Rejected for the same reason as Decision 2 — migration cost with no behavioural win.

### 6. Transactional approve; rollback on any failure

**Decision.** The approve handler wraps `channels`/`videos`/`consumption` upserts + the candidate-row delete in one `db.transaction(...)`. The Data API call happens *before* the transaction opens (network I/O can't sit inside a SQLite transaction); if the API call fails, the candidate row stays `proposed` and the user gets the error in the API response.

**Why not** leave the candidate row as `approved` even if the import fails? Because "approved but not imported" is a permanent ghost state with no cleanup path. Failure → no state change → user retries.

**Race safety:** the candidate row is read inside the transaction and the delete is keyed on `id`. If two approves race on the same id (impossible in a single-user app but cheap to enforce anyway), the second transaction's delete affects 0 rows and the handler returns 404.

### 7. `search_youtube` is strictly user-initiated; the system prompt enforces it

**Decision.** The agent's system prompt (`src/lib/agent/system-prompt.ts`) gains a paragraph: "`search_youtube` performs an outbound YouTube Data API query that counts against a daily quota and reveals the query string to Google. Only call this tool when the user has asked you to find new content. Do not call it to verify metadata, answer a question about an existing video, or 'enrich' a reply." The tool's description field repeats a one-line version of this rule so the model sees it at tool-selection time.

**Why not** rely on the user to catch bad calls? Because even 5 spurious calls/day eats 500 units, and more importantly it sends query strings to Google that the user didn't author. Prompt enforcement is cheap and correct.

**No code-level rate limit.** A runaway model could in principle blow through the daily quota in a single turn; the `AGENT_MAX_TURNS` cap (default 10) is the existing backstop, and the Data API's own 403/quota response is the eventual circuit breaker. If it becomes an issue, add a per-conversation `search_youtube` call count.

### 8. `propose_import` `sourceVideoId`: use the conversation's current context or a sentinel

**Decision.** `discovery_candidates.source_video_id` has `NOT NULL REFERENCES videos(id) ON DELETE CASCADE`. For candidates born from `search_youtube` (not derived from a saved video's description), we do not have a real source video.

Two options considered:

- **(a)** Drop the `NOT NULL` constraint in a new migration and treat `NULL` as "active search origin." Simple, but one more migration.
- **(b)** Synthesize a "search-origin sentinel video" row on first use (`videos.id = '__search_origin__'`, kind 'video', title = 'Active search', channel = internal), so the FK is satisfied without a schema change.

**Decision: (a).** Add migration `018_active_discovery.sql` that makes `discovery_candidates.source_video_id` nullable. A sentinel video would leak into `videos` queries elsewhere (counts, home ranking, /library) and require defensive filters in every reader. A nullable column is one schema migration and zero downstream code churn.

Side-effect: the phase-5 spec's "for each candidate, the source video is …" requirement needs a delta to allow the active-search case. Captured in the discovery spec additions.

### 9. `/inbox` Proposed rail is a new RSC island above existing triage

**Decision.** `src/components/discovery/ProposedRail.tsx` is a server component that reads `discovery_candidates` via a new read helper in `src/lib/discovery/read.ts` (phase 5 did not ship a read helper — writes only). It renders above the existing inbox triage UI and is followed by an `<hr />` separator. When the rail is empty, it renders no DOM (same posture as phase 5's `SinceLastVisit`).

The per-card approve/dismiss buttons post to the new API routes via `<form action="...">` + Server Actions (Next.js 16 canonical path) or via client-side `fetch` — lean towards Server Actions since the rail is server-rendered and this is the idiomatic flow.

**Why not** fold the Proposed rail into `RightNowRail` on `/`? Because `/` is the consumption-home surface — "what should I watch right now?" — and candidates that are not yet in the corpus don't belong there. `/inbox` is about pending triage state; unapproved candidates sit cleanly above inbox inbox-state videos.

### 10. `/settings/discovery` is optional but small; ship it with the rest

**Decision.** Ship `/settings/discovery` in the same change. It's a ~50-LOC RSC page that lists the rejection list and offers "clear one" + "clear all" buttons. The alternative ("ship rail + API first, settings page later") doubles the RUNBOOK + docs surface area across two changes for minimal cost savings.

### 11. Graceful degrade when `YOUTUBE_API_KEY` is absent

**Decision.** `search_youtube`'s handler checks `process.env.YOUTUBE_API_KEY` and, when absent, returns a tool-error: `{ error: 'YOUTUBE_API_KEY not set. See RUNBOOK "Discovery (active)" for setup.' }`. The agent relays this to the user in plain English.

The `/chat` status API (`GET /api/agent/status`) gains a `youtubeSearchEnabled: boolean` field so the chat UI can surface a subtle disabled-state hint (mirroring the existing `apiKeyPresent` pattern for `ANTHROPIC_API_KEY`).

**No env-var bundling.** `YOUTUBE_API_KEY` is independent of `YOUTUBE_OAUTH_CLIENT_ID` / `..._SECRET`. A user can have one without the other.

## Risks / Trade-offs

- **[Risk] Data API quota exhaustion.** A model loop that repeatedly calls `search_youtube` with variant queries could exhaust 10,000 units (= 100 calls) in a single conversation. **Mitigation:** system-prompt instruction + `AGENT_MAX_TURNS` cap + Data API's own 403 response. If quota becomes a real problem, add a per-conversation call count in `src/lib/agent/run.ts`.

- **[Risk] Orphaned `proposed` rows that the user never triages.** The rail grows unbounded. **Mitigation:** none in this phase — accepted. If the rail gets uncomfortable, add a "prune > N days" verb.

- **[Risk] Data API key accidentally committed.** `YOUTUBE_API_KEY` in `.env.example` is just a blank template; `.env` is already gitignored. **Mitigation:** `.env.example` line is literal `YOUTUBE_API_KEY=` with a comment; commit hooks (if any) would catch a filled-in example.

- **[Risk] Approve flow half-completes on network flake.** Data API `videos.list` succeeds, SQLite transaction fails (or vice versa). **Mitigation:** Data API call is outside the transaction; failure → no state change. SQLite transaction is atomic; partial DB state is impossible.

- **[Risk] Channel handle resolution ambiguity.** `@handle` isn't globally unique over time — Google has rotated handles before. **Mitigation:** approve-channel resolves via `channels.list?forHandle=@xxx`, which returns the current canonical `UCxxx`; we store `UCxxx`, not the handle. A future handle rotation doesn't orphan our row.

- **[Trade-off] No search caching.** Every search is a fresh 100-unit spend. Accepted — one user, free tier.

- **[Trade-off] Reusing `like` provenance for approved videos.** Loses the ability to distinguish "I liked on YouTube" from "I approved via active search." If this ever matters (e.g. for an analytics surface), add a provenance-kind migration then.

- **[Trade-off] Shipping `/settings/discovery` in the same change.** Slightly larger PR; the alternative is a second change just for clear-rejections UI. Chosen size over splitting for cosmetic reasons.

## Migration Plan

1. **Pre-flight.** Confirm phase 5 (`overnight-maintenance`) is archived or at least has `nightly_runs` populating. `YOUTUBE_API_KEY` is optional; absence is supported.

2. **Code + migration land in one PR.**
   - `db/migrations/018_active_discovery.sql` (nullable `discovery_candidates.source_video_id`).
   - `src/lib/discovery/search.ts`, `approve.ts`, `read.ts`.
   - `src/lib/agent/tools.ts` — two new tools; system-prompt update.
   - `src/app/api/discovery/**` — six new routes.
   - `src/components/discovery/{ProposedRail,CandidateCard}.tsx`.
   - `src/app/inbox/page.tsx` — mount the rail above existing triage.
   - `src/app/settings/discovery/page.tsx` — rejection management.
   - `.env.example` + RUNBOOK + `_Last verified:_`.
   - `justfile` stays unchanged (no new verbs needed — active discovery is in-app).

3. **Apply.**
   - `npm run dev` triggers the migration.
   - Obtain `YOUTUBE_API_KEY` via Google Cloud Console; add to `.env.local`.
   - End-to-end smoke:
     1. `/chat` → "search youtube for cast-iron metallurgy channels" → agent calls `search_youtube` → agent calls `propose_import` → `discovery_candidates` grows by ≥1.
     2. `/inbox` → Proposed rail renders the new row → click Approve → row moves to `videos` + `consumption(status=saved)`, rail shrinks by 1.
     3. Repeat search → click Dismiss on a different row → `discovery_rejections` grows by 1, rail shrinks.
     4. `/settings/discovery` → see the rejection → "Clear" → rejection goes away.

4. **Verification.**
   - `sqlite3 events.db "SELECT COUNT(*) FROM discovery_candidates WHERE status='proposed'"` — some count > 0 after a real search.
   - `sqlite3 events.db "SELECT target_id FROM discovery_rejections"` — the one dismissed id.
   - `/inbox` renders without layout regression when the rail is empty.

5. **Rollback.** `git revert`; the migration is `source_video_id` nullability — non-destructive; existing rows have non-null values and are unaffected. Manually `ALTER TABLE ... SET NOT NULL` if desired (SQLite requires rebuild-and-copy; usually not worth it).

## Open Questions

- **Should the agent expose a `clear_rejection(targetId)` tool?** Lean no — dismiss-then-undismiss via chat is too easy to trigger accidentally. The `/settings/discovery` surface keeps it one-step-removed. Revisit if the user asks for it.
- **Does `search_youtube` support channel-scoped search (`search.list?channelId=...`)?** Lean yes — free, and the agent often needs "more from this creator." Include in v1.
- **Should the Proposed rail paginate?** Lean yes, but lazy: cap at 20 rows in the SQL query (`ORDER BY score DESC LIMIT 20`) and move to proper pagination if it starts clipping material. No UI paginator in v1.
- **Does approve log to `import_log` like the OAuth imports do?** Lean yes — reusing `importVideos` means it already does. Verify; if not, add an explicit `openImportLog('active_search', candidateId)` wrapper.
- **Should `propose_import`'s `sourceVideoId` be populated with the `source_videos` the agent was reasoning about (if any), or always `NULL` for search-originated rows?** Design-time answer: always `NULL` for `search_youtube`-sourced candidates (decision 8 rationale). If in the future the agent wants to attribute a search to "this is like X I already saved", the plain free-text `score_breakdown` JSON can carry that note without needing a real FK.
