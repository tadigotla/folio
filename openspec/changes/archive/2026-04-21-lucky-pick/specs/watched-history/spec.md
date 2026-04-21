## ADDED Requirements

### Requirement: Watched table schema
The system SHALL have a `watched` table with columns: `id` (integer PK), `event_id` (text FK to events, unique), and `watched_at` (text, UTC ISO).

#### Scenario: Migration creates table
- **WHEN** migrations run
- **THEN** the `watched` table SHALL exist with the specified schema and a unique constraint on `event_id`

### Requirement: Mark event as watched
The system SHALL provide a `POST /api/watched` endpoint that records an event as watched.

#### Scenario: Mark unwatched event
- **WHEN** the user calls `POST /api/watched` with `{ "eventId": "abc" }`
- **THEN** a row SHALL be inserted into `watched` with the event ID and current UTC timestamp

#### Scenario: Mark already-watched event
- **WHEN** the user calls `POST /api/watched` for an event already in the `watched` table
- **THEN** the request SHALL succeed without creating a duplicate (idempotent)

### Requirement: Remove watched entry
The system SHALL provide a `DELETE /api/watched/[id]` endpoint that removes a single watched entry.

#### Scenario: Remove existing entry
- **WHEN** the user calls `DELETE /api/watched/[id]` with a valid watched entry ID
- **THEN** the entry SHALL be removed and the event becomes eligible for random selection again

### Requirement: Clear watched history
The system SHALL provide a `DELETE /api/watched` endpoint that clears all watched entries, optionally filtered by category.

#### Scenario: Clear all watched
- **WHEN** the user calls `DELETE /api/watched`
- **THEN** all rows in the `watched` table SHALL be deleted

#### Scenario: Clear watched by category
- **WHEN** the user calls `DELETE /api/watched?category=philosophy`
- **THEN** only watched entries for events with `category = 'philosophy'` SHALL be deleted

### Requirement: History page
The system SHALL provide a `/history` page displaying all watched events in reverse chronological order.

#### Scenario: Watched events exist
- **WHEN** the user navigates to `/history` and watched entries exist
- **THEN** each entry SHALL display the event card with the watched date, and a "Remove" button

#### Scenario: No watched events
- **WHEN** the user navigates to `/history` with no watched entries
- **THEN** the page SHALL display an empty state message

#### Scenario: Clear all button
- **WHEN** watched entries exist on the history page
- **THEN** a "Clear All" button SHALL be visible that removes all watched entries
