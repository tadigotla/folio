## ADDED Requirements

### Requirement: Mark as watched button
The player view SHALL display a "Mark as watched" button for YouTube events.

#### Scenario: Unwatched YouTube event
- **WHEN** the user views a YouTube event that is not in the `watched` table
- **THEN** a "Mark as watched" button SHALL be displayed below the player

#### Scenario: User marks event as watched
- **WHEN** the user clicks "Mark as watched"
- **THEN** the system SHALL call `POST /api/watched` with the event ID and the button SHALL change to a disabled "Watched" state

#### Scenario: Already watched event
- **WHEN** the user views an event that is already in the `watched` table
- **THEN** the button SHALL display as "Watched" in a disabled state

#### Scenario: Non-YouTube event
- **WHEN** the user views an event with `stream_kind` other than `youtube`
- **THEN** the "Mark as watched" button SHALL NOT be displayed
