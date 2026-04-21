## Why

Folio today is a feed reader: RSS polls five hard-coded category bundles every 30 minutes, deposits new videos into an inbox for triage, and a deterministic algorithm composes a daily "Today's Issue" from what's fresh. The user has decided to pivot Folio into a personal, **editor-driven video magazine** — seed videos from the user's own YouTube library, with an editorial workspace to compose issues slot-by-slot. The RSS-based inbox framing does not serve that product.

This is **Phase 1 of 4** in that pivot. Phase 1 replaces the corpus: the app's source of truth becomes the user's own YouTube library — their Likes, the recent uploads from their Subscriptions, and user-selected playlists — imported on manual demand via OAuth. At the same time, Phase 1 removes the machinery that the new product doesn't need: the entire RSS ingestion pipeline and the algorithmic Today's Issue composition. Later phases ([Phase 2 retire-algo-issues schema cleanup], [Phase 3 editor-workspace UI], [Phase 4 curation-agent LLM]) will build the editorial workspace and the AI curation agent on the corpus this change establishes.

A prior, never-implemented OAuth design exists at [openspec/changes/archive/2026-04-21-oauth-youtube-import/](openspec/changes/archive/2026-04-21-oauth-youtube-import/); it covered subscriptions only and left RSS as the puller. This change **extends** that design — Likes and playlists become first-class corpus sources, and RSS goes away entirely. The stubbed `oauth_tokens` table finally gets wired up.

## What Changes

- **NEW**: YouTube OAuth 2.0 flow with scope `youtube.readonly`. `/api/youtube/oauth/authorize` redirects to Google's consent screen; `/api/youtube/oauth/callback` exchanges the code for access + refresh tokens and persists them in the existing `oauth_tokens` table keyed by `provider='youtube'`. A shared helper transparently refreshes expired access tokens and writes the new one back.
- **NEW**: Thin YouTube Data API client (`src/lib/youtube-api.ts`) over `fetch`, covering `playlistItems.list` (Likes + playlist imports), `subscriptions.list`, `channels.list` (to resolve a channel's uploads playlist), and `playlists.list` (to enumerate the user's own playlists). All calls paginate and auto-refresh on 401.
- **NEW**: Three manual import endpoints:
  - `POST /api/youtube/import/likes` — paginates the `LL` playlist, upserts channels + videos, writes `video_provenance` rows with `kind='like'`. Default consumption status for newly inserted videos is `saved`.
  - `POST /api/youtube/import/subscriptions` — paginates `subscriptions.list`, then for each subscribed channel fetches the last N (default 25, env-configurable) uploads. Provenance `kind='subscription_upload'`. Default consumption status `inbox`.
  - `POST /api/youtube/import/playlists` — lists the user's own playlists. `POST /api/youtube/import/playlists/:id` imports a single playlist's items. Provenance `kind='playlist'` with `source_ref=<playlist_id>`. Default consumption status `saved`.
- **NEW**: Settings page at `/settings/youtube` with connection status (connected channel name + email), Connect / Disconnect buttons, three primary Import buttons (Likes, Subscriptions, Playlists) with last-import timestamps and per-import result counts (new / updated), and a playlists subsection listing the user's playlists each with a per-playlist Import button.
- **NEW**: `video_provenance` table — `(video_id, source_kind, source_ref, imported_at, signal_weight)` — tracks WHY a video is in the corpus and from which user action. Many-to-one with `videos` (a video can appear in both Likes and a playlist). Signal weight is derived from kind: `like=1.0`, `playlist=0.7`, `subscription_upload=0.3`. Used by future Phase 4 curation agent; unused in Phase 1 UI beyond display.
- **NEW**: Migration that performs the destructive reset. DROPs `sources` and `issues` tables. TRUNCATEs `videos`, `channels`, `consumption`, `channel_tags`, `sections`, `tags`. Creates `video_provenance`. Requires the user to run `just backup-db` first; the task plan and RUNBOOK make this step explicit and ordered.
- **NEW**: `justfile` verbs `youtube-auth` (opens the consent URL in a browser) and `youtube-import likes|subscriptions|playlists` (invokes the corresponding endpoint). RUNBOOK gets a "YouTube OAuth" section (Google Cloud Console setup, unverified-app expectation, scope list, token location, how to force re-auth) and a "Data reset" section.
- **NEW**: Env vars `YOUTUBE_OAUTH_CLIENT_ID`, `YOUTUBE_OAUTH_CLIENT_SECRET`, `YOUTUBE_SUBSCRIPTION_UPLOAD_LIMIT` (default 25). Documented in `.env.example`.
- **BREAKING REMOVAL**: The entire RSS ingestion pipeline. Deletes `src/fetchers/` (all source modules, the orchestrator, the registry), `scripts/run-fetchers.ts`, `db/seed-sources.ts`, the `sources` table, the `npm run fetch` script, and the `just cron-install` / `just cron-uninstall` / `just fetch` verbs. The macOS launchd/cron hook the user had installed must be uninstalled by the user before the migration runs (documented in the task plan).
- **BREAKING REMOVAL**: The algorithmic Today's Issue. Deletes `src/lib/issue.ts`, the `issues` table (migration `008_magazine.sql` is superseded), `POST /api/issues/publish`, and the Today's Issue render on the home page. The home page at `/` becomes a minimal empty state in Phase 1: "No issues yet — connect YouTube and import your library to get started." Phase 3 will redefine `/` as a list of composed issues.
- **BREAKING REMOVAL**: All existing data in `events.db`. A one-time migration drops/truncates every content table. `sections`, `tags`, and `channel_tags` are preserved in schema but emptied; they are unused in Phase 1 and will be repopulated as the user reconnects channels (or redesigned in Phase 3).
- **MODIFIED**: `/inbox` — its data source changes from "RSS-fetched videos in consumption status `inbox`" to "subscription-upload imports in consumption status `inbox`". URL and UI are preserved. (Phase 3 will redesign this view.)
- **MODIFIED**: `/library` — continues to show consumption states `saved | in_progress | archived`. Data now comes from Likes + playlist imports + subscription-uploads the user saved during triage. URL and UI preserved. (Phase 3 will redesign this view.)

