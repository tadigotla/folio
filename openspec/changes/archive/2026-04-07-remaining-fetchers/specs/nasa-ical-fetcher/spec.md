## ADDED Requirements

### Requirement: iCal feed parsing
The NASA iCal fetcher SHALL fetch and parse the iCal feed at `source.config.url` using the `node-ical` library.

#### Scenario: Successful iCal parse
- **WHEN** the NASA iCal feed returns valid iCalendar data
- **THEN** each `VEVENT` SHALL be mapped to a `NormalizedEvent`

### Requirement: Event field mapping
Each VEVENT SHALL be mapped with `SUMMARY` as title, `DESCRIPTION` as description, `DTSTART` as `startsAt`, and `DTEND` as `endsAt`.

#### Scenario: Standard VEVENT
- **WHEN** a VEVENT has SUMMARY, DTSTART, and DTEND
- **THEN** the `NormalizedEvent` SHALL have `title` from SUMMARY, `startsAt` from DTSTART (as UTC ISO), and `endsAt` from DTEND (as UTC ISO)

### Requirement: YouTube link extraction from description
If a VEVENT description contains a YouTube URL, the fetcher SHALL extract the video ID and set `stream_kind: 'youtube'` with the video ID as `stream_ref`.

#### Scenario: Description with YouTube link
- **WHEN** a VEVENT description contains `https://www.youtube.com/watch?v=abc123`
- **THEN** `streamKind` SHALL be `youtube` and `streamRef` SHALL be `abc123`

#### Scenario: Description without YouTube link
- **WHEN** a VEVENT description has no YouTube URL
- **THEN** `streamKind` SHALL be `external_link` and `streamRef` SHALL be the event URL or source URL

### Requirement: Date range limit
The fetcher SHALL only return events within the next 30 days to avoid unbounded recurrence expansion.

#### Scenario: Event beyond 30 days
- **WHEN** a VEVENT has DTSTART more than 30 days from now
- **THEN** it SHALL be excluded from the results

### Requirement: Stable source event ID
Each event SHALL use the VEVENT `UID` as `sourceEventId` for idempotent upserts.

#### Scenario: Event with UID
- **WHEN** a VEVENT has `UID: nasa-event-123`
- **THEN** `sourceEventId` SHALL be `nasa-event-123`
