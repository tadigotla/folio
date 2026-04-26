## 1. Pre-flight

- [x] 1.1 Confirm phase 5 (`overnight-maintenance`) has shipped: `nightly_runs` table present, `discovery_candidates` + `discovery_rejections` tables present. If phase 5 is not archived yet, that is fine — phase 6 can apply on top of the in-flight change — but the three tables MUST exist.
- [ ] 1.2 Run `just backup-db`; record the timestamped path here. The migration is one-column-nullability — additive and reversible, but the invariant stands.
- [ ] 1.3 Obtain a `YOUTUBE_API_KEY` from Google Cloud Console: create a project (or reuse the existing OAuth project), enable the "YouTube Data API v3" under "APIs & Services", create an API key, restrict it to YouTube Data API v3 under "API restrictions". Paste into `.env.local`. The key is distinct from the existing `YOUTUBE_OAUTH_CLIENT_{ID,SECRET}`.
- [ ] 1.4 Confirm `ANTHROPIC_API_KEY` is set (phase 6 surfaces the chat tool, so the agent must be live to exercise it).

## 2. Migration

- [x] 2.1 Create `db/migrations/018_active_discovery.sql` that relaxes `discovery_candidates.source_video_id` from `NOT NULL` to nullable. SQLite requires a rebuild: copy into `discovery_candidates_new` with `source_video_id TEXT REFERENCES videos(id) ON DELETE CASCADE`, copy all rows, drop old, rename new. Re-create all indexes (`idx_discovery_candidates_status`, `idx_discovery_candidates_target`) against the renamed table. Wrap in one `BEGIN/COMMIT`.
- [x] 2.2 Add a top-of-file comment block naming the source change (`active-discovery`), the safety prerequisite (`just backup-db`), and the date.
- [x] 2.3 Dry-run the migration on a copy of `events.db`; confirm: column is nullable (`PRAGMA table_info('discovery_candidates')` shows `notnull = 0` for `source_video_id`), existing rows preserved, indexes present, FK cascade still works (delete a videos row and confirm associated candidate rows are gone).

## 3. Discovery library (`src/lib/discovery/`)

- [x] 3.1 Create `src/lib/discovery/search.ts` exporting `async function searchYoutube({ query, channelId?, maxResults? }): Promise<SearchResult[]>`. Reads `YOUTUBE_API_KEY` from env; throws `YouTubeApiKeyMissingError` when unset. Issues `GET https://www.googleapis.com/youtube/v3/search?part=snippet&type=video,channel&q=...&maxResults=<clamped>` with the key in the query string. Maps the response items to `SearchResult = { kind: 'video'|'channel', target_id: string, title: string, channel_name: string|null }`. Handles both `id.kind = 'youtube#video'` (video_id in `id.videoId`) and `id.kind = 'youtube#channel'` (channel_id in `id.channelId`).
- [x] 3.2 Clamp `maxResults` to `[1, 25]`; default 10. Include a 10-second fetch timeout so a hung Google endpoint doesn't wedge a conversation.
- [x] 3.3 Create `src/lib/discovery/read.ts` exporting `listProposedCandidates({ limit?: number }): CandidateRow[]` (default limit 20; cap 50) and `listRejections(): RejectionRow[]`. Read-only; no caching.
- [x] 3.4 Create `src/lib/discovery/approve.ts` exporting `approveCandidate(candidateId: number): Promise<ApproveResult>`. **Structure:** load candidate row (throw `CandidateNotFoundError` if missing); for `kind='video'` fetch metadata via `fetchVideoMetadata(target_id)` (new helper in `src/lib/youtube-api.ts`); for `kind='channel'` resolve via `fetchChannelByIdOrHandle(target_id)`. Then open `db.transaction(...)`: `upsertChannel`, `upsertVideo` (for video kind only), `INSERT INTO consumption (video_id, status='saved', status_changed_at=NOW())`, `INSERT INTO video_provenance (source_kind='like', ...)`, update candidate row to `status='approved'`, delete candidate row. Return `{ kind, id }` of the created entity.
- [x] 3.5 Approve surfaces typed errors: `CandidateNotFoundError` → HTTP 404; `YouTubeApiKeyMissingError` → HTTP 412; Data API fetch failure → HTTP 502 with the upstream message (truncated). All other errors → HTTP 500.
- [x] 3.6 Create `src/lib/discovery/dismiss.ts` exporting `dismissCandidate(candidateId: number): void`. Wrap in `db.transaction(...)`: `INSERT OR IGNORE INTO discovery_rejections (target_id, kind, dismissed_at)`, update candidate row to `status='dismissed'`, delete candidate row. Throw `CandidateNotFoundError` if the id doesn't resolve.
- [x] 3.7 Create `src/lib/discovery/rejections.ts` exporting `clearRejection(targetId: string)` and `clearAllRejections(): { deleted: number }`. Both go through the single mutation path — no raw SQL in route handlers.

