## 1. Pre-flight (user-executed, documented in RUNBOOK)

- [ ] 1.1 Run `just backup-db` and confirm the timestamped backup file exists. The subsequent migration is destructive; without this step, rollback requires re-importing from YouTube.
- [ ] 1.2 Run `just cron-uninstall` while the verb still exists. (It is being deleted in this change; this is the last opportunity to remove the system cron entry cleanly.)
- [ ] 1.3 In Google Cloud Console, create an OAuth 2.0 Client ID (Web application) and register `http://localhost:6060/api/youtube/oauth/callback` as an authorized redirect URI. Enable the YouTube Data API v3 on the project.
- [ ] 1.4 Add `YOUTUBE_OAUTH_CLIENT_ID`, `YOUTUBE_OAUTH_CLIENT_SECRET`, and optionally `YOUTUBE_SUBSCRIPTION_UPLOAD_LIMIT` to `.env`. `.env.example` (updated in task 2.x) shows the keys and defaults.

## 2. Destructive migration and schema additions

- [x] 2.1 Write `db/migrations/010_library_pivot.sql`: in a single transaction — `DROP TABLE IF EXISTS sources`, `DROP TABLE IF EXISTS issues`, `DELETE FROM consumption`, `DELETE FROM channel_tags`, `DELETE FROM videos`, `DELETE FROM channels`, `DELETE FROM tags`, `DELETE FROM sections`.
- [x] 2.2 In the same migration, create `video_provenance` with `(video_id, source_kind, source_ref, imported_at, signal_weight)`, composite PK `(video_id, source_kind, source_ref)`, CHECK on `source_kind`, and indexes on `video_id` and `source_kind`. (Deviation: `source_ref` is `NOT NULL DEFAULT ''` with `''` as the sentinel for like/subscription_upload, because SQLite allows duplicate NULLs in a PRIMARY KEY and `ON CONFLICT` would fail to detect idempotent re-imports otherwise.)
- [x] 2.3 In the same migration, create `import_log` with `(id PK AUTOINCREMENT, kind, source_ref, started_at, finished_at, status, videos_new, videos_updated, channels_new, error)`.
- [x] 2.4 In the same migration, create `app_secrets` with `(key PK, value, created_at)` for the OAuth-state signing key's first-run bootstrap.
- [ ] 2.5 Verify the migration runs cleanly on a fresh DB via `rm events.db && npm run dev`, then again against a backed-up copy (DROP/DELETE semantics against non-empty tables). — **Manual (user).**
- [x] 2.6 Extend `src/lib/types.ts` with types for the new tables: `VideoProvenance`, `ImportLog`, and a `ProvenanceKind` union (named `ProvenanceKind`, not `SourceKind`, because the legacy `SourceKind` was removed with the `sources` table).

## 3. OAuth module

- [x] 3.1 Create `src/lib/youtube-oauth.ts` exporting: `buildAuthorizeUrl(state: string): string`, `exchangeCode(code: string): Promise<TokenSet>`, `getAccessToken(): Promise<string>` (lazy refresh per design Decision 4), `disconnect(): void`. `TokenRevokedError` is a typed error thrown by `getAccessToken()` when Google returns `invalid_grant`.
- [x] 3.2 `getAccessToken()` reads `oauth_tokens`, refreshes transparently if within 60 seconds of expiry, writes the refreshed row, returns the current (post-refresh) access token. Use `better-sqlite3` transactions for the read-refresh-write path.
- [x] 3.3 Helper `getOrCreateStateSecret(): string` — reads `app_secrets.key='oauth_state'`, creates a 32-byte random hex value on first call, persists it. Used to sign the state cookie.
- [x] 3.4 Helper `signState()` / `verifyState()` using HMAC-SHA256 over `state + expiry` with the stored secret. Cookie value is `<state>.<expiry_unix>.<hmac>`.
- [x] 3.5 Assert at runtime that `process.env.PORT ?? '6060'` equals `'6060'` in the authorize route; return a clear error page with a RUNBOOK link if not (per design Risk "Loopback redirect port drift").

## 4. OAuth routes

