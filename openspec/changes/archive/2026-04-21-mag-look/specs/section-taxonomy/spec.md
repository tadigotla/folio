## ADDED Requirements

### Requirement: Create / rename / delete sections
The system SHALL expose `POST /api/sections` with a JSON body `{ op: 'create' | 'rename' | 'delete', name?: string, id?: number, newName?: string }` that performs the corresponding mutation on the `sections` table and returns the resulting `sections` row (or 204 on delete).

#### Scenario: Create section
- **WHEN** the endpoint is called with `{ op: 'create', name: 'Slow Thinking' }` and no existing section has that name
- **THEN** a new `sections` row SHALL be inserted and the endpoint SHALL respond with the inserted row as JSON

#### Scenario: Rename section
- **WHEN** the endpoint is called with `{ op: 'rename', id: 3, newName: 'Deep Work' }` and no other section has that name
- **THEN** the row SHALL be updated and the endpoint SHALL respond with the updated row

#### Scenario: Delete section with assigned channels
- **WHEN** the endpoint is called with `{ op: 'delete', id: 3 }` and channels are assigned to that section
- **THEN** those channels' `section_id` SHALL be set to NULL and the `sections` row SHALL be deleted; the endpoint SHALL respond 204

### Requirement: Assign channel to section
The system SHALL expose `POST /api/channels/section` with body `{ channelId: string, sectionId: number | null }` that updates `channels.section_id`. A `sectionId` of `null` explicitly un-assigns (moves the channel to Unsorted).

#### Scenario: Channel assigned to existing section
- **WHEN** the endpoint is called with a valid `channelId` and a valid `sectionId`
- **THEN** the corresponding `channels` row SHALL be updated and the endpoint SHALL respond 204

#### Scenario: Channel moved to Unsorted
- **WHEN** the endpoint is called with `{ sectionId: null }` for a channel that currently has a section
- **THEN** `channels.section_id` SHALL be set to NULL and the endpoint SHALL respond 204

#### Scenario: Invalid channel
- **WHEN** the endpoint is called with a `channelId` that does not exist in `channels`
- **THEN** the endpoint SHALL respond 404 without mutating any row

### Requirement: Sections management page
The system SHALL expose `/sections` as a server-rendered page listing every row in `channels` with a per-row section-assignment control, sortable by channel name, inbox-video count (number of `consumption.status = 'inbox'` videos for that channel), and last-active time (`channels.last_checked_at`).

#### Scenario: Page renders channel list
- **WHEN** the user navigates to `/sections` and channels exist
- **THEN** each channel SHALL appear as a row showing its name, current section (or "Unsorted"), inbox-video count, and last-active time

#### Scenario: Keyboard-first assignment
- **WHEN** the user focuses a channel row and presses a number key `1`-`9`
- **THEN** the channel SHALL be assigned to the Nth section (in current sort order); `0` SHALL move it to Unsorted

### Requirement: Inline section chip on video cards
Every video card that displays a channel name SHALL also display the channel's section as a typographic chip in sage small-caps Inter (e.g. `PHILOSOPHY`). A channel without a section SHALL display a muted oxblood `+ ASSIGN` chip instead.

#### Scenario: Assigned channel shows section
- **WHEN** a card displays a video from a channel whose `section_id` references a section named "Philosophy"
- **THEN** the card SHALL display the text `PHILOSOPHY` in sage Inter small-caps adjacent to the channel name

#### Scenario: Unsorted channel shows assign prompt
- **WHEN** a card displays a video from a channel whose `section_id` is NULL
- **THEN** the card SHALL display the text `+ ASSIGN` in muted oxblood; clicking it SHALL open the assignment popover

#### Scenario: Assignment popover
- **WHEN** the user clicks a chip (either assigned or unassigned)
- **THEN** a popover SHALL open listing existing sections alphabetically plus a "New section…" text input; selecting an existing section OR submitting a new name SHALL call the assignment API and update the chip in place on success

### Requirement: Unsorted virtual section
For display purposes, channels with `section_id = NULL` SHALL be grouped under a virtual section named "Unsorted". It SHALL always sort last in the departments strip and on the `/sections` page.

#### Scenario: Unsorted count
- **WHEN** the departments strip renders and at least one channel has `section_id = NULL`
- **THEN** an "Unsorted" row SHALL appear at the bottom with the aggregate inbox-video count for those channels