## 4. YouTube Data API helpers (extend `src/lib/youtube-api.ts`)

- [x] 4.1 Extend `src/lib/youtube-api.ts` with a **key-based** (not OAuth) request helper for Data API endpoints that support API keys. Do **NOT** reuse the OAuth bearer-token flow — those endpoints (`search.list`, `videos.list`, `channels.list`) accept API keys. Helper signature: `async function dataApiGet<T>(path: string, params: Record<string,string>): Promise<T>`. Reads `YOUTUBE_API_KEY`; appends as `key=...` query param.
- [x] 4.2 Export `fetchVideoMetadata(videoId: string): Promise<NormalizedYouTubeVideo>` — calls `videos.list?part=snippet,contentDetails&id=<videoId>`; maps to the existing `NormalizedYouTubeVideo` shape used by `importVideos`.
- [x] 4.3 Export `fetchChannelByIdOrHandle(idOrHandle: string): Promise<{ channelId: string; title: string; handle: string|null }>` — when the input starts with `@`, call `channels.list?part=snippet&forHandle=<handle>`; otherwise `channels.list?part=snippet&id=<UCxxx>`. Return the resolved `UCxxx` plus title.
- [x] 4.4 Both helpers MUST throw `YouTubeApiKeyMissingError` when the key is unset. Both MUST return typed errors on 4xx/5xx so callers can map to HTTP status.

## 5. Agent tools (`src/lib/agent/tools.ts` + `system-prompt.ts`)

- [x] 5.1 Register `search_youtube` tool in `src/lib/agent/tools.ts`. Schema: `{ query: string, channel_id?: string, max_results?: number }`. Description: one-line model-facing restatement of the "never auto-call; user-initiated only" rule. Handler: invokes `searchYoutube`; catches `YouTubeApiKeyMissingError` and returns `{ error: 'youtube_api_key_missing', message: 'YOUTUBE_API_KEY not set. See RUNBOOK "Discovery (active)" for setup.' }`.
- [x] 5.2 Register `propose_import` tool. Schema: `{ kind: 'video'|'channel', target_id: string, title?: string, channel_name?: string, source_kind: 'description_link'|'description_handle'|'transcript_link' }`. Handler: invokes `proposeCandidate` from `src/lib/discovery/candidates.ts` with `source_video_id = NULL, score = 0, breakdown = { source: 'active_search' }`. Returns `{ proposed: true, candidate_id }` on insert, `{ proposed: false, reason: 'already_known' }` on duplicate.
- [x] 5.3 Update `src/lib/agent/system-prompt.ts` to add a paragraph describing `search_youtube` + `propose_import`. Spell out: `search_youtube` is user-initiated only; `propose_import` never imports directly; approval is always a user click on `/inbox`.
- [x] 5.4 Add a new snapshot field in `src/lib/agent/snapshot.ts`: `proposedCandidatesCount` (from `listProposedCandidates({ limit: 50 }).length`), so the agent can honestly say "there are already N proposals on /inbox" instead of re-searching. No other snapshot changes.

## 6. API routes (`src/app/api/discovery/`)

- [x] 6.1 `GET /api/discovery/candidates` — returns `listProposedCandidates({ limit: 50 })` as JSON.
- [x] 6.2 `POST /api/discovery/candidates/[id]/approve` — parses `id` as number (400 on NaN), calls `approveCandidate(id)`, maps typed errors to HTTP status per §3.5. Returns `{ kind: 'video'|'channel', id: string }` on success.
- [x] 6.3 `POST /api/discovery/candidates/[id]/dismiss` — parses `id`, calls `dismissCandidate(id)`, returns 204 on success, 404 on `CandidateNotFoundError`.
- [x] 6.4 `GET /api/discovery/rejections` — returns `listRejections()` as JSON.
- [x] 6.5 `DELETE /api/discovery/rejections/[id]` — `id` in the path is the `target_id` (URL-encoded). Calls `clearRejection(decoded_id)`. Returns 204 on hit, 404 on miss.
- [x] 6.6 `DELETE /api/discovery/rejections` — calls `clearAllRejections()`. Returns `{ deleted: number }`.

