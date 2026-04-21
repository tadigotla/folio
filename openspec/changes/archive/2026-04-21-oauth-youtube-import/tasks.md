## 1. Environment & config

- [x] 1.1 Add `YOUTUBE_OAUTH_CLIENT_ID` and `YOUTUBE_OAUTH_CLIENT_SECRET` to `.env.example` with a pointer to the RUNBOOK section
- [x] 1.2 Add a "YouTube OAuth" section to `RUNBOOK.md` covering: creating the Google Cloud project, enabling YouTube Data API v3, configuring the OAuth consent screen (External, unverified — single-user local install), adding `http://localhost:6060/api/youtube/oauth/callback` as an authorized redirect URI, and where tokens live (`oauth_tokens` table)
- [x] 1.3 Update `RUNBOOK.md` "Last verified" date
- [x] 1.4 Add a `youtube-sync` verb to `justfile` that runs `tsx scripts/sync-subscriptions.ts` (manual re-sync entry point)

## 2. OAuth client module

- [x] 2.1 Create `src/lib/youtube-oauth.ts` exporting: `buildAuthorizeUrl(state: string)`, `exchangeCodeForTokens(code: string)`, `refreshAccessToken(refreshToken: string)` — each returns a typed `TokenResponse { access_token, refresh_token?, expires_in, scope }`
- [x] 2.2 Export a custom `OAuthRefreshError extends Error` with a `code: 'invalid_grant' | 'network' | 'other'` discriminator
- [x] 2.3 Add `getStoredToken()` and `upsertToken(tokens: TokenResponse)` helpers that read/write `oauth_tokens` using the existing `getDb()` from `src/lib/db.ts`. Compute `expires_at` as `new Date(Date.now() + expires_in * 1000).toISOString()`

## 3. YouTube API client

- [x] 3.1 Create `src/lib/youtube-api.ts` exporting `listSubscriptions(): Promise<{ channelId: string; title: string }[]>` that paginates `subscriptions?mine=true&part=snippet&maxResults=50` until `nextPageToken` is absent
- [x] 3.2 Before each API call, inspect `getStoredToken()`; if `expires_at` is within 60s of now, call `refreshAccessToken`, `upsertToken`, and use the refreshed access token. On `invalid_grant`, throw `OAuthRefreshError` without deleting the token row

## 4. OAuth route handlers

- [x] 4.1 Create `src/app/api/youtube/oauth/authorize/route.ts` (GET) — generate 32-byte state, set `youtube_oauth_state` cookie (HttpOnly, SameSite=Lax, 10 min max-age), redirect to `buildAuthorizeUrl(state)`. Return HTTP 500 with a helpful message if `YOUTUBE_OAUTH_CLIENT_ID` is unset
- [x] 4.2 Create `src/app/api/youtube/oauth/callback/route.ts` (GET) — read `code`, `state`, and `error` query params; handle `error=access_denied` branch by redirecting to `/settings/youtube?error=access_denied`; verify cookie state matches; call `exchangeCodeForTokens`; `upsertToken`; clear the state cookie; trigger initial subscription sync (await it — OK to block callback for a few seconds); redirect to `/settings/youtube?connected=1`
- [x] 4.3 Create `src/app/api/youtube/oauth/disconnect/route.ts` (POST) — delete `oauth_tokens` row; if form body includes `disable_sources=true`, run `UPDATE sources SET enabled = 0 WHERE id LIKE 'youtube_channel_%_user'`; redirect to `/settings/youtube`

## 5. Subscription sync

