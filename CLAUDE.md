# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

- `npm run dev` — Next.js dev server on port **6060** (not 3000)
- `npm run build` / `npm start` — production build & serve
- `npm run lint` — ESLint (flat config in `eslint.config.mjs`)
- `npm run fetch` — one-shot run of the ingestion orchestrator (`scripts/run-fetchers.ts`) via `tsx`. This is what system cron invokes every 30 minutes.
- `tsx db/seed-sources.ts` — apply migrations and upsert the seed rows in `sources`. Safe to re-run.
- `just backup-db` — timestamped copy of `events.db`. Run before risky migrations.

There is no test runner configured. Do not add one unless asked.

## Architecture

**Folio** — a personal, taste-aware consumption room for the user's YouTube
library. OAuth-imported videos land in an Inbox, get triaged into Saved /
In-Progress / Archived, and surface back on `/` through taste-cluster-weighted
rails (Right Now / Continue / Shelf). The earlier live-events framing
(`events`, `status = scheduled|live|ended`, category filters, Lucky Pick,
watched history) was removed during the video-library pivot — see
`openspec/changes/archive/2026-04-21-rename-to-videos/` for the rationale.
The magazine framing (issues, slot board, sections, masthead) and its
companion editor agent were removed by the `magazine-teardown` change on
2026-04-23; what survives is the consumption substrate plus a per-day
curation companion at `/chat`. The original design brief at
`docs/original-proposal.md` is outdated and retained only as historical
context.

### Ingestion pipeline (`src/fetchers/`)

- Each source module exports a `Fetcher { sourceId, fetch(): Promise<NormalizedVideo[]> }` (see `src/lib/types.ts`).
- Only YouTube channel sources exist today. `registry.ts` maps `source.id` → `Fetcher`. Static fetchers are hard-coded; **dynamic** user-added YouTube channel sources (`id LIKE '%_user'`, `kind = 'youtube_channel'`) are built at request time via `createYouTubeChannelFetcher(sourceId)`. If you add a new static source, register it here AND seed a matching row in `sources`.
- `orchestrator.ts` is the heart of ingestion. For every enabled source whose `last_fetched_at` is older than `min_interval_minutes` (default 30), it calls `fetch()`, then inside a transaction upserts the channel row, upserts the video row keyed on the raw YouTube video ID, and `INSERT OR IGNORE`s a `consumption` row with `status = 'inbox'` so new videos appear in triage. Re-runs are idempotent: existing consumption state is preserved. Fetch errors are captured in `sources.last_error` and never crash the run. There is **no stale-event sweep** — `is_live_now` is a per-fetch fact, not a lifecycle state.
- `scripts/run-fetchers.ts` is the cron entrypoint: `runMigrations()` then `runOrchestrator()`. Run via `tsx`.

### Data layer (`src/lib/db.ts`, `db/migrations/`)

- SQLite via `better-sqlite3`. Single file `events.db` at repo root (historical name — the schema now holds videos, not events), WAL mode, foreign keys on, 5s busy timeout.
- `getDb()` returns a process-wide singleton. `runMigrations()` applies any `db/migrations/*.sql` files not yet recorded in `_migrations`. Add new migrations as `NNN_description.sql` — they run in lexical order.
- Schema:
  - `sources` — registered YouTube channel feeds (polling config + error state).
  - `channels` — YouTube channel identity (`id` = `UCxxx`, name, `subscribed` flag reserved for a later OAuth change).
  - `videos` — content metadata keyed on the raw YouTube video ID (no source prefix).
  - `consumption` — 1:1 with `videos`, holds the user-state lifecycle (`inbox | saved | in_progress | archived | dismissed`) and `status_changed_at`.
  - `oauth_tokens`, `highlights` — stub tables created but not written by any current code path. They exist to be populated by the follow-on `oauth-youtube-import` / `spaced-review` changes.
  - `consumption.last_position_seconds` is written by the player (see Consumption lifecycle) and cleared on auto-archive.

### Consumption lifecycle (`src/lib/consumption.ts`)

