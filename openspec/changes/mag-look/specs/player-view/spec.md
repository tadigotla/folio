## ADDED Requirements

### Requirement: Editorial chrome on watch page
The watch page at `/watch/[id]` SHALL render video metadata above the player using the editorial design system: an oxblood kicker showing the section name (or `UNSORTED · VIDEO`), the video title in Fraunces large-serif, and italic metadata (channel name, duration, published-at relative time) in Source-Serif italic sage.

#### Scenario: Metadata styled editorially
- **WHEN** `/watch/[id]` renders for a valid video whose channel has `section_id` referencing "Philosophy"
- **THEN** the page SHALL show `PHILOSOPHY` as an oxblood Inter small-caps kicker, the video title in Fraunces at a large display size, and `Closer To Truth · 1 hr 12 min · 3 hours ago` in italic sage

#### Scenario: Unsorted channel
- **WHEN** the channel has `section_id = NULL`
- **THEN** the kicker SHALL read `UNSORTED` (the section-assignment chip remains available for one-click assignment)

### Requirement: Next-piece footer
Below the player and description, the watch page SHALL render a footer with two lists: `NEXT IN {SECTION}` (up to 3 other inbox videos from the same channel's section, sorted by the same composite score as cover selection) and `ALSO IN THIS ISSUE` (cover + featured + top 3 briefs from today's issue, excluding the current video). Each item is a single line — kicker, title (Fraunces), channel (italic sage), duration (Plex Mono).

#### Scenario: Section populated
- **WHEN** the current video's channel has a section that contains at least 3 other inbox videos
- **THEN** the `NEXT IN {SECTION}` list SHALL display those 3 videos

#### Scenario: Unsorted or sparse section
- **WHEN** the channel has no section, or the section has fewer than 3 other inbox videos
- **THEN** the `NEXT IN` header SHALL read `NEXT IN UNSORTED` (or the section name); the list SHALL display whatever inbox videos are available up to 3, or read `"Nothing else queued here."` when empty

#### Scenario: Click-through
- **WHEN** the user clicks any item in either footer list
- **THEN** the browser SHALL navigate to `/watch/[id]` for that video

### Requirement: In-issue keyboard navigation
The watch page SHALL respond to the following keyboard bindings (same no-modifier guard as existing inbox bindings — only active outside inputs/textareas/contenteditables):

- `n` — navigate to the next piece in today's issue (cover → featured[0] → featured[1] → featured[2] → briefs[0..9] → first section's videos → ...)
- `p` — navigate to the previous piece (reverse of `n` order)
- `.` — pin the current video as today's cover (via `POST /api/issues/cover-pin`); show a brief oxblood confirmation toast "Pinned as cover."
- The existing `s` / `a` / `d` bindings for save / archive / dismiss are preserved.

#### Scenario: Next key at the end of the issue
- **WHEN** the user presses `n` while watching the last piece in the issue ordering
- **THEN** the key SHALL be a no-op (no navigation) and a brief sage toast SHALL read "End of issue."

### Requirement: Auto-advance with undo
When the user triggers `s` (save), `a` (archive), or `d` (dismiss) on the watch page via keyboard or button, the consumption transition SHALL apply immediately, and an inline oxblood strip SHALL appear at the top of the page reading: `"{Action}. Next in 1s. ⌘Z to undo"`. After a 1,200ms grace window, the browser SHALL navigate to the next piece in the issue (same order as `n`). Pressing `⌘Z` (or `Ctrl+Z`) during the window SHALL revert the consumption transition and cancel the navigation.

#### Scenario: Archive with auto-advance
- **WHEN** the user presses `a` while watching a piece
- **THEN** the video's consumption status SHALL change to `archived` immediately, the undo strip SHALL appear, and 1,200ms later the browser SHALL navigate to the next piece

#### Scenario: Undo within the grace window
- **WHEN** the user presses `⌘Z` within 1,200ms of an archive action
- **THEN** the consumption status SHALL revert to its prior value (e.g. back to `saved` or `inbox`), the undo strip SHALL dismiss, and the browser SHALL remain on the current video

#### Scenario: Undo after the grace window
- **WHEN** the user presses `⌘Z` more than 1,200ms after the action (after navigation has already occurred)
- **THEN** the keystroke SHALL be a no-op from this feature's perspective (browser default undo may still fire)

### Requirement: Duotone poster during player load
While the YouTube IFrame API is loading (before the iframe mounts), the watch page SHALL show a `<DuotoneThumbnail>` of the video at the player's aspect ratio. Once the iframe mounts, the poster is replaced.

#### Scenario: Poster shown on load
- **WHEN** `/watch/[id]` is navigated to and the IFrame API has not yet loaded
- **THEN** a duotone-treated thumbnail SHALL render at 16:9 aspect ratio in the player's slot until the iframe replaces it
