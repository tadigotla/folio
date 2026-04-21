## ADDED Requirements

### Requirement: Published-issue list
The system SHALL expose `/issues` as a server-rendered page listing every issue whose `status = 'published'`, ordered by `published_at DESC`. Each list entry SHALL show the issue's cover video thumbnail (or a muted placeholder if no cover is assigned), its title (or `Issue #<id>` if title is NULL), its `published_at` as a local date, and the count of filled slots in the form `<N> of 14`. Each entry SHALL link to `/issues/[id]`. The list SHALL NOT show draft issues.

#### Scenario: Connected user visits archive
- **WHEN** the user visits `/issues` and 3 published issues and 1 draft exist
- **THEN** the page SHALL render exactly 3 entries, in reverse-chronological order by `published_at`, and the draft SHALL NOT appear

#### Scenario: No published issues yet
- **WHEN** the user visits `/issues` and no published issue exists
- **THEN** the page SHALL render a "No issues yet" empty state with a link back to `/`

### Requirement: Published-issue detail view
The system SHALL expose `/issues/[id]` as a server-rendered read-only view of a single published issue. The page SHALL render the 14 slots magazine-style: the cover prominently at the top, the 3 featured in a three-column grid below, and the 10 briefs as a vertical list further down. Empty slots SHALL render as muted placeholders — the layout SHALL NOT collapse empty slots into adjacent ones. Each rendered slot SHALL link to `/watch/[video_id]`.

#### Scenario: Full issue
- **WHEN** the user visits `/issues/7` and issue 7 is published with 14 slots filled
- **THEN** the page SHALL render the cover, 3 featured tiles, and 10 brief rows in that layout order

#### Scenario: Partial issue
- **WHEN** the user visits `/issues/7` and issue 7 is published with only 4 slots filled (cover, featured 0, brief 0, brief 1)
- **THEN** the page SHALL render the cover, one populated + two placeholder featured tiles, and two populated + eight placeholder brief rows

#### Scenario: Draft issue is not publicly viewable
- **WHEN** the user visits `/issues/[id]` for an issue whose `status = 'draft'`
- **THEN** the page SHALL respond with HTTP 404 (draft issues are edited on `/`, not viewed in the archive)

#### Scenario: Unknown issue id
- **WHEN** the user visits `/issues/[id]` for an id that does not exist
- **THEN** the page SHALL respond with HTTP 404

### Requirement: Published issues are frozen
The system SHALL reject every mutation against an issue whose `status = 'published'`. This covers slot assignment (`POST /api/issues/:id/slots`), re-publish (`POST /api/issues/:id/publish`), and deletion (`DELETE /api/issues/:id`). All three SHALL respond with HTTP 409 and `{ error: 'issue_frozen' }` or `{ error: 'already_published' }` as appropriate, and no writes SHALL occur.

#### Scenario: Attempt to edit a published issue
- **WHEN** the client POSTs any slot action to `/api/issues/:id/slots` for a published issue
- **THEN** the response SHALL be HTTP 409 and no DB writes SHALL occur

#### Scenario: Attempt to publish again
- **WHEN** the client POSTs to `/api/issues/:id/publish` for an already-published issue
- **THEN** the response SHALL be HTTP 409 with `{ error: 'already_published' }`

#### Scenario: Attempt to delete a published issue
- **WHEN** the client DELETEs a published issue
- **THEN** the response SHALL be HTTP 409 with `{ error: 'issue_frozen' }`
