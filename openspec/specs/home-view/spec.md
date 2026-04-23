# Home View

The consumption-first `/` route. The page renders the rails the user uses to
decide what to watch right now; it has no composition surface, no draft
issue, no chat panel, and no magazine vocabulary.

### Requirement: Home page routes to appropriate state

The system SHALL render `/` as a server component that branches on connection + corpus state:

1. **Not connected** (no `oauth_tokens` row for `provider = 'youtube'`) → render a "Connect your YouTube account" CTA linking to `/settings/youtube`. No rails SHALL render.
2. **Connected, empty corpus** (`SELECT COUNT(*) FROM videos = 0`) → render an "Import your library" CTA linking to `/settings/youtube`. No rails SHALL render.
3. **Connected, non-empty corpus** → render the consumption-home rail stack described in the "Consumption-home layout" requirement.

The editor workspace, slot board, draft controls, chat panel, masthead, and any issue-composition affordances SHALL NOT render on `/` under any branch. The `/compose` route (the phase-3 burn-in holdout) no longer exists; `/` is the sole consumption entry point.

#### Scenario: Not connected

- **WHEN** the user visits `/` and no `oauth_tokens` row exists
- **THEN** the page SHALL render the Connect CTA and SHALL NOT query for pool videos, rail candidates, `in_progress` videos, or home-pinned playlists

#### Scenario: Connected but corpus empty

- **WHEN** the user visits `/` with a token but zero rows in `videos`
- **THEN** the page SHALL render the Import CTA and SHALL NOT render any rail

#### Scenario: Connected and non-empty

- **WHEN** the user visits `/` with a token and a non-empty `videos` table
- **THEN** the page SHALL render the consumption-home rail stack
- **AND** the page SHALL NOT render the slot board, title input, publish button, discard button, masthead, or chat panel

### Requirement: TopNav reflects the consumption home

The top navigation SHALL include links to `/library`, `/playlists`, `/inbox`, `/taste` (labeled "★ Taste"), and `/settings/youtube`. It SHALL NOT include a link to `/compose`, `/issues`, `/sections`, or `/section/[slug]` — those routes no longer exist. The TopNav SHALL NOT include any affordance labeled `Compose`, `Publish`, `New Issue`, `Masthead`, or any other magazine-framing vocabulary.

#### Scenario: Compose link absent

- **WHEN** any page renders the TopNav
- **THEN** the TopNav SHALL NOT contain any anchor whose `href` is `/compose` or whose visible label is "Compose"

#### Scenario: Navigation links

- **WHEN** any page renders the TopNav
- **THEN** the visible top-level links SHALL be a subset of `Library`, `Playlists`, `Inbox`, `★ Taste`, `Settings`; no anchor SHALL point to `/issues`, `/sections`, `/section/*`, or `/compose`

### Requirement: Consumption-home layout

When `/` renders in the connected-with-corpus branch, it SHALL compose a vertical stack of rails in the following order: `RightNowRail` (see `home-ranking` capability), `ContinueRail`, `ShelfRail`, and a footer entry-point strip. The masthead title card ("Folio / A personal video magazine") SHALL NOT render; no heading containing the words *magazine*, *issue*, *cover*, *featured*, *brief*, *slot*, *publish*, *draft*, or *masthead* SHALL render.

Each rail SHALL render via a server component that reads SQLite directly through a dedicated helper. No rail SHALL block another's render; one rail returning an empty list SHALL NOT hide any other rail.

#### Scenario: Rail ordering

- **WHEN** `/` renders in the connected-with-corpus branch and all three rails have candidates
- **THEN** `RightNowRail` SHALL appear first, `ContinueRail` second, `ShelfRail` third, and the entry-point footer last

#### Scenario: Magazine vocabulary absent

- **WHEN** `/` renders in the connected-with-corpus branch
- **THEN** the rendered HTML SHALL NOT contain any of the words *magazine*, *issue*, *cover*, *featured*, *brief*, *slot*, *publish*, *draft*, or *masthead* in visible text (case-insensitive, word-boundary match)

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

The home page SHALL render a quiet entry-point footer at the bottom of the consumption-home rail stack. The footer SHALL contain anchors to `/library`, `/playlists`, `/inbox`, `/taste`, and `/settings/youtube`. It SHALL NOT contain an anchor to `/compose`, `/issues`, or `/sections`. The footer SHALL render even when the rails above it are empty (so a low-state user can still navigate).

#### Scenario: Footer visible on empty rails

- **WHEN** `/` renders in the connected-with-corpus branch and all three rails are empty
- **THEN** the entry-point footer SHALL still render with all five anchors (`/library`, `/playlists`, `/inbox`, `/taste`, `/settings/youtube`)

#### Scenario: No retired routes linked

- **WHEN** `/` renders the entry-point footer
- **THEN** no anchor in the footer SHALL point at `/compose`, `/issues`, `/issues/[id]`, `/sections`, or `/section/[slug]`
