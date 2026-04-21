## ADDED Requirements

### Requirement: Inbox route
The system SHALL expose a route at `/inbox` listing all videos whose `consumption.status = 'inbox'`, sorted by `videos.discovered_at` descending (newest first).

#### Scenario: Inbox contains videos
- **WHEN** the user navigates to `/inbox` and at least one video has `consumption.status = 'inbox'`
- **THEN** each such video SHALL be rendered as a card showing title, channel name, duration (formatted as `H:MM` or `M:SS`), thumbnail, and published_at relative time label

#### Scenario: Inbox is empty
- **WHEN** no videos have `consumption.status = 'inbox'`
- **THEN** the page SHALL display an empty-state message (e.g. "Nothing new to triage") and a link back to the library

### Requirement: Save action
Each inbox card SHALL expose a "Save" action that transitions the video to `consumption.status = 'saved'`.

#### Scenario: User saves a video
- **WHEN** the user clicks Save on an inbox card
- **THEN** a POST request SHALL be issued to an API route that updates `consumption.status` to `saved`, and the card SHALL be removed from the inbox list on success

### Requirement: Dismiss action
Each inbox card SHALL expose a "Dismiss" action that transitions the video to `consumption.status = 'dismissed'`.

#### Scenario: User dismisses a video
- **WHEN** the user clicks Dismiss on an inbox card
- **THEN** a POST request SHALL be issued to an API route that updates `consumption.status` to `dismissed`, and the card SHALL be removed from the inbox list on success

### Requirement: Inbox card links to player
Clicking the card body (distinct from the Save/Dismiss controls) SHALL navigate to `/watch/{video.id}` without changing consumption status.

#### Scenario: User clicks card body
- **WHEN** the user clicks the thumbnail or title on an inbox card
- **THEN** the browser SHALL navigate to `/watch/{video.id}` and `consumption.status` SHALL remain `inbox`