- Transitions are enforced at the application layer — there are no CHECK/TRIGGER guards in SQL. `setConsumptionStatus(videoId, next)` is the only entry point and throws `IllegalTransitionError` for disallowed moves.
- Legal edges: `inbox → saved|dismissed`, `saved → in_progress|archived|dismissed`, `in_progress → archived|saved`, `archived → saved|in_progress`, `dismissed → inbox`.
- The API route `src/app/api/consumption/route.ts` maps that error to HTTP 422; the success path returns 204. Use this for explicit user intent (button clicks).
- `recordProgress({ videoId, action, position? })` handles implicit playback signals (`start | tick | pause | end`). `start` auto-promotes `inbox → saved → in_progress` atomically, direct-edges `saved|archived → in_progress`, and no-ops on `dismissed` or `in_progress`. `end` auto-archives in-progress videos and clears `last_position_seconds`. `tick`/`pause` write the current position. The API route `src/app/api/consumption-progress/route.ts` accepts both `application/json` and `sendBeacon`-shaped bodies.
- Helpers in the same file (`getInboxVideos`, `getLibraryVideos`, `getArchivedVideos`, `getLiveNowVideos`, `getVideoById`, `getConsumptionCounts`) are the canonical JOINs that RSC pages use.

### Taxonomy (`src/lib/tags.ts`)