- [x] 4.1 Create `src/app/api/youtube/oauth/authorize/route.ts` — GET handler that generates a state value, sets the signed HttpOnly `SameSite=Lax` cookie with 10-minute expiry, 302-redirects to `https://accounts.google.com/o/oauth2/v2/auth?...` with scope `https://www.googleapis.com/auth/youtube.readonly`, `access_type=offline`, `prompt=consent`.
- [x] 4.2 Authorize route returns HTTP 500 with a RUNBOOK-linked message if `YOUTUBE_OAUTH_CLIENT_ID` is unset.
- [x] 4.3 Create `src/app/api/youtube/oauth/callback/route.ts` — GET handler: verifies the state cookie, exchanges code via `exchangeCode`, upserts `oauth_tokens`, clears the state cookie, 302-redirects to `/settings/youtube?connected=1`. On `error=access_denied` in query, redirect to `/settings/youtube?error=access_denied`. On state mismatch or expiry, HTTP 400 with no writes.
- [x] 4.4 Create `src/app/api/youtube/oauth/disconnect/route.ts` — POST: `DELETE FROM oauth_tokens WHERE provider = 'youtube'`. Returns 204. Never touches `videos`, `channels`, `consumption`, `video_provenance`, or `import_log`. Idempotent (no-op if no row).
- [x] 4.5 Confirm the Next.js 16 route-handler conventions (per `AGENTS.md`: consult `node_modules/next/dist/docs/`) — this was the pitfall flagged in prior changes.

## 5. YouTube Data API client

- [x] 5.1 Create `src/lib/youtube-api.ts` exporting async functions: `listLikedVideos()`, `listSubscriptions()`, `getChannelUploadsPlaylistId(channelId)`, `listPlaylistItems(playlistId, { limit? })`, `listUserPlaylists()`. Each paginates internally until exhaustion or `limit`.
- [x] 5.2 All calls go through a shared `youtubeFetch(url: string)` helper that: calls `getAccessToken()`, issues the request with `Authorization: Bearer <token>`, on 401 forces a refresh and retries once, throws `TokenRevokedError` if the retry also fails.
- [x] 5.3 `listLikedVideos` uses `playlistItems.list` with `playlistId=LL&part=snippet,contentDetails&maxResults=50`.
- [x] 5.4 `listSubscriptions` uses `subscriptions.list?mine=true&part=snippet&maxResults=50`.
- [x] 5.5 `getChannelUploadsPlaylistId` uses `channels.list?id=<UCxxx>&part=contentDetails` and reads `contentDetails.relatedPlaylists.uploads`.
- [x] 5.6 `listPlaylistItems` uses `playlistItems.list?playlistId=<id>&part=snippet,contentDetails&maxResults=50`, breaks out of pagination when `limit` is satisfied.
- [x] 5.7 `listUserPlaylists` uses `playlists.list?mine=true&part=snippet,contentDetails&maxResults=50`.
- [x] 5.8 Parse API responses into a normalized internal type `NormalizedYouTubeVideo { videoId, title, description, channelId, channelName, publishedAt, durationSeconds?, thumbnailUrl }`. Duration is NOT in `playlistItems` responses — leave `durationSeconds` undefined; it's acceptable to have NULL duration in `videos` for Phase 1. (Phase 4 can add a `videos.list` call to backfill if needed.)

## 6. Import module

- [x] 6.1 Create `src/lib/youtube-import.ts` exporting `importLikes()`, `importSubscriptions(limit)`, `listPlaylists()`, `importPlaylist(playlistId)`. Each returns `{ videos_new, videos_updated, channels_new }`.
- [x] 6.2 Each import function opens a single `import_log` row with `status='running'` at start, updates it to `ok` + counts at end, or `error` + message on throw.
- [x] 6.3 `upsertChannel(v: NormalizedYouTubeVideo)` — `INSERT OR IGNORE INTO channels ...`; on existing, `UPDATE name, last_checked_at`. Returns `{ inserted: boolean }`.
- [x] 6.4 `upsertVideo(v, defaultStatus: ConsumptionStatus)` — `INSERT ... ON CONFLICT(id) DO UPDATE SET title=excluded.title, description=excluded.description, thumbnail_url=excluded.thumbnail_url, updated_at=?, last_checked_at=?`. If the INSERT path fires, also INSERT a `consumption` row with `status=defaultStatus, status_changed_at=?`. If the UPDATE path fires, leave `consumption` untouched. Returns `{ inserted: boolean }`.
- [x] 6.5 `writeProvenance(videoId, kind, sourceRef, weight)` — `INSERT INTO video_provenance ... ON CONFLICT(video_id, source_kind, source_ref) DO UPDATE SET imported_at=excluded.imported_at`.
- [x] 6.6 `importLikes` wraps the full loop (fetch → upsert channel → upsert video with `defaultStatus='saved'` → write provenance `kind='like', weight=1.0`). All DB writes per page run inside a transaction.
- [x] 6.7 `importSubscriptions(limit)` iterates subscribed channels. For each: resolve uploads playlist id, fetch up to `limit` most-recent uploads, upsert with `defaultStatus='inbox'`, write provenance `kind='subscription_upload', weight=0.3`. Per-channel try/catch — individual channel failures are logged into `import_log.error` (appended) but don't abort the whole run.
- [x] 6.8 `importPlaylist(playlistId)` — fetch all items, upsert with `defaultStatus='saved'`, write provenance `kind='playlist', source_ref=playlistId, weight=0.7`. On 404 from Google, throw a typed `PlaylistNotFoundError` that routes map to HTTP 404.
- [ ] 6.9 Verify idempotency: import-twice unit test (manual is fine — no test runner per CLAUDE.md) confirms `videos` count stable and `consumption` states unchanged on second run. — **Manual (user).**

