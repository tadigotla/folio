## ADDED Requirements

### Requirement: Home page routes to appropriate state
The system SHALL render `/` as a server component that branches on connection + corpus + draft state:

1. **Not connected** (no `oauth_tokens` row for `provider = 'youtube'`) → render a "Connect your YouTube account" CTA linking to `/settings/youtube`.
2. **Connected, empty corpus** (`SELECT COUNT(*) FROM videos = 0`) → render an "Import your library" CTA linking to `/settings/youtube`.
3. **Connected, non-empty corpus, no draft** → render the editor workspace empty state (see `editorial-workspace`) with a **New issue** button.
4. **Connected, non-empty corpus, draft exists** → render the editor workspace board + pool for the current draft (see `editorial-workspace`).

On mobile user agents, branches (3) and (4) SHALL be replaced by a desktop-only message per the `editorial-workspace` desktop-only requirement.

#### Scenario: Not connected
- **WHEN** the user visits `/` and no `oauth_tokens` row exists
- **THEN** the page SHALL render the Connect CTA and SHALL NOT query for draft issues or pool videos

#### Scenario: Connected but corpus empty
- **WHEN** the user visits `/` with a token but zero rows in `videos`
- **THEN** the page SHALL render the Import CTA and SHALL NOT render the editor workspace

#### Scenario: Connected and non-empty, no draft
- **WHEN** the user visits `/` with a token, a non-empty `videos` table, and no draft issue
- **THEN** the page SHALL render the workspace empty state with a **New issue** button

#### Scenario: Connected and non-empty, draft exists
- **WHEN** the user visits `/` with a token, a non-empty `videos` table, and a draft issue
- **THEN** the page SHALL render the 14-slot board, the inbox pool, a title input, and **Publish** / **Discard** controls

### Requirement: TopNav reflects editorial workspace
The top navigation SHALL include a link to `/issues` (labeled "Issues"). It SHALL NOT include a link to `/inbox` (the route is deleted in this change).

#### Scenario: Navigation links
- **WHEN** any page renders the TopNav
- **THEN** the visible top-level links SHALL be a subset that includes `Library`, `Archive`, `Sections`, `Issues`, `YouTube`; `Inbox` and `raw inbox` SHALL NOT be present
