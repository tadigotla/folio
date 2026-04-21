## ADDED Requirements

### Requirement: Video provenance table
The system SHALL provision a `video_provenance` table that records every user action that brought a video into the corpus, many-to-one with `videos`. Columns: `video_id TEXT REFERENCES videos(id) ON DELETE CASCADE`, `source_kind TEXT CHECK IN ('like', 'subscription_upload', 'playlist')`, `source_ref TEXT NULL`, `imported_at TEXT NOT NULL`, `signal_weight REAL NOT NULL`. Composite primary key `(video_id, source_kind, source_ref)`. `source_ref` SHALL be NULL for `like` and `subscription_upload`, and the YouTube playlist ID for `playlist`. `signal_weight` SHALL be 1.0 for `like`, 0.7 for `playlist`, 0.3 for `subscription_upload`.

#### Scenario: Video with multiple provenances
- **WHEN** the user imports a video from Likes AND the same video appears in an imported playlist
- **THEN** two `video_provenance` rows SHALL exist for that video — one `(video_id, 'like', NULL)` and one `(video_id, 'playlist', <playlist_id>)`

#### Scenario: Re-import is idempotent
- **WHEN** the user imports Likes a second time and a `(video_id, 'like', NULL)` provenance row already exists
- **THEN** the existing row's `imported_at` SHALL be updated to the current UTC time and no duplicate row SHALL be created

#### Scenario: Signal weight per kind
- **WHEN** a video is imported via Likes
- **THEN** its `video_provenance.signal_weight` SHALL equal 1.0
- **AND WHEN** imported via a user playlist, 0.7
- **AND WHEN** imported via subscription uploads, 0.3

### Requirement: Import log table
The system SHALL provision an `import_log` table that records every import run. Columns: `id INTEGER PRIMARY KEY AUTOINCREMENT`, `kind TEXT NOT NULL`, `source_ref TEXT NULL`, `started_at TEXT NOT NULL`, `finished_at TEXT NULL`, `status TEXT NOT NULL` (one of `running`, `ok`, `error`), `videos_new INTEGER DEFAULT 0`, `videos_updated INTEGER DEFAULT 0`, `channels_new INTEGER DEFAULT 0`, `error TEXT NULL`. Rows are append-only.

#### Scenario: Successful import writes a log row
- **WHEN** an import endpoint completes successfully
- **THEN** one `import_log` row SHALL exist with `status = 'ok'`, `finished_at` set, and the tallied counts

#### Scenario: Failed import writes a log row
- **WHEN** an import endpoint throws before finishing
- **THEN** one `import_log` row SHALL exist with `status = 'error'`, `finished_at` set, and the error message captured in `error`

### Requirement: Likes import endpoint
The system SHALL expose `POST /api/youtube/import/likes` that paginates `playlistItems.list?playlistId=LL&mine=true&part=snippet,contentDetails&maxResults=50` until no more pages remain, upserts each returned video (and its channel), and writes a `video_provenance` row with `source_kind = 'like'`, `source_ref = NULL`, and `signal_weight = 1.0` for each.

#### Scenario: New like imported
- **WHEN** the endpoint runs and a returned video does NOT exist in `videos`
- **THEN** a `videos` row SHALL be inserted, a `channels` row SHALL be upserted, a `consumption` row SHALL be inserted with `status = 'saved'`, and a `video_provenance` row with `source_kind = 'like'` SHALL be inserted

#### Scenario: Existing video re-liked
- **WHEN** the endpoint runs and a returned video already exists with `consumption.status = 'in_progress'`
- **THEN** the `videos` row's mutable metadata (title, description, duration_seconds, thumbnail_url, updated_at) SHALL be updated, the `consumption` row SHALL be left untouched, and the `video_provenance` row's `imported_at` SHALL be updated

#### Scenario: Token missing
- **WHEN** the endpoint is called and no `oauth_tokens` row exists for `provider = 'youtube'`
- **THEN** the endpoint SHALL respond with HTTP 409 and `{ needs_reconnect: true }`; no DB writes SHALL occur

#### Scenario: Token revoked
- **WHEN** the refresh call to Google returns `invalid_grant`
- **THEN** the endpoint SHALL respond with HTTP 409 and `{ needs_reconnect: true }`; the `oauth_tokens` row SHALL NOT be deleted

### Requirement: Subscriptions import endpoint
The system SHALL expose `POST /api/youtube/import/subscriptions` that paginates `subscriptions.list?mine=true&part=snippet&maxResults=50`, then for each subscribed channel resolves the channel's uploads playlist via `channels.list?id=<UCxxx>&part=contentDetails` and paginates `playlistItems.list?playlistId=<uploads>&maxResults=50` until `YOUTUBE_SUBSCRIPTION_UPLOAD_LIMIT` (default 25) most-recent videos have been collected or the playlist is exhausted. For each collected video, upsert video + channel and write a `video_provenance` row with `source_kind = 'subscription_upload'`, `source_ref = NULL`, `signal_weight = 0.3`.

#### Scenario: New subscription video imported
- **WHEN** the endpoint runs and a returned video does NOT exist in `videos`
- **THEN** a `videos` row SHALL be inserted, a `channels` row SHALL be upserted, a `consumption` row SHALL be inserted with `status = 'inbox'`, and a `video_provenance` row with `source_kind = 'subscription_upload'` SHALL be inserted

#### Scenario: Subscription video already liked
- **WHEN** the endpoint runs and a returned video already exists with a `like` provenance and `consumption.status = 'saved'`
- **THEN** the `consumption` row SHALL remain `saved` (not demoted to `inbox`); a new `video_provenance` row with `source_kind = 'subscription_upload'` SHALL be inserted alongside the existing `like` row