## 7. Import API routes

- [x] 7.1 `src/app/api/youtube/import/likes/route.ts` — POST handler calls `importLikes()`. On `TokenRevokedError` returns HTTP 409 `{ needs_reconnect: true }`. On success returns `{ videos_new, videos_updated, channels_new }`. On other error, HTTP 500 with `{ error: message }`.
- [x] 7.2 `src/app/api/youtube/import/subscriptions/route.ts` — POST handler reads `YOUTUBE_SUBSCRIPTION_UPLOAD_LIMIT` (default 25), calls `importSubscriptions(limit)`. Same error contract.
- [x] 7.3 `src/app/api/youtube/import/playlists/route.ts` — GET handler calls `listPlaylists()` and returns `{ playlists: [...] }`. Same `needs_reconnect` contract on revoked token.
- [x] 7.4 `src/app/api/youtube/import/playlists/[id]/route.ts` — POST handler calls `importPlaylist(params.id)`. Maps `PlaylistNotFoundError` to HTTP 404.
- [x] 7.5 Each route validates that a token row exists at call start; if not, returns HTTP 409 `{ needs_reconnect: true }` without calling into the YT API.

## 8. Settings UI

- [x] 8.1 Create `src/app/settings/youtube/page.tsx` — RSC that reads `oauth_tokens` (connection state) and `import_log` (last-import timestamps per kind). Lays out: header + status, Connect/Disconnect form, three import sections (Likes / Subscriptions / Playlists), reconnect banner when applicable.
- [x] 8.2 Extract import-button interactions into a small client component (`src/components/YouTubeImportButton.tsx`) that POSTs to the relevant endpoint, shows a spinner while in-flight, and renders the response counts inline. On `needs_reconnect`, dispatches a custom event the page listens for to show the reconnect banner without a full refresh.
- [x] 8.3 Playlist-list subcomponent (`src/components/YouTubePlaylists.tsx`): "Load my playlists" button hits `GET /api/youtube/import/playlists`. Each returned playlist gets an Import button; last-import timestamp per playlist is read from `import_log WHERE kind='playlist' AND source_ref = playlist.id`.
- [x] 8.4 Disconnect form: POST to `/api/youtube/oauth/disconnect`, RSC refreshes, state transitions to "not connected."
- [x] 8.5 Connect button: HTML `<form action="/api/youtube/oauth/authorize">` — no client JS needed.
- [x] 8.6 `/settings/youtube` is already present in `TopNav` (link was added in a prior change); Phase 1 retains it there.

## 9. Home-page replacement

- [x] 9.1 Replace `src/app/page.tsx` with a minimal RSC that branches on connection + corpus state:
  - No token → "Connect your YouTube account → [Settings]"
  - Token but empty corpus → "Import your library → [Settings]"
  - Token + non-empty corpus → "Your library: N videos across M channels. Browse → [/inbox] [/library]. Composing issues — coming soon."
- [x] 9.2 Delete any imports of `getOrPublishTodaysIssue`, `getIssueOrder`, `loadIssueVideos`, `effectiveCoverId`, `composeIssue` from the home page.

## 10. Deletions

