## Why

The only way new channels enter the library today is by hand-editing [db/seed-sources.ts](db/seed-sources.ts) and re-running the seed script. That means the five hard-coded category bundles (`youtube_space`, `youtube_news`, `youtube_nature`, `youtube_culture`, `youtube_philosophy`) are the entire universe of content — every channel the user is actually subscribed to on YouTube is invisible to the app. The `oauth_tokens` table has been sitting empty since the pivot, reserved for exactly this.

This change wires up YouTube OAuth so the app can pull the user's real subscription list and materialize each subscribed channel as a `sources` row. RSS ingestion of those channels stays as-is — OAuth is only used to discover *which* channels to poll, not to fetch their videos (the Data API's quota cost for video listing is ~100× the RSS cost of zero).

## What Changes

- **NEW**: `/api/youtube/oauth/authorize` redirects the browser to Google's consent screen with scope `youtube.readonly`. On return, `/api/youtube/oauth/callback` exchanges the code for an access + refresh token and stores them in `oauth_tokens` keyed by `provider = 'youtube'`.
- **NEW**: `/api/youtube/subscriptions/sync` (POST) — pulls the user's full subscription list via `GET youtube/v3/subscriptions?mine=true`, paginating until complete. For each subscribed channel, upserts a `sources` row with `id = youtube_channel_<UCxxx>_user`, `kind = 'youtube_channel'`, `config = { channels: [{ id, name }], rss_base: … }`, `enabled = 1`, `min_interval_minutes = 30`. Channels the user has *unsubscribed* from since the last sync are marked `enabled = 0` (never deleted — preserves any `videos` / `consumption` rows still referencing them).
- **NEW**: settings page at `/settings/youtube` showing connection status, last sync time, imported channel count, and buttons to connect / disconnect / re-sync.
- **NEW**: scheduled subscription refresh — `scripts/run-fetchers.ts` calls the sync function once per run (cheap: one paginated API call) before the ingestion loop, so new subscriptions surface within one 30-minute cron tick. Failure is logged to `sources.last_error` of a synthetic `youtube_subscriptions` row (or a new dedicated field — see design) and does NOT abort the fetch run.
- **MODIFIED**: the existing dynamic-fetcher path in [src/fetchers/registry.ts](src/fetchers/registry.ts) (`id LIKE '%_user'`) already handles one-channel-per-source rows, so no fetcher code changes are required.
- **MODIFIED**: [db/seed-sources.ts](db/seed-sources.ts) keeps seeding the five categorical sources for now as a fallback when OAuth is not connected. After the user connects and syncs, the category sources can be disabled manually; no automatic migration of their channels into per-channel rows (avoids cross-schema ambiguity when the same channel exists in a bundle AND as a user source).
- **NEW**: env vars `YOUTUBE_OAUTH_CLIENT_ID` and `YOUTUBE_OAUTH_CLIENT_SECRET` (installed-app OAuth 2.0 credentials from Google Cloud Console). Documented in `.env.example` and `RUNBOOK.md`.

## Capabilities

### New Capabilities
- `youtube-oauth`: OAuth 2.0 consent flow, token storage in `oauth_tokens`, and automatic access-token refresh via the refresh token. Covers the `/api/youtube/oauth/*` routes and the token lifecycle.
- `subscription-sync`: the one-way import of `youtube/v3/subscriptions` → `sources` rows, the disable-on-unsubscribe behavior, and the settings page that surfaces sync status.

### Modified Capabilities
- `data-ingestion`: the orchestrator gains a pre-loop step that calls subscription sync when an OAuth token is present. Requirement change: "the orchestrator SHALL refresh the subscription list before polling sources when YouTube OAuth is connected."

## Impact

- **Code:** new `src/lib/youtube-oauth.ts` (auth helper: build URL, exchange code, refresh token), `src/lib/youtube-api.ts` (thin client for `subscriptions.list` with auto-refresh), new route handlers under `src/app/api/youtube/`, new page under `src/app/settings/youtube/`, small orchestrator hook in `src/fetchers/orchestrator.ts`.
- **Database:** no new tables. `oauth_tokens` is already present. One new migration to ensure an index on `sources(id)` LIKE pattern if performance requires it — likely not needed at the sub-1000-row scale.
- **API:** 3 new routes (`/api/youtube/oauth/authorize`, `/api/youtube/oauth/callback`, `/api/youtube/subscriptions/sync`). Existing `/api/consumption*` routes unaffected.
- **Operational:** `justfile` gains a `youtube-sync` verb for manual re-sync. `RUNBOOK.md` gets a "YouTube OAuth" section covering Google Cloud setup, consent-screen caveats (the app is a single-user local install so "unverified app" warning is expected), and where tokens live (`oauth_tokens` table, not `.env`). `.env.example` gets the two new vars.
- **Security:** client secret lives in `.env` (gitignored). Tokens live in `events.db`, which is already gitignored. Localhost redirect URI (`http://localhost:6060/api/youtube/oauth/callback`) must be registered in the Google Cloud project.
- **Out of scope (deferred):** importing Watch Later / Liked Videos / playlists (requires additional scopes and a different shape than channel-polling), OAuth *push* to change subscription state from the app, multi-account support (the table is keyed on provider, so the schema would need a user dimension). These can follow in a later change if needed.
