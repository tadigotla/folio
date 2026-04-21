## ADDED Requirements

### Requirement: Sections table schema
The system SHALL persist user-defined sections (a.k.a. "departments") in a `sections` table with columns: `id` INTEGER PRIMARY KEY AUTOINCREMENT, `name` TEXT NOT NULL UNIQUE, `sort_order` INTEGER NOT NULL DEFAULT 0, `created_at` TEXT NOT NULL.

#### Scenario: Section created
- **WHEN** the user creates a section named "Philosophy"
- **THEN** a row SHALL be inserted into `sections` with `name = 'Philosophy'`, `created_at` set to the current UTC ISO time, and `sort_order` defaulting to 0

#### Scenario: Section name uniqueness
- **WHEN** the user attempts to create a second section with `name = 'Philosophy'` (case-sensitive) while one already exists
- **THEN** the system SHALL reject the request with an error and SHALL NOT create a duplicate row

### Requirement: Channels gain nullable section reference
The `channels` table SHALL include a nullable `section_id` INTEGER column that REFERENCES `sections(id)` ON DELETE SET NULL. A channel with `section_id = NULL` is considered "Unsorted".

#### Scenario: New channel starts unsorted
- **WHEN** a channel is auto-registered during ingestion
- **THEN** its `section_id` SHALL be NULL by default

#### Scenario: Section deleted with assigned channels
- **WHEN** the user deletes a section that has channels assigned to it
- **THEN** those channels' `section_id` SHALL be set to NULL (preserving the channel rows) and videos belonging to those channels SHALL surface under "Unsorted" thereafter

### Requirement: Issues table schema
The system SHALL persist magazine issue compositions in an `issues` table with columns: `id` INTEGER PRIMARY KEY AUTOINCREMENT, `created_at` TEXT NOT NULL (UTC ISO), `cover_video_id` TEXT NULL REFERENCES `videos(id)` ON DELETE SET NULL, `featured_video_ids` TEXT NOT NULL (JSON array of video IDs, up to 3), `pinned_cover_video_id` TEXT NULL REFERENCES `videos(id)` ON DELETE SET NULL.

#### Scenario: Issue composed and stored
- **WHEN** the system composes a new issue
- **THEN** a row SHALL be inserted with `created_at` set to the current UTC time, `cover_video_id` set per the cover selection rule (or NULL if the inbox is empty), `featured_video_ids` set to a JSON-serialized array of up to 3 video IDs, and `pinned_cover_video_id` set to NULL

#### Scenario: Pinned cover survives recomposition
- **WHEN** an issue's `pinned_cover_video_id` is non-null and the referenced video still has `consumption.status = 'inbox'`
- **THEN** renders of that issue SHALL display the pinned video as the cover, regardless of what the deterministic cover rule would otherwise select

#### Scenario: Pinned cover becomes invalid
- **WHEN** an issue's `pinned_cover_video_id` references a video whose `consumption.status` has moved away from `inbox` (e.g., archived)
- **THEN** subsequent renders of that issue SHALL fall back to the deterministic cover (`cover_video_id`) and the pin SHALL be silently ignored; the pin row SHALL NOT be automatically cleared

### Requirement: Section ordering preserved
The `sections.sort_order` column SHALL govern the display order of sections in the departments strip and the `/sections` page. Rows are displayed ascending by `sort_order`, tie-broken by `name` ascending.

#### Scenario: User reorders sections
- **WHEN** the user reassigns `sort_order` values (e.g. via drag-reorder on `/sections`)
- **THEN** subsequent renders SHALL honor the new ordering
