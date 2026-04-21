## ADDED Requirements

### Requirement: Fetcher interface compliance
Each fetcher module SHALL export a function that conforms to the `Fetcher` interface: `{ sourceId: string; fetch(): Promise<NormalizedEvent[]> }`. The returned `NormalizedEvent` objects SHALL use the fields defined in `src/lib/types.ts`.

#### Scenario: Fetcher returns normalized events
- **WHEN** a fetcher's `fetch()` method is called
- **THEN** it SHALL return an array of `NormalizedEvent` objects with at minimum: `sourceEventId`, `title`, `status`, `streamKind`, `streamRef`, and `sourceUrl`

### Requirement: Idempotent event upsert
The orchestrator SHALL upsert events using `INSERT ... ON CONFLICT(id) DO UPDATE` with the composite key `${sourceId}:${sourceEventId}`. Re-running a fetcher SHALL never create duplicate rows.

#### Scenario: New event ingested
- **WHEN** the orchestrator processes a `NormalizedEvent` whose computed `id` does not exist in the `events` table
- **THEN** a new row SHALL be inserted with `first_seen_at` set to the current UTC timestamp

#### Scenario: Existing event updated
- **WHEN** the orchestrator processes a `NormalizedEvent` whose computed `id` already exists
- **THEN** the row SHALL be updated (title, status, starts_at, ends_at, stream_ref, thumbnail_url, last_checked_at, updated_at, raw) while preserving the original `first_seen_at`

#### Scenario: Duplicate run produces no duplicates
- **WHEN** the orchestrator runs twice with the same source data
- **THEN** the `events` table SHALL contain the same number of rows as after the first run

### Requirement: Orchestrator respects polling intervals
The orchestrator SHALL skip any source whose `last_fetched_at` is more recent than `min_interval_minutes` ago.

#### Scenario: Source polled recently
- **WHEN** a source was last fetched 10 minutes ago and its `min_interval_minutes` is 60
- **THEN** the orchestrator SHALL skip that source

#### Scenario: Source due for polling
- **WHEN** a source was last fetched 70 minutes ago and its `min_interval_minutes` is 60
- **THEN** the orchestrator SHALL run that source's fetcher

### Requirement: Fetcher errors are isolated
A failure in one fetcher SHALL NOT prevent other fetchers from running. The orchestrator SHALL catch errors per-fetcher and record them in `sources.last_error`.

#### Scenario: One fetcher throws
- **WHEN** the Launch Library 2 fetcher throws an error
- **THEN** the orchestrator SHALL log the error to `sources.last_error` for that source and continue processing remaining sources

### Requirement: Stale event sweep
After all fetchers complete, the orchestrator SHALL mark any event with `status = 'scheduled'` and `starts_at` more than 6 hours in the past as `status = 'ended'`.

#### Scenario: Old scheduled event swept
- **WHEN** an event has `status = 'scheduled'` and `starts_at` is 7 hours in the past
- **THEN** the orchestrator SHALL update its status to `ended`

#### Scenario: Recent scheduled event preserved
- **WHEN** an event has `status = 'scheduled'` and `starts_at` is 2 hours in the past
- **THEN** the orchestrator SHALL leave its status unchanged

### Requirement: Launch Library 2 fetcher
The Launch Library 2 fetcher SHALL call `https://ll.thespacedevs.com/2.2.0/launch/upcoming/` and normalize the response into `NormalizedEvent[]`.

#### Scenario: Successful fetch with launches
- **WHEN** the LL2 API returns a list of upcoming launches
- **THEN** each launch SHALL be mapped to a `NormalizedEvent` with: `sourceEventId` from the LL2 `id`, `title` from `name`, `startsAt` from `net`, `status` mapped from LL2 status, `streamKind` of `youtube` when a YouTube URL is found in `vidURLs`, and `sourceUrl` pointing to the launch detail page

#### Scenario: Launch with no video URLs
- **WHEN** a launch has an empty `vidURLs` array
- **THEN** the fetcher SHALL set `streamKind` to `external_link` and `streamRef` to the launch's source URL

#### Scenario: Launch with webcast_live flag
- **WHEN** a launch has `webcast_live = true`
- **THEN** the fetcher SHALL set `status` to `live` regardless of the LL2 status field

### Requirement: Orchestrator updates source metadata
After a fetcher runs (success or failure), the orchestrator SHALL update `last_fetched_at` to the current UTC time on the source row.

#### Scenario: Successful fetch updates timestamp
- **WHEN** a fetcher completes successfully
- **THEN** `sources.last_fetched_at` SHALL be set to the current UTC time and `sources.last_error` SHALL be set to NULL

#### Scenario: Failed fetch updates timestamp and error
- **WHEN** a fetcher throws an error
- **THEN** `sources.last_fetched_at` SHALL be set to the current UTC time and `sources.last_error` SHALL contain the error message
