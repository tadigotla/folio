## MODIFIED Requirements

### Requirement: Home page routes to appropriate state
The system SHALL render `/` as a server component that branches on connection + corpus + draft state:

1. **Not connected** (no `oauth_tokens` row for `provider = 'youtube'`) → render a "Connect your YouTube account" CTA linking to `/settings/youtube`.
2. **Connected, empty corpus** (`SELECT COUNT(*) FROM videos = 0`) → render an "Import your library" CTA linking to `/settings/youtube`.
3. **Connected, non-empty corpus, no draft** → render the editor workspace empty state (see `editorial-workspace`) with a **New issue** button. The chat panel SHALL NOT render in this branch (no draft = no conversation context).
4. **Connected, non-empty corpus, draft exists** → render the editor workspace board + pool **and the chat panel** for the current draft (see `editorial-workspace`). On desktop user agents the layout SHALL be two-column (board left, chat right) at viewports ≥1280px and stacked at narrower desktops; on mobile user agents the desktop-only message SHALL render and the chat panel SHALL be omitted entirely.

#### Scenario: Not connected
- **WHEN** the user visits `/` and no `oauth_tokens` row exists
- **THEN** the page SHALL render the Connect CTA and SHALL NOT query for draft issues, pool videos, or conversation turns

#### Scenario: Connected but corpus empty
- **WHEN** the user visits `/` with a token but zero rows in `videos`
- **THEN** the page SHALL render the Import CTA and SHALL NOT render the editor workspace or the chat panel

#### Scenario: Connected and non-empty, no draft
- **WHEN** the user visits `/` with a token, a non-empty `videos` table, and no draft issue
- **THEN** the page SHALL render the workspace empty state with a **New issue** button
- **AND** the chat panel SHALL NOT render

#### Scenario: Connected and non-empty, draft exists, desktop wide
- **WHEN** the user visits `/` with a token, a non-empty `videos` table, a draft issue, and a desktop user agent at viewport ≥1280px
- **THEN** the page SHALL render the 14-slot board, the inbox pool, a title input, **Publish** / **Discard** controls, **and the chat panel** for the current draft
- **AND** the layout SHALL be two-column (board left, chat right)

#### Scenario: Connected and non-empty, draft exists, narrow desktop
- **WHEN** the user visits `/` with a token, a non-empty `videos` table, a draft issue, and a desktop user agent at viewport <1280px
- **THEN** the same elements SHALL render
- **AND** the layout SHALL stack vertically (board on top, chat below)

#### Scenario: Connected and non-empty, draft exists, mobile
- **WHEN** the user visits `/` with a token, a non-empty `videos` table, a draft issue, and a mobile user agent
- **THEN** the existing desktop-only message SHALL render
- **AND** neither the board nor the chat panel SHALL render

### Requirement: TopNav reflects editorial workspace
The top navigation SHALL include links to `/issues` (labeled "Issues") and `/taste` (labeled "★ Taste"). It SHALL NOT include a link to `/inbox` (the route is deleted).

#### Scenario: Navigation links
- **WHEN** any page renders the TopNav
- **THEN** the visible top-level links SHALL be a subset that includes `Library`, `Archive`, `Sections`, `Issues`, `★ Taste`, `YouTube`; `Inbox` and `raw inbox` SHALL NOT be present
