## Context

The app's content universe is fixed at seed time. [db/seed-sources.ts](db/seed-sources.ts) hard-codes ~25 channels grouped into five categorical `sources` rows (e.g. `youtube_space`, `youtube_news`). New subscriptions never arrive without a developer edit + reseed. Meanwhile the `oauth_tokens` table (migration 003) has been waiting since the pivot for exactly this change — it's already shaped for a single-provider token store (`provider PRIMARY KEY`, access/refresh/expires/scope/updated_at).

The fetcher architecture already supports per-channel dynamic sources: [src/fetchers/registry.ts](src/fetchers/registry.ts) recognizes `id LIKE '%_user'` and builds a `createYouTubeChannelFetcher(sourceId)` at request time. That means OAuth import doesn't need new ingestion code — just a new *origin* of `sources` rows.

The app runs locally on port 6060 for a single user. There's no hosted redirect URI, no multi-tenant concern, no compliance framework. Google's OAuth flow *does* require a verified app for public release, but for a single-user dev install the "unverified app" warning on the consent screen is acceptable and expected.

## Goals / Non-Goals

**Goals:**
- Connect once, then new channels the user subscribes to on YouTube appear in the app within one cron tick (~30 min).
- Unsubscribing on YouTube disables (not deletes) the corresponding source — preserves historical `videos` / `consumption` rows.
- Keep RSS as the video-listing mechanism. OAuth is *only* for discovering which channels to poll.
- Tokens live in SQLite, not `.env` or disk. Refresh happens transparently inside the API client.

**Non-Goals:**
- Watch Later / Liked / playlist ingestion — different API shapes, different scopes, punt to a follow-on.
- Two-way sync (subscribing from the app) — out of scope; app stays read-only toward YouTube.
- Multi-account — `oauth_tokens.provider` is a PK, so only one YouTube identity is supported. Schema change deferred.
- Replacing `seed-sources.ts` in this change — the categorical bundles coexist with user sources for now; manual cleanup is a user-triggered action, not automated.

## Decisions

### 1. Installed-app OAuth flow over web-server flow

**Chosen:** Google "Installed application" OAuth 2.0 flow with loopback redirect to `http://localhost:6060/api/youtube/oauth/callback`.

**Alternative considered:** Device code flow (user copies code to a browser on another device). Rejected — the user is *already* on a browser when they hit `/settings/youtube`, so the loopback round-trip is the simpler UX.

**Rationale:** Loopback redirects are explicitly supported for installed apps and don't require a public HTTPS endpoint. Google Cloud Console lets you register `http://localhost:6060/…` as a redirect URI under the "Web application" client type (despite the name — Google's docs confirm this is the pattern for desktop apps running a local server).

### 2. State parameter stored in a signed cookie, not the database

CSRF-protection `state` is generated in `/authorize`, set as an HttpOnly, SameSite=Lax cookie, and verified in `/callback`. No DB round-trip. Cookie expires after 10 minutes.

**Alternative:** Persist `state` in a new table. Rejected — state is ephemeral per-flow, a cookie is the standard fit.

### 3. Token storage: plaintext in `oauth_tokens`

Access and refresh tokens are stored as plaintext in the `oauth_tokens` row. `events.db` is gitignored and lives on the user's local machine alongside the app.

**Alternative:** Encrypt at rest with a key from `.env`. Rejected for v1 — the threat model is "someone with filesystem access to `events.db`", which is the same threat model as the app's entire state. Adding envelope encryption without a KMS is security theater. Revisit if the app ever runs on a shared host.

### 4. Refresh happens lazily inside `src/lib/youtube-api.ts`

The API client checks `expires_at` before every call. If within 60 seconds of expiry, it calls Google's `oauth2.googleapis.com/token` with the refresh token, updates the row, and proceeds. If the refresh call returns `invalid_grant`, the client throws a typed error that the orchestrator catches and surfaces on the settings page as "reconnect required" — *without* disabling existing sources (they keep fetching via RSS, which doesn't need the token).

**Alternative:** A background refresh job or middleware. Rejected — one call path, one place to handle token lifecycle.

### 5. Subscription → source mapping: one channel per source row

Each imported channel becomes its own `sources` row: `id = youtube_channel_<UCxxx>_user`, `config = { channels: [{ id, name }], rss_base: '…' }`. This matches the existing dynamic path and gives per-channel `last_fetched_at` / `last_error` tracking.

**Alternative:** One big `youtube_subscriptions_user` source containing all imported channels. Rejected — a single failing channel would poison the whole fetch, and we'd lose per-channel scheduling. The categorical bundles in seed-sources.ts have this bug today; this change should not perpetuate it.

