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
The system SHALL provision an `oauth_tokens` table with columns: `provider` (primary key), `access_token`, `refresh_token`, `expires_at`, `scope`, `updated_at`. The table SHALL exist but remain empty; no code path in this change reads or writes it.

#### Scenario: Table exists post-migration
- **WHEN** migrations are applied
- **THEN** the `oauth_tokens` table SHALL exist and be empty

### Requirement: Highlights stub table
The system SHALL provision a `highlights` table with columns: `id` (autoincrement primary key), `video_id` (references `videos.id`), `timestamp_seconds`, `text` (nullable), `created_at`. The table SHALL exist but remain empty; no code path in this change reads or writes it.

#### Scenario: Table exists post-migration
- **WHEN** migrations are applied
- **THEN** the `highlights` table SHALL exist and be empty
