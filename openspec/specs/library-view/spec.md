## ADDED Requirements

### Requirement: Library route with three lists
The system SHALL expose a route at `/library` that displays three separate lists in this order: **Saved**, **In Progress**, **Archived**. Each list SHALL be populated from `videos` joined to `consumption` filtered by the corresponding status. The In Progress list SHALL be sorted by `consumption.last_viewed_at DESC`, falling back to `consumption.status_changed_at DESC` when `last_viewed_at` is NULL. The Saved and Archived lists SHALL continue to sort by `status_changed_at DESC`.

#### Scenario: Library renders all three populated lists
- **WHEN** the user navigates to `/library` and at least one video exists in each of `saved`, `in_progress`, and `archived`
- **THEN** each section SHALL render its cards; the In Progress section SHALL surface the most recently played video first

#### Scenario: Empty section
- **WHEN** a section has no videos
- **THEN** the section header SHALL still render and SHALL display a short empty-state note

### Requirement: Video card display
Each video card in the library SHALL display title, channel name, duration, thumbnail, and a status-appropriate secondary action (e.g. "Archive" on Saved items, "Re-open" on Archived items). Cards in the In Progress section SHALL additionally render a thin progress bar overlaying the bottom of the thumbnail when both `consumption.last_position_seconds` and `videos.duration_seconds` are non-null. The bar's width SHALL equal `min(100%, (last_position_seconds / duration_seconds) * 100%)`.

#### Scenario: Saved-section card shows Archive action
- **WHEN** a video in the Saved section is rendered
- **THEN** its card SHALL include an "Archive" button that, on click, issues a POST to transition `consumption.status` to `archived`

#### Scenario: Archived-section card shows Re-open action
- **WHEN** a video in the Archived section is rendered
- **THEN** its card SHALL include a "Re-open" button that, on click, issues a POST to transition `consumption.status` to `saved`

#### Scenario: In-progress card with known duration
- **WHEN** an in-progress video has `last_position_seconds = 600` and `duration_seconds = 1800`
- **THEN** the card SHALL render a progress bar filled to approximately 33% of the thumbnail's width

#### Scenario: In-progress card with unknown duration
- **WHEN** an in-progress video has `duration_seconds = NULL`
- **THEN** no progress bar SHALL render; the card SHALL otherwise be indistinguishable from other in-progress cards

#### Scenario: Saved or archived card has no progress bar
- **WHEN** a card renders in the Saved or Archived section
- **THEN** no progress bar SHALL render regardless of whether `last_position_seconds` is set

### Requirement: Library card links to player
Clicking the card body SHALL navigate to `/watch/{video.id}` without changing consumption status.

#### Scenario: User clicks card body
- **WHEN** the user clicks the thumbnail or title on a library card
- **THEN** the browser SHALL navigate to `/watch/{video.id}` and the video's `consumption.status` SHALL remain unchanged