- [x] 5.1 Create `src/lib/subscription-sync.ts` exporting `syncSubscriptions(): Promise<{ imported, reenabled, disabled }>` — calls `listSubscriptions()`, iterates rows, performs the upsert-or-enable described in spec requirement "Channel-to-source mapping", then disables rows whose channel IDs are no longer present
- [x] 5.2 Track sync results: store `last_subscription_sync_at` and `last_subscription_sync_error` somewhere readable by the settings page. Simplest option: reuse a synthetic row in `sources` with `id = 'youtube_subscriptions_meta'`, `kind = 'meta'`, `enabled = 0` (won't be picked up by the fetcher registry), using `last_fetched_at` and `last_error` fields. Alternative: new `kv` table — decide at impl time. Confirm decision in the PR description
- [x] 5.3 Create `src/app/api/youtube/subscriptions/sync/route.ts` (POST) — guard: 409 if no token, 401 on `OAuthRefreshError`, otherwise call `syncSubscriptions()` and respond with JSON body `{ imported, reenabled, disabled }`
- [x] 5.4 Create `scripts/sync-subscriptions.ts` (tsx entry point for `just youtube-sync`) that runs migrations then calls `syncSubscriptions()`, prints the result, and exits

## 6. Orchestrator hook

- [x] 6.1 In `scripts/run-fetchers.ts`, between `runMigrations()` and `runOrchestrator()`, call a new `syncSubscriptionsIfConnected()` wrapper that: returns early if no token row exists; otherwise calls `syncSubscriptions()` inside a try/catch; logs success (`imported=X reenabled=Y disabled=Z`) or error (stderr + writes to the meta row from 5.2); never throws
- [x] 6.2 Add unit-level smoke: `tsx scripts/run-fetchers.ts` with no token in the DB SHALL run through without hitting the network for OAuth and SHALL produce no `oauth_tokens` writes (verified by inspection: `syncSubscriptionsIfConnected` returns early when `getStoredToken()` is null; no other code path writes `oauth_tokens`)

## 7. Settings page

- [x] 7.1 Create `src/app/settings/youtube/page.tsx` as an RSC reading: the `oauth_tokens` row, the meta sync row from 5.2, and `SELECT COUNT(*) FILTER (WHERE enabled = 1), COUNT(*) FILTER (WHERE enabled = 0) FROM sources WHERE id LIKE 'youtube_channel_%_user'`
- [x] 7.2 Render four branches: (a) not-connected → Connect button form posting to `/api/youtube/oauth/authorize`; (b) connected & synced → last-sync timestamp via `toLocalDateTime`, imported/disabled counts, Re-sync form and Disconnect form; (c) connected but last sync failed with `OAuthRefreshError` → red banner "Reconnect required" linking to authorize; (d) URL params `?connected=1` / `?error=access_denied` render small success/error flash
- [x] 7.3 Add a nav link from `/` to `/settings/youtube` in `src/app/page.tsx`

## 8. Specs + verification

- [x] 8.1 Verify all three spec files parse (`openspec status --change oauth-youtube-import --json` reports artifacts `done`)
- [x] 8.2 `npm run lint`
- [x] 8.3 `npm run build`
- [x] 8.4 Manual: create a Google Cloud OAuth client, populate `.env`, restart dev server, click Connect on `/settings/youtube`, consent, confirm redirect lands on `/settings/youtube?connected=1` with an imported-channel count > 0
- [x] 8.5 Manual: verify `sources` table contains `youtube_channel_UC..._user` rows with `enabled = 1` matching the user's YouTube subs (verified 210 rows, all `enabled = 1`)
- [ ] 8.6 Manual: unsubscribe from a channel on YouTube, click Re-sync, confirm that row flips to `enabled = 0` and no `videos` / `consumption` rows are deleted
- [ ] 8.7 Manual: wait for (or force) an access-token expiry, trigger a sync, confirm transparent refresh and that `oauth_tokens.expires_at` advances
- [ ] 8.8 Manual: click Disconnect (without disable-sources), verify `oauth_tokens` row is gone and user sources still exist/fetch
- [x] 8.9 Manual: run `just fetch` (or wait for cron) with a connected token and confirm new subs appear as sources AND their RSS videos land in `inbox` (verified: 3,835 videos populated, 3,813 landed in inbox)
