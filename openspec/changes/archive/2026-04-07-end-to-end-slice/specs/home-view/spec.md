## ADDED Requirements

### Requirement: Live Now strip
The home page SHALL display a "Live Now" section showing all events with `status = 'live'`.

#### Scenario: Events are currently live
- **WHEN** the database contains events with `status = 'live'`
- **THEN** the home page SHALL render them in a horizontal strip at the top, each showing title, category, thumbnail (if available), and a link to the player view

#### Scenario: No events are live
- **WHEN** no events have `status = 'live'`
- **THEN** the "Live Now" section SHALL be hidden

### Requirement: Next Up timeline
The home page SHALL display upcoming events grouped by hour for the next 6 hours.

#### Scenario: Events in the next 6 hours
- **WHEN** the database contains events with `starts_at` within the next 6 hours and `status` in (`scheduled`, `delayed`)
- **THEN** they SHALL be rendered grouped by hour, sorted by `starts_at` within each group

#### Scenario: Hour with no events
- **WHEN** an hour slot has no upcoming events
- **THEN** that hour slot SHALL be collapsed/hidden

#### Scenario: No upcoming events at all
- **WHEN** no events exist within the next 6 hours
- **THEN** the timeline section SHALL display a message indicating no upcoming events

### Requirement: Category filtering
The home page SHALL provide category filter chips that filter displayed events.

#### Scenario: Filter by category
- **WHEN** the user clicks a category chip (e.g., "Space")
- **THEN** only events matching that category SHALL be displayed in both Live Now and Next Up sections

#### Scenario: Clear filter
- **WHEN** the user clicks an active category chip to deselect it
- **THEN** all categories SHALL be displayed again

### Requirement: Event card display
Each event in the home page SHALL be rendered as a card showing essential information.

#### Scenario: Event with full data
- **WHEN** an event has title, category, starts_at, and thumbnail_url
- **THEN** the card SHALL display all four fields plus a relative time label (e.g., "in 45 min")

#### Scenario: Event without thumbnail
- **WHEN** an event has no thumbnail_url
- **THEN** the card SHALL display without an image, using a category-colored placeholder

### Requirement: Event card links to player
Each event card SHALL link to the player view at `/watch/[id]`.

#### Scenario: User clicks event card
- **WHEN** the user clicks an event card
- **THEN** the browser SHALL navigate to `/watch/{event.id}`
