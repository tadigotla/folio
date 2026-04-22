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

**Folio** — a personal, magazine-shaped YouTube reading experience. The app
ingests YouTube RSS feeds into a local SQLite DB, lets the user triage new
arrivals in an Inbox, save keepers to a Library, and play them back via the
official YouTube iframe embed. An older live-events framing
(`events`, `status = scheduled|live|ended`, category filters, Lucky Pick,
watched history) was removed during the video-library pivot — see
`openspec/changes/archive/2026-04-21-rename-to-videos/` for the rationale.
The original design brief at `docs/original-proposal.md` is outdated and
retained only as historical context.

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

### Magazine issue lifecycle (`src/lib/issue.ts`, `src/app/page.tsx`)

Taxonomy is two-layered: **sections** (1:1 channel→section, structural backbone used by home-page composition + `/section/[slug]`) and **tags** (many-to-many via `channel_tags`, additive slicing only — powers `/tag/[slug]` and the Tags strip on `/`, but does NOT participate in issue composition). Manage both on `/sections`.

The home page is a **today's issue** view backed by the `issues` table (migration `008_magazine.sql`). `getOrPublishTodaysIssue()` renders the latest issue if its `created_at` is today in America/New_York; otherwise it inserts a new row by running the composition rules. Composition: `composeIssue()` picks `cover_video_id` (affinity × recency × depth score over the inbox — see `scoreVideoForCover`), then `pickFeatured` picks one video per top-3 section (fallback: global top-3), and `pickBriefs` returns the 10 shortest inbox videos excluding cover + featured. `setCoverPin` writes `pinned_cover_video_id` on the latest issue; `effectiveCoverId` returns the pinned video if it's still inbox-valid, otherwise the deterministic cover. Explicit publish comes through `POST /api/issues/publish` (`↻ Publish new` button in the masthead). The `sections` table + `channels.section_id` drive the `/section/[slug]` department pages and the SectionChip assignment UI.

### Taste substrate (`src/lib/embeddings.ts`, `enrichment.ts`, `taste.ts`, `transcripts.ts`)

Phase-1 data plane for the conversational-editor umbrella. Five additive tables
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

Phase-2 surface for the conversational-editor umbrella: human-in-the-loop
editing of the cluster map. `/taste` lists active clusters with inline label
+ weight edits and a drift indicator; `/taste/[clusterId]` shows the full
member list with reassign + Merge/Split/Retire actions. **`src/lib/taste-edit.ts`
is the only legal mutation path** — every edit (label, weight, reassign, merge,
split, retire) flows through it, runs inside a `db.transaction(...)`, and
enforces `IllegalEditError` (HTTP 422) and `ConcurrentEditError` (HTTP 409,
optimistic-lock on `taste_clusters.updated_at`). API routes under
`src/app/api/taste/` are thin error-mappers over that module. The read layer
(`taste-read.ts`) is read-only and powers both pages. Vector helpers in
`src/lib/taste.ts` (`runKmeans`, `silhouetteScore`, `meanCentroid`,
`cosineSim`, `centroidToBlob`) are exported and shared with phase-1's
clustering so they have one notion of "centroid". The `weight` column is
written here but not yet read by any code path — it lands as input to the
editor agent in phase 3. See `RUNBOOK.md` § "Taste lab" for editing rules
and rebuild interaction.

### Editor agent (`src/lib/agent/`, `src/components/agent/`, `src/app/api/agent/`)

Phase-3 surface for the conversational-editor umbrella: a Claude-driven
chat panel bound to the current draft issue. The panel co-lives with the
slot board on `/` (two columns at `xl:`, stacked below, hidden on mobile)
and writes to `issue_slots` through the same library helpers (`assignSlot`,
`swapSlots`, `clearSlot` in `src/lib/issues.ts`) that the drag board uses —
slot rows are indistinguishable between the two sources.

**`src/lib/agent/run.ts` is the only place the agentic loop runs.** It
drives the multi-turn tool loop server-side, persists every turn (user,
assistant, tool) to `conversation_turns`, and yields framing events
(`delta`, `tool_call`, `tool_result`, `error`, `done`) to its caller. The
API route `POST /api/agent/message` is a thin SSE adapter over it. No
client-side tool dispatch.

