## Why

Phase 5 (`overnight-maintenance`, just shipped) stood up the `discovery` substrate: `discovery_candidates` + `discovery_rejections`, a single legal mutation path (`src/lib/discovery/candidates.ts#proposeCandidate`), and the nightly description-graph scan that stages passive candidates from saved-video descriptions + transcripts. But the substrate has no reader — nothing in the app surfaces what the nightly finds, and the user has no way to bring in content that isn't already connected to the corpus. Phase 6 of the `consumption-first` umbrella closes that half: an agent-initiated active-search tool, a "Proposed" rail on `/inbox`, and approve/dismiss endpoints. Once phase 6 ships, `discovery` is end-to-end: passive feeder (description-graph, phase 5) + active feeder (agent `search_youtube`, phase 6) → same candidate substrate → one user-gated approval surface → new content in the corpus.

## What Changes

Pulled from `openspec/changes/consumption-first/proposal.md` (umbrella phase 6) and `cleanup-inventory.md` (§2c and §3).

- **NEW agent tool `search_youtube(query: string, maxResults?: number)`** wrapping YouTube Data API v3 `search.list`. Strictly user-initiated from `/chat`; never auto-called. Returns a normalized list the agent can hand to `propose_import` to stage rows in `discovery_candidates`.
- **NEW agent tool `propose_import({ kind, targetId, title?, channelName?, sourceKind })`** — thin wrapper over `proposeCandidate`. Phase 6 adds this tool, not a parallel mutation path; the single-legal-mutation-path contract phase 5 established is preserved.
- **MODIFIED agent system prompt + tool set** — adds the two new tools, documents the "never auto-search" rule (the model must not call `search_youtube` without an explicit user ask).
- **NEW `/inbox` "Proposed" rail** at the top of the page, above existing triage. Reads `discovery_candidates WHERE status='proposed'` ordered by `score DESC`. Each card renders `target_id`, title, channel name, score, source video (click-through to watch), and approve + dismiss buttons. No thumbnail fetch pre-approval (lazy — metadata arrives on approve via the existing YouTube import path).
- **NEW `POST /api/discovery/candidates/[id]/approve`** — in one transaction: flip `status` to `'approved'`; call the existing YouTube import path to create `videos`/`channels`/`consumption` rows with `status='saved'`; delete the candidate row. Rolls back entirely on any step failure.
- **NEW `POST /api/discovery/candidates/[id]/dismiss`** — in one transaction: flip `status` to `'dismissed'`; insert a `discovery_rejections` row for the `target_id`; delete the candidate row. Future description-graph + `search_youtube` results skip anything in the rejection list (enforced by the existing `isAlreadyKnown`).
- **NEW `GET /api/discovery/candidates`** — list `proposed` rows. Thin wrapper the rail calls.
- **NEW `GET /api/discovery/rejections`** — list rejections.
- **NEW `DELETE /api/discovery/rejections/[id]`** — clear one rejection (e.g. the user changes their mind about a channel).
- **NEW `DELETE /api/discovery/rejections`** — clear all. Backs the `/settings/discovery` affordance.
- **NEW optional `/settings/discovery` page** — shows the rejection list with a "clear all" button and per-row clear. Low-priority; may ship behind the rail + API routes.
- **NEW env var `YOUTUBE_API_KEY`** — distinct from the existing OAuth client. Google Cloud project with YouTube Data API v3 enabled; key restricted to that API. Free-tier quota 10,000 units/day; `search.list` costs 100 units/call ≈ ~100 searches/day (plenty for one user). Graceful degrade: if unset, `search_youtube` returns a tool-error; passive description-graph half is unaffected.
- **NEW `/chat` status hint** — when `YOUTUBE_API_KEY` is unset, the agent card surfaces a subtle "active search disabled — set `YOUTUBE_API_KEY` to enable" note, mirroring the existing `ANTHROPIC_API_KEY` disabled-card posture.
- **MODIFIED RUNBOOK + env docs** — `.env.example` gains `YOUTUBE_API_KEY`; RUNBOOK gains a "Discovery (active)" section covering the Google Cloud setup, API key restriction, quota arithmetic, and how to clear the rejection list. `_Last verified:_` bumps to the apply date.

### Explicit non-goals

- **No thumbnail / metadata enrichment of candidates pre-approval.** `target_id` + title + channel name is enough to decide; full metadata arrives on approve via the existing import path.
- **No auto-approve-if-score-high-enough.** Every import remains a deliberate click.
- **No new mutation paths for `discovery_candidates`.** `proposeCandidate` stays the single legal writer.
- **No description-graph changes** — it shipped in phase 5.
- **No retention / pruning policy** for rows that stay `proposed` forever. One user; we can add prune verbs later if the list balloons.
- **No deprecation of `/settings/youtube`.** OAuth library import stays as-is; active search is additive.
- **No new launchd job.** Phase 5's nightly continues to run description-graph; phase 6 is strictly on-demand.

## Capabilities

### New Capabilities

_(none — phase 6 extends the `discovery` capability that phase 5 introduced, and extends `curation-agent` with new tools. No net-new capability names.)_

### Modified Capabilities

- `discovery`: adds ADDED requirements for the active surfaces — `search_youtube` integration, Proposed-rail read path, approve/dismiss/rejection-management API contracts, and `YOUTUBE_API_KEY` graceful-degrade. Phase 5 shipped the substrate + description-graph writer + explicit "v1 has no active surface"; phase 6 replaces that "v1" boundary with the active reader half.
- `curation-agent`: adds ADDED requirements for the two new tools (`search_youtube`, `propose_import`) + the "never auto-search" model-behaviour contract + the disabled-state surface when `YOUTUBE_API_KEY` is unset. Existing tool-set requirements carry over unchanged.

## Impact

- **Code added (~800 LOC):** `src/lib/discovery/search.ts` (YouTube Data API wrapper + normalized result shape), `src/lib/discovery/approve.ts` (transactional approve flow reusing `importVideos` / `upsertChannel`), `src/lib/agent/tools.ts` (two new tool schemas + handlers), updates to `src/lib/agent/system-prompt.ts`, RSC page + client island for the Proposed rail (`src/components/discovery/ProposedRail.tsx`, `CandidateCard.tsx`), six new API routes under `src/app/api/discovery/**`, optional `src/app/settings/discovery/page.tsx`.
- **Database:** no schema changes. Phase 5's `discovery_candidates` and `discovery_rejections` tables are used as-is.
- **External services:** one new outbound surface — YouTube Data API v3 `search.list`. Requires a `YOUTUBE_API_KEY` env var (distinct from the existing OAuth client used by library import). No new OAuth scope.
- **Privacy posture:** the search query string is sent to Google. The query is user-typed or agent-assembled from cluster labels locally; no personal data beyond the query itself leaves the machine. Description-graph remains local-only.
- **Cost:** free tier. 10,000 units/day, `search.list` = 100 units/call → ~100 searches/day. Single-user usage sits comfortably under this.
- **Operator invariant:** `.env.example` + RUNBOOK + `_Last verified:_` update together (same change).
- **Rollback:** revert the change; the substrate tables and description-graph keep working. Nothing in this phase touches phase 5 code paths destructively.
