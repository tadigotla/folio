## ADDED Requirements

### Requirement: Videos table schema
The system SHALL persist videos in a `videos` table with the following columns: `id` (YouTube video ID, primary key), `title`, `description`, `channel_id`, `duration_seconds`, `published_at`, `thumbnail_url`, `source_url`, `is_live_now` (0/1), `scheduled_start` (nullable, set only when a future live stream is announced), `discovered_at`, `last_checked_at`, `updated_at`, `first_seen_at`, `raw` (JSON blob of the API/RSS response).

#### Scenario: Video inserted from YouTube RSS
- **WHEN** the ingestion pipeline processes a new YouTube video ID `abc123`
- **THEN** a row SHALL be inserted into `videos` with `id = 'abc123'`, `first_seen_at` and `discovered_at` set to the current UTC time, and `is_live_now = 0` unless the source indicates otherwise

#### Scenario: Video re-seen on subsequent fetch
- **WHEN** the ingestion pipeline processes a video whose ID already exists in `videos`
- **THEN** `title`, `description`, `duration_seconds`, `is_live_now`, `scheduled_start`, `thumbnail_url`, `last_checked_at`, `updated_at`, and `raw` SHALL be updated while `first_seen_at` and `discovered_at` are preserved

### Requirement: Channels table schema
The system SHALL persist channels in a `channels` table with columns: `id` (YouTube channel ID, e.g. `UCxxx`, primary key), `name`, `handle` (nullable, e.g. `@foo`), `subscribed` (0/1, indicates the user is subscribed on YouTube), `first_seen_at`, `last_checked_at`.

#### Scenario: Channel auto-registered from video ingestion
- **WHEN** a video is ingested whose `channel_id` does not yet exist in `channels`
- **THEN** a row SHALL be inserted into `channels` with the channel ID and name extracted from the video's source data, and `subscribed = 0` unless a later import marks it otherwise

#### Scenario: Video references existing channel
- **WHEN** a video is ingested whose `channel_id` already exists in `channels`
- **THEN** no new channel row SHALL be created; `last_checked_at` on the existing row SHALL be updated

### Requirement: Consumption lifecycle table
The system SHALL persist per-video lifecycle state in a `consumption` table with columns: `video_id` (primary key, references `videos.id`), `status` (one of `inbox`, `saved`, `in_progress`, `archived`, `dismissed`), `last_viewed_at` (nullable), `status_changed_at` (UTC ISO), `last_position_seconds` (nullable INTEGER — seconds into the video where the user last paused).

#### Scenario: Newly ingested video defaults to inbox
- **WHEN** a video is inserted into `videos` for the first time
- **THEN** a corresponding `consumption` row SHALL be created with `status = 'inbox'` and `status_changed_at` set to the current UTC time

#### Scenario: User saves an inbox video
- **WHEN** the user triggers the save action on a video whose `consumption.status = 'inbox'`
- **THEN** the row SHALL be updated to `status = 'saved'` and `status_changed_at` SHALL be set to the current UTC time

#### Scenario: User dismisses an inbox video
- **WHEN** the user triggers the dismiss action on a video whose `consumption.status = 'inbox'`
- **THEN** the row SHALL be updated to `status = 'dismissed'` and `status_changed_at` SHALL be set to the current UTC time

#### Scenario: User archives a saved or in-progress video
- **WHEN** the user triggers the archive action on a video whose `consumption.status` is `saved` or `in_progress`
- **THEN** the row SHALL be updated to `status = 'archived'` and `status_changed_at` SHALL be set to the current UTC time

#### Scenario: Position persisted on pause
- **WHEN** a playback 'pause' event is received for a video whose consumption row exists
- **THEN** `last_position_seconds` SHALL be updated to the reported position and `last_viewed_at` SHALL be set to the current UTC time

#### Scenario: Position cleared on archive
- **WHEN** a video auto-transitions from `in_progress` to `archived` via the 'end' playback action
- **THEN** `last_position_seconds` SHALL be set to NULL

### Requirement: Legal consumption status transitions
The system SHALL enforce the following transitions at the application layer: `inbox → saved`, `inbox → dismissed`, `saved → in_progress`, `saved → archived`, `saved → dismissed`, `in_progress → archived`, `in_progress → saved`, `archived → saved`, `archived → in_progress`, `dismissed → inbox`. All other transitions SHALL be rejected with an error.

#### Scenario: Archived video re-enters in-progress via playback
- **WHEN** a video with `consumption.status = 'archived'` receives a playback 'start' action
- **THEN** the status SHALL transition directly to `in_progress` (not via `saved`)

#### Scenario: Illegal transition is rejected
- **WHEN** the user attempts to move a video directly from `dismissed` to `saved`
- **THEN** the state change SHALL be rejected and the underlying row SHALL be unchanged

### Requirement: Playback progress endpoint
The system SHALL expose a `POST /api/consumption-progress` endpoint accepting a JSON payload of the form `{ videoId: string, action: 'start' | 'tick' | 'pause' | 'end', position?: number }`. The endpoint SHALL be distinct from `POST /api/consumption`, which remains the channel for explicit user-initiated transitions.

