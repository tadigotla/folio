## ADDED Requirements

### Requirement: Embedded stream player
The player view at `/watch/[id]` SHALL embed the event's stream using the appropriate player based on `stream_kind`.

#### Scenario: YouTube stream
- **WHEN** the event has `stream_kind = 'youtube'`
- **THEN** the page SHALL render an iframe with `src="https://www.youtube.com/embed/{stream_ref}?autoplay=1"` filling the main content area

#### Scenario: Twitch stream
- **WHEN** the event has `stream_kind = 'twitch'`
- **THEN** the page SHALL render an iframe with `src="https://player.twitch.tv/?channel={stream_ref}&parent=localhost"`

#### Scenario: Generic iframe stream
- **WHEN** the event has `stream_kind = 'generic_iframe'`
- **THEN** the page SHALL render an iframe with `src` set to the `stream_ref` URL

#### Scenario: External link (no embeddable stream)
- **WHEN** the event has `stream_kind = 'external_link'`
- **THEN** the page SHALL display a prominent "Open on source" button linking to `source_url` instead of an iframe

### Requirement: Event metadata display
The player view SHALL display event metadata alongside the stream.

#### Scenario: Full metadata available
- **WHEN** the event has title, description, category, starts_at, and status
- **THEN** the page SHALL display all fields, with `starts_at` formatted in America/New_York timezone and status shown as a badge

### Requirement: Other live events sidebar
The player view SHALL show other currently-live events for quick switching.

#### Scenario: Other events are live
- **WHEN** other events have `status = 'live'` besides the currently watched one
- **THEN** they SHALL be listed in a sidebar (desktop) or below the player (mobile), each linking to their own `/watch/[id]` page

#### Scenario: No other live events
- **WHEN** no other events are currently live
- **THEN** the sidebar SHALL display upcoming events within the next 2 hours instead, or be hidden if none exist

### Requirement: Event not found handling
The player view SHALL handle missing or invalid event IDs gracefully.

#### Scenario: Invalid event ID
- **WHEN** the user navigates to `/watch/[id]` with an ID that does not exist in the database
- **THEN** the page SHALL display a "Event not found" message with a link back to the home page

### Requirement: Stream not yet available
The player view SHALL handle events that don't have a playable stream yet.

#### Scenario: Event with no stream reference
- **WHEN** an event has `stream_kind = 'external_link'` or an empty `stream_ref`
- **THEN** the page SHALL display a "Stream not yet available" message with the event metadata and a link to the source URL
