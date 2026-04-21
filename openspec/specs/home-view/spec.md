## ADDED Requirements

### Requirement: Home becomes a navigation hub
The home page at `/` SHALL render navigation tiles linking to `/inbox`, `/library`, and (for completed archive review in later changes) `/archive` — shown as `Archive` in this change. Each tile SHALL display a count of videos in the corresponding consumption status.

#### Scenario: Inbox tile shows inbox count
- **WHEN** the home page renders and 7 videos have `consumption.status = 'inbox'`
- **THEN** the Inbox tile SHALL display the number 7 and link to `/inbox`

#### Scenario: Library tile shows saved + in_progress count
- **WHEN** the home page renders and the combined count of `consumption.status IN ('saved', 'in_progress')` is 42
- **THEN** the Library tile SHALL display the number 42 and link to `/library`

#### Scenario: Archive tile shows archived count
- **WHEN** the home page renders
- **THEN** the Archive tile SHALL display the count of `consumption.status = 'archived'` and link to `/library#archived` (the archived section of the library route)

### Requirement: Live Now indicator
The home page SHALL render a small "Live Now" indicator listing videos where `is_live_now = 1`. It SHALL be a compact strip, not a primary surface.

#### Scenario: Videos are currently live
- **WHEN** the home page renders and at least one video has `is_live_now = 1`
- **THEN** the page SHALL show a "Live Now" strip with those videos, each linking to `/watch/{id}`

#### Scenario: Nothing is live
- **WHEN** no videos have `is_live_now = 1`
- **THEN** the "Live Now" strip SHALL be hidden