#### Scenario: Malformed payload
- **WHEN** the endpoint receives a payload missing `videoId` or with `action` outside the allowed set
- **THEN** it SHALL respond with HTTP 400

#### Scenario: Successful progress write
- **WHEN** the endpoint receives a well-formed 'tick' payload
- **THEN** it SHALL return HTTP 204 and the video's `last_position_seconds` SHALL be updated to `position`

#### Scenario: Beacon content-type accepted
- **WHEN** the endpoint receives a request with `Content-Type: text/plain;charset=UTF-8` (as sent by `navigator.sendBeacon`) whose body parses as valid JSON
- **THEN** the endpoint SHALL process it as if it were `application/json`

### Requirement: Auto-transition on playback 'start'
When a 'start' action is received for a video, the system SHALL transition `consumption.status` according to the current status:

- `inbox` → first transition to `saved`, then to `in_progress`, both within a single database transaction
- `saved` → `in_progress`
- `archived` → `in_progress`
- `in_progress` → no status change; only `last_viewed_at` is touched
- `dismissed` → no status change, no position write; the progress event SHALL be ignored silently

#### Scenario: Inbox video played for the first time
- **WHEN** a 'start' action is received for a video whose `consumption.status = 'inbox'`
- **THEN** the status SHALL be `in_progress` after the request completes, with `saved` having been traversed inside the same transaction

#### Scenario: Dismissed video played via direct URL
- **WHEN** a 'start' action is received for a video whose `consumption.status = 'dismissed'`
- **THEN** the status SHALL remain `dismissed` and no `last_position_seconds` write SHALL occur

### Requirement: Auto-archive on playback 'end'
When an 'end' action is received for a video whose `consumption.status = 'in_progress'`, the system SHALL transition the status to `archived` and clear `last_position_seconds`. When 'end' is received for any other status, the system SHALL no-op.

#### Scenario: Natural video completion
- **WHEN** the player reports natural end-of-video and the status was `in_progress`
- **THEN** the status SHALL be `archived` and `last_position_seconds` SHALL be NULL

#### Scenario: 'End' for a non-in-progress video
- **WHEN** an 'end' action is received for a video whose status is `saved`
- **THEN** the status SHALL remain `saved` and no column SHALL be modified

### Requirement: Live-as-facet flag
The system SHALL represent live streams as a facet of a video via `is_live_now` and `scheduled_start`, not as a separate lifecycle state. The `consumption.status` of a live video SHALL be determined solely by user action, independent of live-ness.

#### Scenario: Live video can sit in any consumption state
- **WHEN** a video has `is_live_now = 1` and the user has previously saved it
- **THEN** `consumption.status` SHALL remain `saved` (or whatever the user last set), not be auto-promoted

### Requirement: OAuth tokens stub table
The system SHALL provision an `oauth_tokens` table with columns: `provider` (primary key), `access_token`, `refresh_token`, `expires_at`, `scope`, `updated_at`. The table SHALL be populated by the `youtube-oauth` capability; it is no longer a stub. Exactly zero or one row per provider value SHALL exist at any time. A row for `provider = 'youtube'` indicates the user has connected their YouTube account; absence indicates disconnected state.

#### Scenario: Table exists post-migration
- **WHEN** migrations are applied
- **THEN** the `oauth_tokens` table SHALL exist with the column schema above

#### Scenario: Connected-state invariant
- **WHEN** the app is running and any module needs to check YouTube connection state
- **THEN** the presence of a row with `provider = 'youtube'` in `oauth_tokens` SHALL be the single source of truth for "connected"

#### Scenario: Disconnected-state invariant
- **WHEN** the user disconnects via `/api/youtube/oauth/disconnect`
- **THEN** the row for `provider = 'youtube'` SHALL be deleted, and no other state (videos, channels, consumption, provenance) SHALL be modified as a side-effect

### Requirement: Highlights stub table
The system SHALL provision a `highlights` table with columns: `id` (autoincrement primary key), `video_id` (references `videos.id`), `timestamp_seconds`, `text` (nullable), `created_at`. The table SHALL exist but remain empty; no code path in this change reads or writes it.

#### Scenario: Table exists post-migration
- **WHEN** migrations are applied
- **THEN** the `highlights` table SHALL exist and be empty

### Requirement: Video embeddings table
The application SHALL maintain a `video_embeddings` table with one row per (video_id, provider, model) triple. Embeddings SHALL be recomputable from the current enrichment + metadata, and the table SHALL be the single source of truth for semantic queries in later phases (agent ranking, cluster assignment).

#### Scenario: Adding a new video produces an embedding on next build
- **GIVEN** a new video has been imported (e.g. from a subscription-upload refresh)
- **AND** `just taste-build` is invoked
- **WHEN** the embed step runs
- **THEN** a `video_embeddings` row SHALL exist for that video under the configured provider + model
- **AND** re-running `just taste-build` without new videos SHALL NOT re-compute any existing embedding