The remaining taxonomy is **tags** — many-to-many via `channel_tags`, additive slicing only. Powers `/tag/[slug]` and the Tags strip on `/`. Tags are managed inline on the relevant card via `TagsEditor`. The earlier `sections` capability (1:1 channel→section, the structural backbone for the magazine's department pages) was retired by `magazine-teardown`; `016_magazine_teardown.sql` migrated every `channels.section_id` link into a `channel_tags` row by name before dropping `sections` + the column.

### Taste substrate (`src/lib/embeddings.ts`, `enrichment.ts`, `taste.ts`, `transcripts.ts`)

Five additive tables
(`video_embeddings`, `video_enrichment`, `video_transcripts`, `taste_clusters`,
`video_cluster_assignments`) built by `scripts/taste/*` scripts invoked via
`just taste-build` / `just taste-cluster`. Embeddings default to OpenAI
(`text-embedding-3-small`); enrichment runs locally through Ollama (cheap bulk
work stays on-machine). Clustering runs on the like-set only, then every corpus
video is assigned to its nearest active cluster by cosine — below the fuzzy
floor (default 0.65) the assignment is flagged `is_fuzzy=1`. Cluster IDs are
preserved across rebuilds via centroid matching so user-assigned labels survive
re-import. See `RUNBOOK.md` § "Taste substrate" for setup and operational notes.

### Taste lab (`src/lib/taste-edit.ts`, `taste-read.ts`, `src/app/taste/`)

Human-in-the-loop editing of the cluster map. `/taste` lists active clusters
with inline label + weight edits and a drift indicator; `/taste/[clusterId]`
shows the full member list with reassign + Merge/Split/Retire actions.
**`src/lib/taste-edit.ts` is the only legal mutation path** — every edit
(label, weight, reassign, merge, split, retire) flows through it, runs
inside a `db.transaction(...)`, and enforces `IllegalEditError` (HTTP 422)
and `ConcurrentEditError` (HTTP 409, optimistic-lock on
`taste_clusters.updated_at`). API routes under `src/app/api/taste/` are thin
error-mappers over that module. The read layer (`taste-read.ts`) is
read-only and powers both pages. Vector helpers in `src/lib/taste.ts`
(`runKmeans`, `silhouetteScore`, `meanCentroid`, `cosineSim`,
`centroidToBlob`) are exported and shared with the clustering so they have
one notion of "centroid". The `weight` column is read at home-ranking time
and is also surfaced to the curation agent. See `RUNBOOK.md` § "Taste lab"
for editing rules and rebuild interaction.

### Home ranking (`src/lib/home-ranking.ts`, `src/lib/mutes.ts`, `src/components/home/`)

The first reader of `taste_clusters.weight`. `src/lib/home-ranking.ts` is
the **single legal read path**: `rankForHome({ limit?, now? })` runs one
SQL query joining `consumption`, `videos`, `video_cluster_assignments`,
`taste_clusters`, and `taste_cluster_mutes`, filters the pool to
`status IN ('inbox','saved','in_progress')`, and scores each candidate as
`clusterWeight × freshness × stateBoost × fuzzyPenalty` (constants
`HOME_RANKING_HALF_LIFE_DAYS = 14`, `FUZZY_PENALTY = 0.7`,
`UNKNOWN_CLUSTER_WEIGHT = 0.5`, `UNKNOWN_FRESHNESS = 0.5`; no env
overrides). Sort is score desc with `video_id` asc tie-break; default
`limit = 20`. Clamps `taste_clusters.weight` to `[0, 2]` at read time;
`taste-edit.ts` is unchanged. `src/lib/mutes.ts` is the only mutation
path for the per-day mute toggle (`setMuteToday`, `isMutedToday`,
`getMutedClusterIdsToday`) — transactions + typed `ClusterNotFoundError`
(404). The rail component `RightNowRail` lives in `src/components/home/`
and is rendered on `/` whenever a corpus is present (connected +
`videos > 0`) — no feature flag. `/` owns the consumption-home rail stack
(`RightNowRail` → `ContinueRail` → `ShelfRail` → entry-point footer).
API routes `GET /api/home/ranking` (with `?debug=1` breakdown) and
`POST /api/taste/clusters/[id]/mute-today` are thin wrappers. See
`RUNBOOK.md` § "Home ranking rail".

### Curation agent (`src/lib/agent/`, `src/components/agent/`, `src/app/api/agent/`, `src/app/chat/`)

A Claude-driven curation companion bound to today's local-day. The
`ChatPanel` lives at `/chat` and reads/writes `conversations` keyed by
`scope_date` (one conversation per America/New_York day). The agent has
no slot board, no draft issue, and no editor-in-chief framing; it helps
the user navigate the pool, maintain playlists, and calibrate cluster
signals.

**`src/lib/agent/run.ts` is the only place the agentic loop runs.** It
drives the multi-turn tool loop server-side, resolves today's `scope_date`
itself, persists every turn (user, assistant, tool) to
`conversation_turns`, and yields framing events (`delta`, `tool_call`,
`tool_result`, `error`, `done`) to its caller. The API route
`POST /api/agent/message` is a thin SSE adapter; the client never
dispatches tools.

Thirteen tools total (`src/lib/agent/tools.ts`): `search_pool`,
`rank_by_theme`, `get_video_detail`, `get_taste_clusters` (all read-only
over the substrate); the consumption-side mutations `create_playlist`,
`add_to_playlist`, `remove_from_playlist`, `reorder_playlist`,
`triage_inbox`, `mute_cluster_today`, `resurface`; and the active-
discovery pair `search_youtube` + `propose_import` (user-initiated
outbound search and candidate staging — see Discovery below). The agent
has no write access to taste tables (cluster edits remain on `/taste`);
the per-day mute is the one taste-side action. Tool failures surface as
`tool_result` blocks (normal loop input), not SSE `error` events —
`error` is reserved for model/API faults and the `AGENT_MAX_TURNS` cap.

Without `ANTHROPIC_API_KEY`, `/api/agent/status` returns
`{ apiKeyPresent: false, youtubeSearchEnabled, ... }` and `/chat`
renders a disabled card; the rest of the app is unaffected. Without
`YOUTUBE_API_KEY`, `youtubeSearchEnabled` is `false` and the `/chat`
composer surfaces a one-line "Active YouTube search is disabled" hint;
`search_youtube` returns a `youtube_api_key_missing` tool error.
See `RUNBOOK.md` § "Curation agent" and "Discovery (active)" for setup,
cost expectations, and privacy posture.

### Overnight maintenance (`src/lib/nightly/`, `src/lib/discovery/`, `scripts/nightly.ts`, `ops/com.folio.nightly.plist.tmpl`)

A single local-only nightly pipeline installed via launchd (opt-in; verbs
`just nightly{,-install,-uninstall}`). `src/lib/nightly/run.ts` is the only
place the sequential 7-step orchestrator runs: migrate → OAuth import
(`importLikes` + `importSubscriptions`) → transcripts → enrich → embed →
recluster → description-graph. Per-step failures are captured in
`nightly_runs.counts.steps` and `nightly_runs.last_error` but do not abort
later steps. `runNightly` returns early with `status = 'skipped'` when no
`oauth_tokens` row exists, with the notes pointing at
`/settings/youtube`. The pipeline has **no Anthropic dependency** — it runs
cleanly with `ANTHROPIC_API_KEY` unset. Step 6 (recluster) is incremental
by default: it assigns newly-embedded videos to their nearest active
cluster, recomputes affected centroids, and only falls through to
`rebuildClusters()` if max centroid drift exceeds `RECLUSTER_REBUILD_DRIFT`
(default `0.20`). `src/lib/nightly/digest.ts` writes exactly one
`nightly_runs` row per invocation with a ≤140-char `notes` sentence;
`src/lib/nightly/read.ts#getLatestDigest` is the **only** reader and
surfaces the row to `<SinceLastVisit />` on `/` when the run is `ok` and
within 36 hours. `src/lib/discovery/description-graph.ts` parses YouTube
links, `UC…` channel ids, and `@handle` mentions from descriptions +
transcripts of `consumption.status IN ('saved','in_progress')` videos;
`src/lib/discovery/score.ts` scores each candidate as
`clusterCosine × clusterWeight × sourceFreshness` against active clusters;
`src/lib/discovery/candidates.ts` is the **single legal mutation path**
for `discovery_candidates` / `discovery_rejections` (idempotent on
`(target_id, source_video_id, source_kind)` for description-graph rows;
`isAlreadyKnown` covers the active-search NULL case). See
`RUNBOOK.md` §§ "Overnight maintenance" and "Discovery candidates
(substrate)" for install/inspection.

### Active discovery (`src/lib/discovery/{search,read,approve,dismiss,rejections}.ts`, `src/components/discovery/`, `src/app/api/discovery/`, `/settings/discovery`)

Phase 6 (`active-discovery`, 2026-04-26) shipped the active half of the
substrate. `src/lib/discovery/search.ts#searchYoutube` wraps YouTube
Data API v3 `search.list` (key-based, not OAuth — see the
`dataApiGet` / `fetchVideoMetadata` / `fetchChannelByIdOrHandle` helpers
in `src/lib/youtube-api.ts`). `src/lib/discovery/approve.ts#approveCandidate`
is the only legal entry point for moving a candidate into the corpus —
it fetches metadata via the Data API outside any DB transaction, then
inside one transaction reuses `importVideos` (provenance kind `like`),
flips the candidate row to `'approved'`, and deletes it. The companion
`src/lib/discovery/dismiss.ts` and `src/lib/discovery/rejections.ts`
own the dismiss + rejection-clear paths; `src/lib/discovery/read.ts`
provides the `listProposedCandidates` / `listRejections` helpers used by
both RSC pages and the agent snapshot.

Six API routes under `src/app/api/discovery/`: `GET candidates`,
`POST candidates/[id]/approve`, `POST candidates/[id]/dismiss`,
`GET rejections`, `DELETE rejections/[id]`, `DELETE rejections`.
Approve maps `CandidateNotFoundError → 404`,
`YouTubeApiKeyMissingError → 412`, `YouTubeDataApiError → 502`.
`src/components/discovery/ProposedRail.tsx` mounts on `/inbox` above
the existing thick rule and renders nothing when no `proposed` rows
exist. `/settings/discovery` is the rejection-list manager.

The two new agent tools (`search_youtube`, `propose_import`) live in
`src/lib/agent/tools.ts`. The system prompt forbids auto-calling
`search_youtube`; the tool's description repeats the rule for
tool-selection-time visibility. Migration `018_active_discovery.sql`
relaxed `discovery_candidates.source_video_id` to nullable so active-
search rows can persist without a fake source video.

### Time handling (`src/lib/time.ts`)

All timestamps are stored as UTC ISO 8601. Display is `America/New_York` (Tampa). **Every date conversion goes through this module** — use `toLocal`, `toLocalDateTime`, `relativeTime`, `formatDuration`, and do not call `date-fns-tz` directly elsewhere.

### Web UI (`src/app/`, App Router)

- Pages are React Server Components reading SQLite directly via the `consumption.ts` helpers (which wrap `getDb()`). There is no API layer between RSC pages and the DB.
- Routes: `/` (consumption-home rail stack), `/inbox` (triage; Proposed rail mounts here), `/library` (Saved / In Progress / Archived sections — In Progress cards render a thin progress bar when `last_position_seconds` and `duration_seconds` are both known), `/playlists`, `/playlists/[id]`, `/taste`, `/taste/[clusterId]`, `/tag/[slug]`, `/watch/[id]` (IFrame Player API embed + metadata), `/chat` (curation agent), `/settings/youtube`, `/settings/discovery` (rejection-list manager).
- Mutation APIs:
  - `POST /api/consumption` `{ videoId, next }` — explicit user-initiated transitions (Save, Archive, Dismiss, Re-open).
  - `POST /api/consumption-progress` `{ videoId, action, position? }` — implicit playback signals emitted by the Player. Fire-and-forget from the client; accepts `sendBeacon`-style text bodies.
- `src/components/` holds the client islands (`ConsumptionAction`, `Player`, `VideoCard`). `src/components/ui/` is shadcn-generated.
- Player view (`src/app/watch/[id]/`) uses the YouTube IFrame Player API client-side — this app **never proxies or restreams** video. Non-YouTube stream kinds (Twitch, generic iframe, NASA, Explore.org) have been removed; the id column is the YouTube video ID and is used verbatim in the embed. The Player auto-seeks to `consumption.last_position_seconds` on load (silent — no resume UI), dispatches `start`/`pause`/`end` on `onStateChange` and a 30s `tick` while playing, and uses `navigator.sendBeacon` on `visibilitychange`/`pagehide`.

### Playlists (`src/lib/playlists.ts`, `src/app/playlists/`, `src/app/api/playlists/`)

Named, ordered, many-to-many collections of videos. Two tables
(`playlists`, `playlist_items`) added by
migration `014_playlists.sql`; both `ON DELETE CASCADE` from their parents
so deleting a video or a playlist cleans up `playlist_items` automatically.
**`src/lib/playlists.ts` is the only legal mutation path** — every write
flows through `createPlaylist`, `renamePlaylist`, `deletePlaylist`,
`addToPlaylist`, `removeFromPlaylist`, or `reorderPlaylist` inside a
`db.transaction(...)`, and every mutation touches `playlists.updated_at`.
Typed errors (`PlaylistNotFoundError`, `VideoNotFoundError`,
`DuplicateVideoInPlaylistError`, `InvalidPositionError`) map to HTTP
404/404/409/422 in the API routes under `src/app/api/playlists/**`. Read
helpers `listPlaylists`, `getPlaylist`, `getPlaylistsForVideo`, and
`getPlaylistsForVideos` (batch) power the RSC pages and the membership
indicator on cards. The list page sorts by `updated_at DESC`; item
positions are dense integers but reorders only renumber the affected
range, so occasional gaps (after removals) are tolerated. `show_on_home`
is persisted by `PATCH /api/playlists/[id]` and read by `ShelfRail` on
`/`. The `<AddToPlaylistButton>`
popover (`src/components/playlist/`) is wired into both `VideoCard` and
`LibraryCard` via an optional `playlists` prop; consumers must
batch-load with `getPlaylistsForVideos` to avoid N+1 queries (see
`src/app/library/page.tsx`).

### Next.js version caveat

This is **Next.js 16** (`next@16.2.2`) with React 19. App Router APIs, params typing, caching defaults, and config surface differ from older versions that dominate training data. Before editing routing, data-fetching, or config code, consult `node_modules/next/dist/docs/` and honor any deprecation notices (per `AGENTS.md`).

## OpenSpec

Per-feature specs and in-flight change proposals live in `openspec/` (`specs/` and `changes/`). Use the `openspec-*` skills to propose/apply/archive changes rather than editing these trees by hand.

## Operational invariants

This project maintains:
- `justfile` with verbs: `dev`, `down`, `status`, `logs`, `test`, `seed`, `fetch`, `backup-db`, `cron-install`, `cron-uninstall`, `nightly`, `nightly-install`, `nightly-uninstall`.
- `RUNBOOK.md` describing services, ports, environments, troubleshooting.

**Invariant:** any change to launch/deploy/config — `Dockerfile`,
`docker-compose.yml`, `.env.example`, package scripts, ports, env
vars — MUST update both `justfile` and `RUNBOOK.md` in the same change.
Update the `Last verified` date when you touch the runbook.

When the user asks "how do I run this?" or "is it running?", point
them at `just status` or the relevant RUNBOOK section. Do not
re-derive from code.