## 7. UI — Proposed rail on `/inbox`

- [x] 7.1 Create `src/components/discovery/ProposedRail.tsx` — server component. Reads `listProposedCandidates({ limit: 20 })`. Renders `null` when the result is empty (no heading, no wrapper). Otherwise renders a `<section>` with a `Kicker` "Proposed imports" followed by a card list.
- [x] 7.2 Create `src/components/discovery/CandidateCard.tsx` — renders `target_id`, `title || target_id`, `channel_name || ''`, `score.toFixed(2)`, and if `source_video_id` is non-null a small "from: <title of source video>" subtitle with a click-through to `/watch/<sourceVideoId>`. Approve / Dismiss buttons fire `POST /api/discovery/candidates/[id]/approve|dismiss` from a small client island and `router.refresh()` on success — matches the existing `ConsumptionAction` pattern in this codebase rather than the spec's Server Actions wording.
- [x] 7.3 Edit `src/app/inbox/page.tsx`: mount `<ProposedRail />` between the header and the existing thick rule. The rail returns null when empty, so the existing rule continues to act as the header→triage divider in both cases.
- [x] 7.4 Ensure the empty-state of `/inbox` (no proposals AND no inbox-status videos) is not misleading — existing inbox copy should be unchanged.

## 8. UI — `/settings/discovery` rejection management

- [x] 8.1 Create `src/app/settings/discovery/page.tsx` — server component. Reads `listRejections()`. When empty, renders a small italic "Nothing has been dismissed yet." message. When populated, renders a **Clear all** button at the top and a list with per-row `target_id` + `kind` + `relativeTime(dismissed_at)` + **Clear** button.
- [x] 8.2 Clear / Clear-all are wired via small client islands (`DELETE` + `router.refresh()`), matching the codebase's existing pattern instead of the spec's Server Actions wording. Same effect: rail re-renders after a successful POST/DELETE.
- [x] 8.3 Add a nav entry from `/settings` (if a landing page exists; else skip) or link it from `/settings/youtube`'s footer.

## 9. `/chat` status + disabled-card hint

- [x] 9.1 Extend `GET /api/agent/status` to include `youtubeSearchEnabled: boolean` (= `!!process.env.YOUTUBE_API_KEY`). No outbound call; pure env inspection.
- [x] 9.2 Update the `/chat` client UI: when `youtubeSearchEnabled === false` AND `apiKeyPresent === true`, show a one-line muted note under the input: "Active YouTube search is disabled. Set `YOUTUBE_API_KEY` to enable." Link the literal env var to the RUNBOOK section via an anchor (local link to `/settings/discovery` with a tooltip is fine).
- [x] 9.3 Anthropic missing (existing disabled-card state) takes precedence — if no Anthropic key, don't show the YouTube-specific note; the chat card is already disabled.

## 10. Docs + env

- [x] 10.1 Add `YOUTUBE_API_KEY=` to `.env.example` with a comment block explaining: distinct from the OAuth client, needs YouTube Data API v3 enabled, key-restricted to that API, free 10k-unit/day quota = ~100 `search.list` calls.
- [x] 10.2 Update `RUNBOOK.md` — bump `_Last verified:_` to the apply date, format `_Last verified: YYYY-MM-DD (active-discovery: phase 6 — search_youtube + Proposed rail + approve/dismiss)_`.
- [x] 10.3 Add a new RUNBOOK section "Discovery (active)" covering: Google Cloud setup walkthrough (project, API enable, key create, restriction), the `YOUTUBE_API_KEY` env var, quota arithmetic, how the agent uses it (user-initiated only), and how to clear the rejection list (`/settings/discovery` or `sqlite3 events.db "DELETE FROM discovery_rejections WHERE target_id='<id>'"`).
- [x] 10.4 Update the existing RUNBOOK "Discovery candidates (substrate)" section (introduced by phase 5) to cross-reference the new active surfaces.
- [x] 10.5 Update `CLAUDE.md`'s "Overnight maintenance" / "Discovery" architecture paragraph to describe the phase-6 additions (`src/lib/discovery/{search,approve,dismiss,read,rejections}.ts`, the six new API routes, the Proposed rail, the two new agent tools).
- [x] 10.6 Confirm the operational invariant: `justfile` unchanged by this change (no new verbs) AND `RUNBOOK.md` updated AND `.env.example` updated AND `_Last verified:_` bumped — all in the same commit. (The pre-existing `justfile` modification on the working tree is from the in-flight `agent-hardening` change, not phase 6.)

