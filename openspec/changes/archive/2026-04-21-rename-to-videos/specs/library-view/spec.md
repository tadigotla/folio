## ADDED Requirements

### Requirement: Library route with three lists
The system SHALL expose a route at `/library` that displays three separate lists in this order: **Saved**, **In Progress**, **Archived**. Each list SHALL be populated from `videos` joined to `consumption` filtered by the corresponding status.

#### Scenario: Library renders all three lists
- **WHEN** the user navigates to `/library`
- **THEN** the page SHALL render three section headers (`Saved`, `In Progress`, `Archived`) each containing cards for videos in that status, sorted by `consumption.status_changed_at` descending

#### Scenario: Empty section
- **WHEN** a section has no videos
- **THEN** the section header SHALL still render and SHALL display a short empty-state note (e.g. "Nothing saved yet") rather than being hidden

### Requirement: Video card display
Each video card in the library SHALL display title, channel name, duration, thumbnail, and a status-appropriate secondary action (e.g. "Archive" on Saved items, "Re-open" on Archived items).

#### Scenario: Saved-section card shows Archive action
- **WHEN** a video in the Saved section is rendered
- **THEN** its card SHALL include an "Archive" button that, on click, issues a POST to transition `consumption.status` to `archived`

#### Scenario: Archived-section card shows Re-open action
- **WHEN** a video in the Archived section is rendered
- **THEN** its card SHALL include a "Re-open" button that, on click, issues a POST to transition `consumption.status` to `saved`

### Requirement: Library card links to player
Clicking the card body SHALL navigate to `/watch/{video.id}` without changing consumption status.

#### Scenario: User clicks card body
- **WHEN** the user clicks the thumbnail or title on a library card
- **THEN** the browser SHALL navigate to `/watch/{video.id}` and the video's `consumption.status` SHALL remain unchanged

### Requirement: In Progress is populated by later changes
This change SHALL provision the In Progress section but SHALL NOT implement the logic that moves videos into `in_progress` — that requires the IFrame Player integration from a later change. The section SHALL render as empty in this change.

#### Scenario: In Progress section renders empty
- **WHEN** the user navigates to `/library` in this change's scope
- **THEN** the In Progress section SHALL render its header and empty-state note; no videos SHALL appear there until a future change introduces position tracking
