## ADDED Requirements

### Requirement: Multi-day fixture fetching
The TheSportsDB fetcher SHALL fetch upcoming fixtures for today and the next 6 days using the `eventsday.php` endpoint, one request per day.

#### Scenario: Fetch 7 days of fixtures
- **WHEN** the fetcher runs
- **THEN** it SHALL make 7 API requests (today through 6 days ahead) and combine all results

### Requirement: Fixture normalization
Each fixture SHALL be mapped to a `NormalizedEvent` with the event name as title, the event timestamp as `startsAt`, and the sport/league info in the description.

#### Scenario: Standard fixture
- **WHEN** a fixture has `strEvent`, `strTimestamp`, and `strLeague`
- **THEN** the `NormalizedEvent` SHALL have `title` from `strEvent`, `startsAt` from `strTimestamp`, and `description` including `strLeague`

### Requirement: External link stream kind
All sports events SHALL use `stream_kind: 'external_link'` since sports broadcasts require paid subscriptions.

#### Scenario: No embeddable stream
- **WHEN** a sports fixture is normalized
- **THEN** `streamKind` SHALL be `external_link` and `streamRef` SHALL point to the TheSportsDB event page or a general sports URL

### Requirement: Thumbnail from event art
If a fixture has a `strThumb` field, it SHALL be used as `thumbnailUrl`.

#### Scenario: Fixture with thumbnail
- **WHEN** a fixture has a non-null `strThumb`
- **THEN** `thumbnailUrl` SHALL be set to that URL

### Requirement: Graceful handling of empty days
If a day returns no fixtures, the fetcher SHALL skip that day without error.

#### Scenario: Day with no events
- **WHEN** the API returns null or empty events for a given day
- **THEN** the fetcher SHALL skip that day and continue with the next