Seven tools total (`src/lib/agent/tools.ts`): `search_pool`,
`rank_by_theme`, `get_video_detail`, `get_taste_clusters` (read-only over
the taste substrate), `assign_slot`, `swap_slots`, `clear_slot`. The agent
has no write access to taste tables — cluster edits remain exclusively on
`/taste`. Tool failures surface as `tool_result` blocks (normal loop
input), not SSE `error` events; `error` is reserved for model/API faults
and the `AGENT_MAX_TURNS` cap.

Conversations are 1:1 with draft issues and cascade-delete with them
(migration `013_conversational_editor.sql`). Publishing the draft freezes
the conversation — `appendTurn` rechecks the issue status inside its
transaction. Without `ANTHROPIC_API_KEY`, `/api/agent/status` returns
`{ apiKeyPresent: false }` and the panel renders a disabled card; the
board remains fully functional. See `RUNBOOK.md` § "Editor agent" for
setup, cost expectations, and privacy posture.

### Time handling (`src/lib/time.ts`)

All timestamps are stored as UTC ISO 8601. Display is `America/New_York` (Tampa). **Every date conversion goes through this module** — use `toLocal`, `toLocalDateTime`, `relativeTime`, `formatDuration`, and do not call `date-fns-tz` directly elsewhere.

### Web UI (`src/app/`, App Router)

- Pages are React Server Components reading SQLite directly via the `consumption.ts` helpers (which wrap `getDb()`). There is no API layer between RSC pages and the DB.
- Routes: `/` (nav hub + Live Now strip), `/inbox` (triage), `/library` (Saved / In Progress / Archived sections — In Progress cards render a thin progress bar when `last_position_seconds` and `duration_seconds` are both known), `/watch/[id]` (IFrame Player API embed + metadata).
- Mutation APIs:
  - `POST /api/consumption` `{ videoId, next }` — explicit user-initiated transitions (Save, Archive, Dismiss, Re-open).
  - `POST /api/consumption-progress` `{ videoId, action, position? }` — implicit playback signals emitted by the Player. Fire-and-forget from the client; accepts `sendBeacon`-style text bodies.
- `src/components/` holds the client islands (`ConsumptionAction`, `Player`, `VideoCard`). `src/components/ui/` is shadcn-generated.
- Player view (`src/app/watch/[id]/`) uses the YouTube IFrame Player API client-side — this app **never proxies or restreams** video. Non-YouTube stream kinds (Twitch, generic iframe, NASA, Explore.org) have been removed; the id column is the YouTube video ID and is used verbatim in the embed. The Player auto-seeks to `consumption.last_position_seconds` on load (silent — no resume UI), dispatches `start`/`pause`/`end` on `onStateChange` and a 30s `tick` while playing, and uses `navigator.sendBeacon` on `visibilitychange`/`pagehide`.

### Next.js version caveat

This is **Next.js 16** (`next@16.2.2`) with React 19. App Router APIs, params typing, caching defaults, and config surface differ from older versions that dominate training data. Before editing routing, data-fetching, or config code, consult `node_modules/next/dist/docs/` and honor any deprecation notices (per `AGENTS.md`).

## OpenSpec

Per-feature specs and in-flight change proposals live in `openspec/` (`specs/` and `changes/`). Use the `openspec-*` skills to propose/apply/archive changes rather than editing these trees by hand.

## Operational invariants

This project maintains:
- `justfile` with verbs: `dev`, `down`, `status`, `logs`, `test`, `seed`, `fetch`, `backup-db`, `cron-install`, `cron-uninstall`.
- `RUNBOOK.md` describing services, ports, environments, troubleshooting.

**Invariant:** any change to launch/deploy/config — `Dockerfile`,
`docker-compose.yml`, `.env.example`, package scripts, ports, env
vars — MUST update both `justfile` and `RUNBOOK.md` in the same change.
Update the `Last verified` date when you touch the runbook.

When the user asks "how do I run this?" or "is it running?", point
them at `just status` or the relevant RUNBOOK section. Do not
re-derive from code.
