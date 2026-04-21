## MODIFIED Requirements

### Requirement: Consumption lifecycle table
The system SHALL persist per-video lifecycle state in a `consumption` table with columns: `video_id` (primary key, references `videos.id`), `status` (one of `inbox`, `saved`, `in_progress`, `archived`, `dismissed`), `last_viewed_at` (nullable), `status_changed_at` (UTC ISO), `last_position_seconds` (nullable INTEGER — seconds into the video where the user last paused).

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

## ADDED Requirements

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
