## MODIFIED Requirements

### Requirement: show_on_home is read by the home page
The system SHALL persist `show_on_home` on `playlists` and SHALL allow the PATCH endpoint to change it. The home page at `/` SHALL read the column and render every playlist with `show_on_home = 1` as a card in the `ShelfRail` component of the consumption-home layout (see `home-view` capability). Playlists with `show_on_home = 0` SHALL NOT appear in `ShelfRail`.

Toggling `show_on_home` on a playlist SHALL take effect on the next `/` render; no cache invalidation SHALL be required.

#### Scenario: Pinned playlist appears on home
- **WHEN** a playlist has `show_on_home = 1`
- **AND** the user visits `/` in the connected-with-corpus branch
- **THEN** the playlist SHALL render as a card in `ShelfRail`

#### Scenario: Unpinned playlist absent from home
- **WHEN** a playlist has `show_on_home = 0`
- **AND** the user visits `/` in the connected-with-corpus branch
- **THEN** the playlist SHALL NOT render in `ShelfRail`

#### Scenario: Toggling takes effect on next render
- **WHEN** the user PATCHes a playlist's `show_on_home` from `0` to `1`
- **AND** subsequently visits or reloads `/`
- **THEN** that playlist SHALL appear in `ShelfRail` on the next render
