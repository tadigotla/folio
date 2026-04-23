## MODIFIED Requirements

### Requirement: Home page routes to appropriate state
The system SHALL render `/` as a server component that branches on connection + corpus state:

1. **Not connected** (no `oauth_tokens` row for `provider = 'youtube'`) → render a "Connect your YouTube account" CTA linking to `/settings/youtube`. No rails SHALL render.
2. **Connected, empty corpus** (`SELECT COUNT(*) FROM videos = 0`) → render an "Import your library" CTA linking to `/settings/youtube`. No rails SHALL render.
3. **Connected, non-empty corpus** → render the consumption-home rail stack described in the "Consumption-home layout" requirement. The editor workspace, slot board, draft controls, and chat panel SHALL NOT render on `/` under any branch.

The draft-based branching that previously lived on `/` (no-draft empty state, draft-present board + chat panel) SHALL NOT render on `/` in any form. That surface renders at `/compose` (see `editorial-workspace` capability).

#### Scenario: Not connected
- **WHEN** the user visits `/` and no `oauth_tokens` row exists
- **THEN** the page SHALL render the Connect CTA and SHALL NOT query for draft issues, pool videos, conversation turns, rail candidates, `in_progress` videos, or home-pinned playlists

#### Scenario: Connected but corpus empty
- **WHEN** the user visits `/` with a token but zero rows in `videos`
- **THEN** the page SHALL render the Import CTA and SHALL NOT render any rail, the editor workspace, or the chat panel

#### Scenario: Connected and non-empty
- **WHEN** the user visits `/` with a token and a non-empty `videos` table
- **THEN** the page SHALL render the consumption-home rail stack
- **AND** the page SHALL NOT render the slot board, new-draft button, title input, publish button, discard button, or chat panel regardless of whether a draft issue exists

### Requirement: TopNav reflects editorial workspace
The top navigation SHALL include a `Compose` link pointing at `/compose` (the editor workspace route). It SHALL also include links to `/taste` (labeled "★ Taste") and other tertiary routes (library, playlists, issues, settings). It SHALL NOT include a link to `/inbox` (the route remains deleted).

#### Scenario: Compose link present
- **WHEN** any page renders the TopNav
- **THEN** the TopNav SHALL contain an anchor labeled `Compose` whose `href` is `/compose`

#### Scenario: Navigation links
- **WHEN** any page renders the TopNav
- **THEN** the visible top-level links SHALL be a subset that includes `Library`, `Playlists`, `Compose`, `★ Taste`; `Inbox` and `raw inbox` SHALL NOT be present

## ADDED Requirements

### Requirement: Consumption-home layout
When `/` renders in the connected-with-corpus branch, it SHALL compose a vertical stack of rails in the following order: `RightNowRail` (see `home-ranking` capability), `ContinueRail`, `ShelfRail`, and a footer entry-point strip. The masthead title card ("Folio / A personal video magazine") SHALL NOT render.

Each rail SHALL render via a server component that reads SQLite directly through a dedicated helper. No rail SHALL block another's render; one rail returning an empty list SHALL NOT hide any other rail.

#### Scenario: Rail ordering
- **WHEN** `/` renders in the connected-with-corpus branch and all three rails have candidates
- **THEN** `RightNowRail` SHALL appear first, `ContinueRail` second, `ShelfRail` third, and the entry-point footer last

#### Scenario: Masthead removed
- **WHEN** `/` renders in the connected-with-corpus branch
- **THEN** the "Folio / A personal video magazine" masthead title card SHALL NOT render

### Requirement: Continue rail surfaces in-progress videos
The `ContinueRail` component SHALL render up to four `in_progress` videos on `/`. Candidates SHALL be selected by `consumption.status = 'in_progress'` ordered by `COALESCE(last_viewed_at, status_changed_at) DESC`. Each card SHALL link to `/watch/[id]` and SHALL render the existing thumbnail, title, channel name, duration, and progress bar (`last_position_seconds / duration_seconds`). The rail SHALL render nothing when no `in_progress` rows exist — no empty-state message.

#### Scenario: Candidates present
- **WHEN** the corpus has 6 `in_progress` rows
- **THEN** `ContinueRail` SHALL render exactly 4 cards, ordered by `COALESCE(last_viewed_at, status_changed_at) DESC`

#### Scenario: Empty state hides the rail
- **WHEN** the corpus has zero `in_progress` rows
- **THEN** `ContinueRail` SHALL render no DOM at all (not a heading, not a message, not a container)

#### Scenario: Progress bar visible
- **WHEN** a rendered `ContinueRail` card has both `last_position_seconds` and `duration_seconds` set
- **THEN** the card SHALL render a progress bar whose width is `min(100%, last_position_seconds / duration_seconds * 100%)`

### Requirement: Shelf rail surfaces home-pinned playlists
The `ShelfRail` component SHALL render every playlist with `show_on_home = 1` on `/`. Candidates SHALL be ordered by `playlists.updated_at DESC`. Each card SHALL link to `/playlists/[id]` and SHALL render the playlist name, description (if present), and item count. The rail SHALL render nothing when no playlist has `show_on_home = 1`.

#### Scenario: Pinned playlists present
- **WHEN** 3 playlists have `show_on_home = 1` and 5 do not
- **THEN** `ShelfRail` SHALL render exactly 3 cards, ordered by `updated_at DESC`

#### Scenario: Empty state hides the rail
- **WHEN** no playlist has `show_on_home = 1`
- **THEN** `ShelfRail` SHALL render no DOM

#### Scenario: Card links to detail
- **WHEN** the user clicks a `ShelfRail` card for playlist id 7
- **THEN** the browser SHALL navigate to `/playlists/7`

### Requirement: Entry-point footer
The home page SHALL render a quiet entry-point footer at the bottom of the consumption-home rail stack. The footer SHALL contain anchors to `/library`, `/playlists`, `/taste`, `/compose`, and `/settings/youtube`. The footer SHALL render even when the rails above it are empty (so a low-state user can still navigate).

#### Scenario: Footer visible on empty rails
- **WHEN** `/` renders in the connected-with-corpus branch and all three rails are empty
- **THEN** the entry-point footer SHALL still render with all five anchors
