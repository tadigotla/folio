## ADDED Requirements

### Requirement: Playlist and playlist-item schema

The system SHALL persist playlists in a `playlists` table with columns: `id INTEGER PRIMARY KEY AUTOINCREMENT`, `name TEXT NOT NULL`, `description TEXT`, `show_on_home INTEGER NOT NULL DEFAULT 0 CHECK (show_on_home IN (0, 1))`, `created_at TEXT NOT NULL`, `updated_at TEXT NOT NULL`. The system SHALL persist playlist membership in a `playlist_items` table with columns: `playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE`, `video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE`, `position INTEGER NOT NULL`, `added_at TEXT NOT NULL`, and composite PRIMARY KEY `(playlist_id, video_id)`.

#### Scenario: Tables exist post-migration

- **WHEN** migrations are applied against a fresh or existing database
- **THEN** both `playlists` and `playlist_items` tables SHALL exist with the columns, constraints, and indexes defined above

#### Scenario: A video cannot occupy a playlist twice

- **WHEN** a video is already in a playlist and the system attempts to insert the same `(playlist_id, video_id)` pair
- **THEN** the insert SHALL fail with `SQLITE_CONSTRAINT_PRIMARYKEY`, the API SHALL return HTTP 409 with `code=duplicate_video`, and no second row SHALL be created

#### Scenario: Deleting a playlist cascades its items

- **WHEN** a playlist is deleted
- **THEN** all `playlist_items` rows with that `playlist_id` SHALL be deleted in the same transaction

#### Scenario: Deleting a video removes it from all playlists

- **WHEN** a video row is deleted
- **THEN** all `playlist_items` rows referencing that `video_id` SHALL be deleted

### Requirement: Mutation path exclusivity

The system SHALL route every playlist mutation through `src/lib/playlists.ts`. No other module SHALL write to `playlists` or `playlist_items` directly. Every mutation SHALL execute inside a `db.transaction(...)`. Every mutation SHALL update `playlists.updated_at` on the affected row.

#### Scenario: API routes delegate to the library module

- **WHEN** an API route under `src/app/api/playlists/**` handles a write request
- **THEN** it SHALL invoke a function exported by `src/lib/playlists.ts` and SHALL NOT issue SQL against `playlists` or `playlist_items` directly

#### Scenario: Mutation updates updated_at

- **WHEN** any mutation of a playlist or its items completes successfully
- **THEN** that playlist's `updated_at` SHALL be set to the current UTC ISO timestamp within the same transaction

### Requirement: Append and explicit-position insertion

The system SHALL support adding a video to a playlist either by appending (no position specified) or at an explicit position. Appending SHALL place the video at `position = MAX(existing positions) + 1` or at position `1` if the playlist is empty. Explicit-position insertion SHALL shift all items at or above the specified position up by one.

#### Scenario: Append to empty playlist

- **GIVEN** a playlist with zero items
- **WHEN** a video is added without an explicit position
- **THEN** the resulting `playlist_items.position` SHALL equal `1`

#### Scenario: Append to non-empty playlist

- **GIVEN** a playlist whose maximum item position is `N`
- **WHEN** a video is added without an explicit position
- **THEN** the resulting `playlist_items.position` SHALL equal `N + 1`

#### Scenario: Explicit-position insertion shifts subsequent items

- **GIVEN** a playlist with items at positions `[1, 2, 3]`
- **WHEN** a new video is added at position `2`
- **THEN** the prior items' positions SHALL become `[1, 3, 4]` and the new item SHALL be at position `2`

### Requirement: Reorder via position-range renumbering

The system SHALL reorder an existing playlist item by moving it to a new position and renumbering only the affected range. Moving an item to a `new_position` less than its `current_position` SHALL increment by one the positions of items in `[new_position, current_position - 1]`. Moving an item to a `new_position` greater than its `current_position` SHALL decrement by one the positions of items in `[current_position + 1, new_position]`. The reorder SHALL be a no-op when `new_position == current_position`.

#### Scenario: Move item up

- **GIVEN** a playlist with items at `[1:A, 2:B, 3:C, 4:D]`
- **WHEN** `C` is moved to position `2`
- **THEN** the resulting order SHALL be `[1:A, 2:C, 3:B, 4:D]`

#### Scenario: Move item down

- **GIVEN** a playlist with items at `[1:A, 2:B, 3:C, 4:D]`
- **WHEN** `B` is moved to position `4`
- **THEN** the resulting order SHALL be `[1:A, 2:C, 3:D, 4:B]`

#### Scenario: No-op reorder

- **WHEN** a reorder targets the item's current position
- **THEN** the system SHALL NOT issue an UPDATE on any `playlist_items` row and SHALL NOT change `playlists.updated_at`

#### Scenario: Out-of-range position clamps

- **GIVEN** a playlist with `N` items
- **WHEN** a reorder requests position `> N`
- **THEN** the effective new position SHALL be `N`
- **AND WHEN** a reorder requests position `< 1`
- **THEN** the effective new position SHALL be `1`

