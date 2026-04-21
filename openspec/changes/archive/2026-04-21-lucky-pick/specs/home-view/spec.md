## ADDED Requirements

### Requirement: I Feel Lucky button
The home page SHALL display an "I Feel Lucky" button that picks a random unwatched YouTube video.

#### Scenario: User clicks lucky button with no category filter
- **WHEN** the user clicks "I Feel Lucky" with no category filter active
- **THEN** the system SHALL call `GET /api/lucky` and navigate to `/watch/[id]` with the returned event ID

#### Scenario: User clicks lucky button with category filter
- **WHEN** the user clicks "I Feel Lucky" while a category filter (e.g., "Philosophy") is active
- **THEN** the system SHALL call `GET /api/lucky?category=philosophy` and navigate to the returned event

#### Scenario: Pool exhausted
- **WHEN** the user clicks "I Feel Lucky" and the API returns `{ exhausted: true }`
- **THEN** the system SHALL display a message: "You've watched everything [in {category}]!" with an option to clear watched history