**Collision handling:** if a channel appears in both a seed-source bundle AND a user-imported source, both sources will fetch and deliver `NormalizedVideo` objects with the same `videoId`. The orchestrator's existing `ON CONFLICT(id) DO UPDATE` makes this safe but wasteful (2× RSS calls). This is documented as a known inefficiency; users who want to deduplicate can disable the bundles after importing. Automating that is explicitly out of scope (see Non-Goals).

### 6. Unsubscribe handling: disable, never delete

When a sync run detects that a previously-imported channel is no longer in the subscription list, the corresponding `sources` row gets `enabled = 0`. The row stays; its `videos` stay; its `consumption` rows stay.

**Rationale:** The user might have the video in their Saved pile. Deleting the source would orphan or cascade-delete that history.

### 7. Orchestrator hook order

`scripts/run-fetchers.ts` becomes: `runMigrations()` → `syncSubscriptionsIfConnected()` → `runOrchestrator()`. The sync runs *before* the ingestion loop so newly-imported sources appear in that same run. If sync fails (network, invalid_grant), it logs and continues — ingestion of already-known sources is independent.

**Alternative:** Sync after ingestion (so a slow sync doesn't delay the fetch). Rejected — the latency cost of one API call (~500ms) is negligible next to the RSS fetch loop (~20s across 25 channels).

### 8. Settings page is an RSC; connect/disconnect are form submits

`/settings/youtube` renders server-side using direct DB reads (consistent with the rest of the app). The "Connect" button is a `<form action="/api/youtube/oauth/authorize">` — no client JS needed. Disconnect is a POST that deletes the `oauth_tokens` row and optionally `UPDATE sources SET enabled = 0 WHERE id LIKE 'youtube_channel_%_user'`. Re-sync is a POST to `/api/youtube/subscriptions/sync`.

## Risks / Trade-offs

- **[Risk] Google API quota exhaustion** → Mitigation: subscription sync is one call per ~100 subs (paginated) per cron tick = well within the 10,000 units/day default. We never call `videos.list` or `search.list`. Quota usage ≈ 2 units/day.
- **[Risk] Refresh token revoked by user (via Google security settings)** → Mitigation: the API client catches `invalid_grant` and the settings page renders a "Reconnect YouTube" prompt. Ingestion of existing sources is unaffected because RSS doesn't use the token.
- **[Risk] User imports subscriptions, then later disables OAuth. Orphaned `youtube_channel_%_user` sources keep polling** → Acceptable. The sources still work (RSS is public); the user just won't see new subscriptions. They can delete the sources manually. Documented in RUNBOOK.
- **[Risk] Duplicate RSS polling between seed bundles and user sources** → Known, documented (Decision 5). At single-user scale and 30-min cadence, the duplicate fetch is harmless. If it becomes a problem, a future change can dedupe at the orchestrator level.
- **[Risk] Loopback redirect port collision** → The redirect URI is hardcoded to `:6060`. If the user ever runs the dev server on a different port, OAuth breaks until they update Google Cloud Console. Mitigation: document the requirement prominently in `.env.example` and the RUNBOOK; fail loudly in `/authorize` if the runtime port differs from the registered URI.

## Migration Plan

1. Apply new migration (if any — likely none; `oauth_tokens` already exists).
2. User creates an OAuth client in Google Cloud Console, adds `YOUTUBE_OAUTH_CLIENT_ID` and `YOUTUBE_OAUTH_CLIENT_SECRET` to `.env`.
3. User restarts the dev server, navigates to `/settings/youtube`, clicks Connect, consents, returns to the app with tokens stored.
4. Initial sync runs automatically on callback. Subsequent syncs happen on each cron tick.
5. User optionally disables the categorical seed sources (`UPDATE sources SET enabled = 0 WHERE id LIKE 'youtube_%' AND id NOT LIKE '%_user'`) after verifying their user sources cover the channels they care about.

**Rollback:** disconnect in UI (deletes token) and/or `UPDATE sources SET enabled = 0 WHERE id LIKE '%_user'`. Categorical bundles remain untouched throughout, so rollback restores the pre-change state.

## Open Questions

- **Subscription order:** the YouTube API returns subs in an unspecified order. Do we want to sort them anywhere in the UI? Probably not — the user interacts with videos in the inbox, not the sources list. Defer.
- **Sync cadence:** 30 minutes matches the RSS fetch cadence. Could go longer (subs change less often than video uploads) but saving 1 API call per hour isn't worth a second config dimension. Defer.
- **Should the settings page show a per-channel list?** For v1, a count + "View imported channels" link that goes to a simple table is enough. Refinement deferred unless the user asks.