#### Scenario: Per-channel limit honored
- **WHEN** the endpoint runs and a channel's uploads playlist contains 200 videos, with `YOUTUBE_SUBSCRIPTION_UPLOAD_LIMIT = 25`
- **THEN** exactly the 25 most-recent videos SHALL be imported for that channel

### Requirement: Playlists listing endpoint
The system SHALL expose `GET /api/youtube/import/playlists` that paginates `playlists.list?mine=true&part=snippet,contentDetails&maxResults=50` and returns `{ playlists: [{ id, title, item_count, thumbnail_url }] }`. This endpoint SHALL NOT perform any imports or DB writes.

#### Scenario: Connected account lists playlists
- **WHEN** the endpoint is called and a valid token exists
- **THEN** the response SHALL be HTTP 200 and contain every playlist owned by the authenticated user, with `item_count` from the API's `contentDetails.itemCount`

#### Scenario: Not connected
- **WHEN** the endpoint is called and no token row exists
- **THEN** the response SHALL be HTTP 409 with `{ needs_reconnect: true }`

### Requirement: Playlist import endpoint
The system SHALL expose `POST /api/youtube/import/playlists/:id` that paginates `playlistItems.list?playlistId=:id&part=snippet,contentDetails&maxResults=50` until exhausted, upserts each returned video + channel, and writes a `video_provenance` row per item with `source_kind = 'playlist'`, `source_ref = :id`, `signal_weight = 0.7`.

#### Scenario: New playlist video imported
- **WHEN** the endpoint runs and a returned video does NOT exist
- **THEN** a `videos` row SHALL be inserted, a `consumption` row SHALL be inserted with `status = 'saved'`, and a `video_provenance` row with `source_kind = 'playlist'` and `source_ref = :id` SHALL be inserted

#### Scenario: Re-import of playlist is idempotent
- **WHEN** the endpoint is called twice with the same playlist ID
- **THEN** no duplicate `videos` rows SHALL exist; the `video_provenance` rows for that playlist SHALL have their `imported_at` updated to the second run's time

#### Scenario: Unauthorized playlist
- **WHEN** the endpoint is called with a playlist ID that is not owned by the authenticated user and returns 404 from Google
- **THEN** the endpoint SHALL respond with HTTP 404 and `{ error: 'not_found' }`; no DB writes SHALL occur

### Requirement: Idempotent upsert and user-state preservation
All import endpoints SHALL upsert videos using `INSERT ... ON CONFLICT(id) DO UPDATE` keyed by the raw YouTube video ID. Upserts SHALL update mutable metadata (title, description, duration_seconds, thumbnail_url, updated_at) while preserving `first_seen_at`, `discovered_at`, and the existing `consumption` row (status, status_changed_at, last_position_seconds). When an import inserts a NEW `videos` row, it SHALL also insert a `consumption` row with the provenance-appropriate default status.

#### Scenario: Consumption state survives re-import
- **WHEN** a video was imported via subscription_upload (default `inbox`), the user saved it (status = `saved`), and the subscription import runs again
- **THEN** the `consumption.status` SHALL remain `saved`; the `videos` row's metadata SHALL be refreshed from the latest API response; the provenance row's `imported_at` SHALL be updated

### Requirement: Settings page for YouTube library
The system SHALL expose `/settings/youtube` as a server-rendered page that shows connection state and three import surfaces (Likes, Subscriptions, Playlists). For each of Likes and Subscriptions, the page SHALL render a primary "Import" button and the `finished_at` of the most recent successful `import_log` row of that kind. For Playlists, the page SHALL render a "Load playlists" button that calls `GET /api/youtube/import/playlists` and displays the returned list, each with a per-playlist "Import" button and the last-import timestamp if any.

#### Scenario: Not connected
- **WHEN** no `oauth_tokens` row exists for `provider = 'youtube'`
- **THEN** the page SHALL render a "Connect YouTube account" button that submits to `/api/youtube/oauth/authorize`, and SHALL NOT render any import controls

#### Scenario: Connected, never imported
- **WHEN** a token row exists and no `import_log` rows exist
- **THEN** each import section SHALL show "Last import: never" and its "Import" button SHALL be enabled

#### Scenario: Import result displayed inline
- **WHEN** the user clicks an "Import" button and the POST returns `{ videos_new: N, videos_updated: M, channels_new: K }`
- **THEN** the page SHALL display a success indicator near that button with the counts, and the section's last-import timestamp SHALL refresh

#### Scenario: Reconnect required after token revocation
- **WHEN** any import endpoint responds with `{ needs_reconnect: true }`
- **THEN** the page SHALL render a prominent "Reconnect YouTube" banner linking to `/api/youtube/oauth/authorize`

### Requirement: Env-configured upload limit
The system SHALL read `YOUTUBE_SUBSCRIPTION_UPLOAD_LIMIT` from the environment, defaulting to `25` when unset or non-numeric. This value caps the number of videos imported per subscribed channel in a single subscription-import run.

#### Scenario: Default when unset
- **WHEN** `YOUTUBE_SUBSCRIPTION_UPLOAD_LIMIT` is not set in `.env`
- **THEN** the import SHALL collect up to 25 videos per channel

#### Scenario: Override honored
- **WHEN** `YOUTUBE_SUBSCRIPTION_UPLOAD_LIMIT = 10` is set
- **THEN** the import SHALL collect up to 10 videos per channel