## Capabilities

### New Capabilities

- `youtube-library-import`: Manual-trigger import of the user's YouTube library into the app corpus. Covers the three import endpoints (Likes, Subscriptions → per-channel recent uploads, user-selected Playlists), the `video_provenance` table and its signal-weight rules, provenance-aware consumption-status defaults, idempotent re-import semantics (existing user state is preserved), the `import_log` table, and the `/settings/youtube` UI surface.

### Modified Capabilities

- `youtube-oauth`: The existing spec is already present (carried over from the archived OAuth change) but refers to RSS-based sources in its disconnect and refresh-failure requirements. Requirements change to remove those RSS references, rename `OAuthRefreshError` → `TokenRevokedError` for consistency, and simplify disconnect to always clear the token without a `disable_sources` flag (there are no sources anymore).
- `video-library`: The "OAuth tokens stub table" requirement no longer describes a stub — the table is populated by `youtube-oauth`. Requirement is rewritten to describe the active table's shape and invariants.

### Removed Capabilities

- `data-ingestion`: The RSS-polling orchestrator is removed. No replacement inside this change — the corpus is now populated by `youtube-library-import` exclusively.
- `youtube-channel-fetcher`: The RSS-based per-channel fetcher module is removed. The YouTube Data API client under `youtube-library-import` subsumes its purpose.
- `subscription-sync`: The narrower, never-implemented subscription-only sync capability from the archived OAuth proposal is folded into `youtube-library-import`. No distinct spec survives.
- `home-view`: The current Today's Issue home page is removed. A trivial empty-state page takes its place in Phase 1 (not a spec-level capability). Phase 3 will introduce a new `home-view` spec for the composed-issues list.

## Impact

- **Code added**:
  - `src/lib/youtube-oauth.ts` — auth URL builder, code exchange, token refresh helper.
  - `src/lib/youtube-api.ts` — thin Data API client with pagination and auto-refresh.
  - `src/lib/youtube-import.ts` — upsert logic for channels + videos + provenance; provenance-aware consumption defaults; idempotent re-import.
  - `src/app/api/youtube/oauth/authorize/route.ts`, `src/app/api/youtube/oauth/callback/route.ts`.
  - `src/app/api/youtube/import/likes/route.ts`, `src/app/api/youtube/import/subscriptions/route.ts`, `src/app/api/youtube/import/playlists/route.ts`, `src/app/api/youtube/import/playlists/[id]/route.ts`.
  - `src/app/settings/youtube/page.tsx` + client island for import buttons.
- **Code removed**:
  - `src/fetchers/` (entire directory, including `orchestrator.ts`, `registry.ts`, all source modules).
  - `scripts/run-fetchers.ts`.
  - `db/seed-sources.ts`.
  - `src/lib/issue.ts`.
  - `src/app/api/issues/` route tree.
  - Today's Issue composition code paths in `src/app/page.tsx` (page becomes the new empty state).
- **Database**:
  - New migration drops `sources` and `issues`, creates `video_provenance`, and truncates `videos`, `channels`, `consumption`, `channel_tags`, `sections`, `tags` in a single transaction. Gate on explicit `just backup-db` run.
  - `oauth_tokens` stays as-is; writes finally happen.
- **API changes**:
  - Added: 2 OAuth routes, 4 import routes.
  - Removed: `/api/issues/publish`.
  - Unchanged: `/api/consumption`, `/api/consumption-progress`.
- **Operational**:
  - `justfile` gains `youtube-auth`, `youtube-import`. Loses `fetch`, `cron-install`, `cron-uninstall`.
  - `package.json` loses the `fetch` script.
  - `RUNBOOK.md` gets two new sections ("YouTube OAuth" and "Data reset"), loses references to cron/RSS, and its `Last verified` date is updated.
  - User must uninstall the system cron entry before running the migration (one-line command documented in tasks).
- **Dependencies**: No new npm packages. The existing `better-sqlite3` handles the migration; native `fetch` handles the YT API.
- **Security**: OAuth client secret in `.env` (gitignored). Tokens in `events.db` (gitignored). Localhost redirect `http://localhost:6060/api/youtube/oauth/callback` must be registered in the Google Cloud project. The `youtube.readonly` scope is read-only — the app cannot modify the user's YouTube state.
- **Risk**:
  - Google's "unverified app" warning appears on first consent — expected and acceptable for a single-user local install.
  - Data destruction is irreversible — the migration is gated on a backup step, but the user must run it. Tasks explicitly stage this.
  - API quota: Likes + Subscriptions + a handful of playlists per manual import is well under the 10,000 units/day default quota.
  - Refresh-token revocation: handled by surfacing a "reconnect" state on the settings page when a refresh attempt returns `invalid_grant`.
- **Out of scope, deferred**: AI / LLM integration (Phase 4); the editor workspace and slot-based issue composition (Phase 3); reshaping `issues` for slots (Phase 2 will reintroduce the table with a different shape); Watch Later import via Google Takeout (future change — Google removed `WL` from the API in 2016); OAuth push actions (subscribe/like from the app); multi-account support; automatic or scheduled re-import (explicitly rejected — manual only).