#### Scenario: Switching embedding providers preserves prior generations
- **GIVEN** embeddings exist under `provider='openai'`
- **WHEN** `EMBEDDING_PROVIDER=bge-local` is set and `just taste-build` is invoked
- **THEN** new rows SHALL be written with the new `(provider, model)` key
- **AND** the original OpenAI-generated rows SHALL remain untouched
- **AND** queries that compare embeddings SHALL filter to a single `(provider, model)` pair

### Requirement: Video enrichment table
The application SHALL maintain a `video_enrichment` table where each row holds a human-readable ~50-word summary plus a JSON array of three topic tags for the video. Enrichment SHALL be produced by a locally-run Ollama model (no cloud inference) to keep bulk-processing cost at zero.

#### Scenario: A fresh build enriches every corpus video
- **GIVEN** an empty `video_enrichment` table
- **WHEN** `just taste-build` runs to completion against a corpus of N videos
- **THEN** `video_enrichment` SHALL contain approximately N rows (allowing for videos missing both title and description, which are skipped)
- **AND** each row's `summary` SHALL be non-empty
- **AND** each row's `topic_tags` SHALL parse as a JSON array of three strings

#### Scenario: Ollama unavailable fails cleanly
- **GIVEN** no Ollama server is reachable at `OLLAMA_HOST`
- **WHEN** `scripts/taste/enrich.ts` is invoked
- **THEN** the script SHALL exit non-zero
- **AND** the error message SHALL reference the runbook's "Taste substrate" section
- **AND** no partial enrichment rows SHALL be written

### Requirement: Video transcripts table
The application SHALL attempt to fetch YouTube auto-captions for each corpus video via a free public endpoint and store them in a `video_transcripts` table. Videos without captions SHALL proceed through enrichment and embedding on title + description alone.

#### Scenario: A video with auto-captions gets a transcript row
- **GIVEN** a video has English auto-captions available on YouTube
- **WHEN** the transcript-fetch step runs
- **THEN** a `video_transcripts` row SHALL be written with `source='youtube-captions'`
- **AND** the row's `text` field SHALL be non-empty

#### Scenario: A video without captions is skipped without error
- **GIVEN** a video has no captions
- **WHEN** the transcript-fetch step runs
- **THEN** no `video_transcripts` row SHALL be written for that video
- **AND** the script SHALL continue processing subsequent videos without error

### Requirement: Taste clusters table
The application SHALL maintain a `taste_clusters` table whose active rows describe the shape of the user's taste, computed from the embeddings of videos whose `video_provenance.source_kind = 'like'`. Each cluster has a centroid, an optional user-provided label, a weight (default 1.0), and timestamps.

#### Scenario: Clustering runs produce between 5 and 15 clusters for ~500 likes
- **GIVEN** the user has 500–600 liked videos with embeddings
- **WHEN** `just taste-cluster` is invoked
- **THEN** `taste_clusters` SHALL contain between 5 and 15 active (non-retired) rows
- **AND** each active cluster SHALL have at least `min_cluster_size` assigned videos (default 6)
- **AND** any cluster failing that threshold SHALL NOT exist; its videos SHALL instead be marked `is_fuzzy=1` against their nearest surviving cluster

#### Scenario: Cluster IDs persist across rebuilds
- **GIVEN** a cluster with ID 3 exists and has user-assigned label "rigor over rhetoric"
- **AND** the user imports 10 new likes that do not substantively shift cluster 3's centroid
- **WHEN** `just taste-cluster` is re-run
- **THEN** the cluster whose centroid best matches cluster 3's former centroid (cosine ≥ 0.85) SHALL retain ID 3
- **AND** its label "rigor over rhetoric" SHALL be unchanged

#### Scenario: A retired cluster is marked, not deleted
- **GIVEN** a cluster with ID 5 and a user label exists
- **AND** after a rebuild no new cluster matches it within the similarity threshold
- **WHEN** `just taste-cluster` completes
- **THEN** the row with ID 5 SHALL have `retired_at` set to the run timestamp
- **AND** the row's `label` SHALL be preserved (for history and potential resurrection)

### Requirement: Video cluster assignments table
The application SHALL maintain a `video_cluster_assignments` table with exactly one row per video, linking it to the active cluster whose centroid is closest by cosine similarity. Videos whose similarity to the nearest cluster falls below a configurable floor (default 0.65) SHALL carry `is_fuzzy=1` so downstream consumers can treat them differently.

#### Scenario: Every corpus video has an assignment row after build
- **GIVEN** a corpus of N videos with embeddings
- **WHEN** `just taste-cluster` completes
- **THEN** `video_cluster_assignments` SHALL contain N rows
- **AND** every row SHALL reference an active (non-retired) cluster

#### Scenario: Low-similarity assignments are marked fuzzy
- **GIVEN** a video whose highest cosine to any active cluster centroid is 0.58
- **WHEN** assignment runs
- **THEN** its row SHALL have `is_fuzzy=1`
- **AND** its `similarity` field SHALL be 0.58
