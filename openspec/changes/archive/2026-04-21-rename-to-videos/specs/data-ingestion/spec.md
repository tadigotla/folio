## MODIFIED Requirements

### Requirement: Fetcher interface compliance
Each fetcher module SHALL export a function that conforms to the `Fetcher` interface: `{ sourceId: string; fetch(): Promise<NormalizedVideo[]> }`. The returned `NormalizedVideo` objects SHALL use the fields defined in `src/lib/types.ts` (at minimum: `videoId`, `title`, `channelId`, `channelName`, `publishedAt`, `isLiveNow`).

#### Scenario: Fetcher returns normalized videos
- **WHEN** a fetcher's `fetch()` method is called
- **THEN** it SHALL return an array of `NormalizedVideo` objects with at minimum: `videoId`, `title`, `channelId`, `channelName`, `publishedAt`, and `isLiveNow`

### Requirement: Idempotent video upsert
The orchestrator SHALL upsert videos using `INSERT ... ON CONFLICT(id) DO UPDATE` keyed by the YouTube `videoId` directly. Re-running a fetcher SHALL never create duplicate rows.

#### Scenario: New video ingested
- **WHEN** the orchestrator processes a `NormalizedVideo` whose `videoId` does not exist in the `videos` table
- **THEN** a new `videos` row SHALL be inserted with `first_seen_at` and `discovered_at` set to the current UTC time, and a corresponding `consumption` row SHALL be inserted with `status = 'inbox'`

#### Scenario: Existing video updated
- **WHEN** the orchestrator processes a `NormalizedVideo` whose `videoId` already exists
- **THEN** the video row SHALL be updated (title, description, duration_seconds, is_live_now, scheduled_start, thumbnail_url, last_checked_at, updated_at, raw) while preserving `first_seen_at`, `discovered_at`, and the existing `consumption` row

#### Scenario: Duplicate run produces no duplicates
- **WHEN** the orchestrator runs twice with the same source data
- **THEN** the `videos` and `consumption` tables SHALL each contain the same number of rows as after the first run

### Requirement: Orchestrator respects polling intervals
The orchestrator SHALL skip any source whose `last_fetched_at` is more recent than `min_interval_minutes` ago. The default `min_interval_minutes` for YouTube RSS sources SHALL be 30.

#### Scenario: Source polled recently
- **WHEN** a source was last fetched 10 minutes ago and its `min_interval_minutes` is 30
- **THEN** the orchestrator SHALL skip that source

#### Scenario: Source due for polling
- **WHEN** a source was last fetched 35 minutes ago and its `min_interval_minutes` is 30
- **THEN** the orchestrator SHALL run that source's fetcher

### Requirement: Fetcher errors are isolated
A failure in one fetcher SHALL NOT prevent other fetchers from running. The orchestrator SHALL catch errors per-fetcher and record them in `sources.last_error`.

#### Scenario: One fetcher throws
- **WHEN** a YouTube channel fetcher throws an error
- **THEN** the orchestrator SHALL log the error to `sources.last_error` for that source and continue processing remaining sources

### Requirement: Orchestrator updates source metadata
After a fetcher runs (success or failure), the orchestrator SHALL update `last_fetched_at` to the current UTC time on the source row.

#### Scenario: Successful fetch updates timestamp
- **WHEN** a fetcher completes successfully
- **THEN** `sources.last_fetched_at` SHALL be set to the current UTC time and `sources.last_error` SHALL be set to NULL

#### Scenario: Failed fetch updates timestamp and error
- **WHEN** a fetcher throws an error
- **THEN** `sources.last_fetched_at` SHALL be set to the current UTC time and `sources.last_error` SHALL contain the error message

## REMOVED Requirements

### Requirement: Stale event sweep
**Reason**: Videos are on-demand content and do not "end". The concept of sweeping `status = 'scheduled'` rows to `status = 'ended'` after N hours no longer applies; live-ness is re-computed per-fetch via `is_live_now`.
**Migration**: No replacement requirement. Delete the sweep query from `orchestrator.ts`. The `events.status` column is removed by the schema migration.

### Requirement: Launch Library 2 fetcher
**Reason**: Non-YouTube fetchers are being dropped as part of the pivot to a YouTube-primary content library. Launch streams that are hosted on YouTube will still surface via the YouTube channel fetchers for the relevant broadcasters.
**Migration**: Delete `src/fetchers/launch-library.ts`, remove the `launch_library_2` row from `sources`, and remove the registry entry from `src/fetchers/registry.ts`.