## 11. Verification

- [ ] 11.1 Apply the migration via `npm run dev` startup. Confirm `_migrations` has a new row for `018_active_discovery.sql`; `PRAGMA table_info('discovery_candidates')` shows `source_video_id` with `notnull = 0`.  _(Dry-run on a copy of `events.db` already verified the structural change in §2.3; the live `_migrations` row will land on the next `npm run dev`.)_
- [x] 11.2 `npm run build` clean. `npm run lint` clean.
- [ ] 11.3 **End-to-end search → propose → rail**: from `/chat`, ask "search youtube for cast-iron metallurgy, one or two results." Confirm: agent calls `search_youtube` then `propose_import` once or twice; `sqlite3 events.db "SELECT target_id, score, status FROM discovery_candidates WHERE status='proposed' ORDER BY proposed_at DESC LIMIT 5"` shows the new rows with `source_video_id = NULL`.
- [ ] 11.4 **End-to-end approve**: navigate to `/inbox`, confirm the Proposed rail renders the new candidates. Click Approve on one. Confirm: the row is gone from `discovery_candidates`; a new `videos` row exists with that `target_id`; `consumption.status = 'saved'`; a `video_provenance` row with `source_kind = 'like'`. Navigate to `/library` and confirm the video appears in the Saved section.
- [ ] 11.5 **End-to-end dismiss**: click Dismiss on another proposed candidate. Confirm: the candidate is gone; `discovery_rejections` gains a row with the `target_id`.
- [ ] 11.6 **Rejection-list round-trip via `/settings/discovery`**: navigate to `/settings/discovery`, confirm the dismissed target appears. Click **Clear**. Confirm: the row is gone from `discovery_rejections`. Dismiss another candidate, then **Clear all**. Confirm: `discovery_rejections` is empty.
- [ ] 11.7 **Graceful degrade**: temporarily unset `YOUTUBE_API_KEY`, restart `next dev`, try a `search_youtube` from `/chat`. Confirm: the tool returns `{ error: 'youtube_api_key_missing', ... }`; the agent relays a human-readable message; no outbound call to `googleapis.com` was issued (observable via devtools network tab or by the absence of quota use).
- [ ] 11.8 **`/api/agent/status` reports correctly**: with key set → `{ youtubeSearchEnabled: true, ... }`; without → `false`.
- [ ] 11.9 **Approve flow survives Data API failure**: temporarily set `YOUTUBE_API_KEY` to an invalid value, click Approve. Confirm: endpoint returns 502; candidate row still exists with `status = 'proposed'`; no `videos`/`channels` rows created. Restore the key.
- [ ] 11.10 **Description-graph path unaffected**: confirm the nightly still populates `discovery_candidates` with non-NULL `source_video_id` via `sqlite3 events.db "SELECT COUNT(*) FROM discovery_candidates WHERE source_video_id IS NOT NULL AND status = 'proposed'"` > 0 after the next nightly run (or a manual `just nightly`).
- [ ] 11.11 **Anti-auto-search check**: from `/chat`, ask a factual question about an existing corpus video ("when was that slow cinema video published?"). Confirm via tool-call transcript that the agent used `search_pool`/`get_video_detail` — NOT `search_youtube`. This is a soft check against the model; if the model strays, tighten the system prompt.

## 12. Archive

- [ ] 12.1 Move `openspec/changes/active-discovery/` to `openspec/changes/archive/YYYY-MM-DD-active-discovery/`.
- [ ] 12.2 Update `openspec/changes/consumption-first/cleanup-inventory.md`: mark phase 6 done; update the header `_Last completed:_` line.
- [ ] 12.3 Archive the `consumption-first/` umbrella itself (all six phases shipped). Move to `openspec/changes/archive/YYYY-MM-DD-consumption-first/`. Note in the commit message that the umbrella is done and the consumption-first arc is closed.
- [ ] 12.4 Commit message mentions: `search_youtube` + `propose_import` agent tools; Proposed rail on `/inbox`; approve/dismiss API + `/settings/discovery` UI; `YOUTUBE_API_KEY` graceful-degrade; explicit non-goals (no pre-approval metadata, no auto-approve, no new mutation path for candidates).
