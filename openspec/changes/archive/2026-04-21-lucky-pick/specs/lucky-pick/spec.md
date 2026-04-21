## ADDED Requirements

### Requirement: Random video selection API
The system SHALL provide a `GET /api/lucky` endpoint that returns a random YouTube-embeddable event the user has not watched.

#### Scenario: Unwatched videos available
- **WHEN** the user calls `GET /api/lucky`
- **THEN** the API SHALL return `{ id: "<event_id>" }` for a random event where `stream_kind = 'youtube'` and the event ID is not in the `watched` table

#### Scenario: Category-scoped selection
- **WHEN** the user calls `GET /api/lucky?category=culture`
- **THEN** the API SHALL only select from events matching `category = 'culture'`

#### Scenario: No category filter
- **WHEN** the user calls `GET /api/lucky` without a category param
- **THEN** the API SHALL select from all YouTube events across all categories

#### Scenario: All videos watched (pool exhausted)
- **WHEN** all YouTube events (in the given category or globally) have been watched
- **THEN** the API SHALL return `{ exhausted: true, category: "<category_or_null>" }`

### Requirement: Pool excludes watched events
The random selection query SHALL exclude any event whose ID exists in the `watched` table.

#### Scenario: Previously watched video excluded
- **WHEN** the user has watched event "abc" and calls `GET /api/lucky`
- **THEN** event "abc" SHALL never be returned by the random selection