- [x] 10.1 Delete directory `src/fetchers/` in entirety.
- [x] 10.2 Delete `scripts/run-fetchers.ts`.
- [x] 10.3 Delete `db/seed-sources.ts`.
- [x] 10.4 Delete `src/lib/issue.ts`.
- [x] 10.5 Delete `src/app/api/issues/` directory.
- [x] 10.6 Remove the `fetch` script from `package.json`.
- [x] 10.7 Grep for any remaining imports/references to `src/fetchers`, `run-fetchers`, `seed-sources`, `src/lib/issue`, `/api/issues` — delete or rewrite each. Also deleted the orphaned `src/lib/subscription-sync.ts`, `scripts/sync-subscriptions.ts`, `src/app/api/youtube/subscriptions/sync/route.ts` (parts of the archived oauth proposal, superseded by the new import module), and the now-orphaned issue components `src/components/issue/{Briefs,Cover,Featured,Masthead,Departments,LiveNowBadge,PinCoverAction,TagsStrip}.tsx`. Rewrote `src/app/watch/[id]/page.tsx`, `MobileWatch.tsx`, `NextPieceFooter.tsx`, and `WatchKeyboard.tsx` to drop issue-order navigation and the `.`-to-pin keybinding.
- [x] 10.8 Remove types no longer in use from `src/lib/types.ts` — `Source`, `Fetcher`, `NormalizedVideo`, `SourceKind`, `Issue` types removed. Kept `ConsumptionStatus`, `Video`, `Channel`, `Section`, `Tag`, `Consumption`.

## 11. Operational invariants (justfile + RUNBOOK)

- [x] 11.1 Remove verbs from `justfile`: `fetch`, `cron-install`, `cron-uninstall`, `seed` (also `youtube-sync`).
- [x] 11.2 Add verb `youtube-auth`: prints `http://localhost:6060/api/youtube/oauth/authorize` and a hint to open it in a browser.
- [x] 11.3 Add verb `youtube-import KIND=...` where KIND is `likes | subscriptions | playlist`. For `playlist`, accept an additional `ID=...` argument. Invokes the relevant endpoint via `curl` against `http://localhost:6060`.
- [x] 11.4 Update `RUNBOOK.md`:
  - Remove the "Ingestion (RSS)" and "System cron" sections.
  - Add "YouTube OAuth" section: Google Cloud Console setup (enable YT Data API v3, create OAuth Client ID, authorized redirect), env vars, the unverified-app warning walkthrough ("Advanced → Go to Folio (unsafe)"), how to force re-auth (Disconnect button; revokes can be done in Google security settings).
  - Add "Importing your library" section: the three manual buttons, what each imports, expected counts/timings, signal weight semantics.
  - Add "Data reset" section: the one-time migration, the mandatory `just backup-db` step, the rollback procedure (restore backup + `git revert` the migration commit).
  - Update the `Last verified:` line to today's date.
- [x] 11.5 Update `.env.example`:
  - Remove any RSS-related vars if present.
  - Add `YOUTUBE_OAUTH_CLIENT_ID=`, `YOUTUBE_OAUTH_CLIENT_SECRET=`, `# YOUTUBE_SUBSCRIPTION_UPLOAD_LIMIT=25 (optional, default 25)`.

## 12. Verification

- [x] 12.1 `npm run lint` passes.
- [x] 12.2 `npm run build` passes (no references to deleted modules remain).
- [ ] 12.3 Manual flow: fresh DB → `/settings/youtube` → Connect → consent → land back at `/settings/youtube?connected=1` → click Import Likes → see counts → visit `/library` → confirm Likes are present with `status=saved`. — **Manual (user).**
- [ ] 12.4 Manual flow: click Import Subscriptions → visit `/inbox` → confirm subscription uploads appear with `status=inbox`. — **Manual (user).**
- [ ] 12.5 Manual flow: click Load playlists → pick one → Import → confirm it appears in `/library` with `status=saved` and has a `video_provenance` row with `source_kind='playlist'` and the playlist ID in `source_ref`. — **Manual (user).**
- [ ] 12.6 Manual flow: re-run any import → confirm no duplicate videos; confirm user-state preservation (save an inbox video, re-import subscriptions, verify it remains `saved`). — **Manual (user).**
- [ ] 12.7 Manual flow: click Disconnect → confirm token row is gone, corpus (videos/channels/consumption/provenance) is intact. — **Manual (user).**
- [ ] 12.8 Manual flow: revoke the refresh token in Google security settings → trigger an import → confirm HTTP 409 + reconnect banner appears; token row is NOT automatically deleted. — **Manual (user).**
- [ ] 12.9 Confirm the system cron entry is uninstalled (from task 1.2) and that no cron/launchd job attempts to run the removed `fetch` script. — **Manual (user).**