### Requirement: Idempotent removal

The system SHALL treat removing a video that is not in the playlist as a successful no-op (HTTP 204), not an error. Removing a video from a nonexistent playlist SHALL return HTTP 404.

#### Scenario: Remove non-existent item

- **GIVEN** a playlist that exists but does not contain a given video
- **WHEN** a DELETE request is issued for that `(playlist, video)` pair
- **THEN** the response SHALL be HTTP 204 and no rows SHALL be affected

#### Scenario: Remove from nonexistent playlist

- **WHEN** a DELETE request targets a `playlist_id` that does not exist
- **THEN** the response SHALL be HTTP 404 with `code=playlist_not_found`

### Requirement: List and detail read helpers

The system SHALL expose read helpers that power the `/playlists` list and `/playlists/[id]` detail views.

`listPlaylists()` SHALL return all playlists sorted by `updated_at DESC`. Each row SHALL include `id`, `name`, `description`, `show_on_home`, `item_count`, `updated_at`, and `latest_thumbnail_urls` (up to four thumbnail URLs of the most-recently-added items).

`getPlaylist(id)` SHALL return the playlist row and its items ordered by `position ASC`, each item enriched with the corresponding video row and the video's current `consumption.status`.

`getPlaylistsForVideo(videoId)` SHALL return all playlists containing the given video, sorted by `name ASC`, each including `id`, `name`, and `item_count`.

#### Scenario: listPlaylists ordering

- **WHEN** `listPlaylists()` is invoked
- **THEN** the returned array SHALL be sorted by `updated_at DESC`

#### Scenario: getPlaylist item ordering

- **WHEN** `getPlaylist(id)` is invoked
- **THEN** the `items` field SHALL be ordered by `position ASC`

#### Scenario: Empty playlist

- **WHEN** `getPlaylist(id)` is invoked against an empty playlist
- **THEN** the `items` field SHALL be the empty array and the playlist row SHALL still be returned

### Requirement: Name non-uniqueness

The system SHALL NOT require playlist names to be unique. Two playlists MAY share a name.

#### Scenario: Duplicate name accepted

- **GIVEN** an existing playlist named `"Weekly"`
- **WHEN** a user creates another playlist named `"Weekly"`
- **THEN** the create SHALL succeed and return a new distinct `id`

### Requirement: HTTP error mapping

The system SHALL map library-module errors to HTTP responses as follows: `PlaylistNotFoundError` → HTTP 404 with `code=playlist_not_found`; `VideoNotFoundError` → HTTP 404 with `code=video_not_found`; `DuplicateVideoInPlaylistError` → HTTP 409 with `code=duplicate_video`; `InvalidPositionError` → HTTP 422 with `code=invalid_position`; empty or missing `name` on create → HTTP 422 with `code=invalid_name`.

#### Scenario: Invalid name on create

- **WHEN** `POST /api/playlists` is called with a missing or empty `name`
- **THEN** the response SHALL be HTTP 422 with `code=invalid_name` and no row SHALL be created

#### Scenario: Duplicate insert

- **WHEN** `POST /api/playlists/[id]/items` is called with a `video_id` already present in the playlist
- **THEN** the response SHALL be HTTP 409 with `code=duplicate_video`

### Requirement: show_on_home persisted but unread in phase 1

The system SHALL persist `show_on_home` on `playlists` and SHALL allow the PATCH endpoint to change it, but SHALL NOT read the column for any home-page rendering in phase 1. The column exists so that phase 3's home-view implementation can read it without a further schema migration.

#### Scenario: Column writable, unread

- **WHEN** a user sets `show_on_home = 1` on a playlist during phase 1
- **THEN** the row SHALL persist the new value and no phase-1 code path SHALL branch on it

### Requirement: "Add to playlist" affordance on video cards

The system SHALL render an "Add to playlist" control on every `VideoCard` and `LibraryCard` surface. The control SHALL display existing playlists as a checkbox list indicating current membership, SHALL allow creation of a new playlist inline, and SHALL commit checks/unchecks immediately (no separate save step).

#### Scenario: Toggling membership

- **WHEN** the user checks a playlist entry in the "Add to playlist" popover for a video that is not currently in that playlist
- **THEN** the system SHALL call `POST /api/playlists/[id]/items` with the video id and the control SHALL reflect the new checked state immediately upon success

#### Scenario: Inline create

- **WHEN** the user enters a new playlist name in the "Create new playlist" input within the popover
- **THEN** the system SHALL create the playlist, add the current video to it, and reflect the new checked entry in the list

### Requirement: Coexistence with existing magazine surface

The system SHALL leave all phase-1-external magazine functionality behavior-unchanged. A video MAY simultaneously be in any number of playlists AND be assigned to slots on draft or published issues AND be in any consumption state AND have a channel assigned to a section.

#### Scenario: No regression on issue composition

- **WHEN** a user drags a video from the inbox to a slot on a draft issue after phase 1 is applied
- **THEN** the slot assignment SHALL succeed exactly as before, independent of whether the video is in any playlists
