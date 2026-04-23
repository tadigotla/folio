## MODIFIED Requirements

### Requirement: Editor workspace UI
The system SHALL expose an editor workspace at `/compose` for connected accounts with a non-empty corpus. Visiting `/compose` without a connected account or with an empty corpus SHALL redirect to `/` (where the empty-state CTAs live). The workspace SHALL display a slot board on one side showing the 14 slots of the current draft (empty slots rendered as placeholders) and an inbox pool on the other side showing the candidate videos per the pool query. When no draft issue exists, the workspace SHALL render a **New issue** button that `POST /api/issues`. When a draft exists, the workspace SHALL render the board + pool with drag-and-drop affordances, a title input for the draft, and **Publish** and **Discard** buttons.

The workspace SHALL NOT render on `/` under any branch. `/` is owned by the `home-view` capability and renders the consumption-home rail stack.

#### Scenario: No draft, empty-state CTA
- **WHEN** the user visits `/compose` with a connected account, non-empty corpus, and no draft issue
- **THEN** the workspace SHALL render a "No draft yet" message and a **New issue** button; the board and pool SHALL NOT be rendered

#### Scenario: Draft exists, full workspace
- **WHEN** the user visits `/compose` with a connected account and a draft issue
- **THEN** the workspace SHALL render the 14-slot board (any empty slots as placeholders), the inbox pool on the side, a title input, and **Publish** / **Discard** buttons

#### Scenario: Drag pool to empty slot
- **WHEN** the user drags a pool video card onto an empty slot and releases
- **THEN** the client SHALL POST an `assign` action; on success, the card SHALL appear in the slot and be removed from the pool

#### Scenario: Drag slot to occupied slot (swap)
- **WHEN** the user drags a slot card onto another occupied slot and releases
- **THEN** the client SHALL POST a `swap` action and both slots' video assignments SHALL be exchanged

#### Scenario: Drag slot off the board (clear)
- **WHEN** the user drags a slot card into the pool area and releases
- **THEN** the client SHALL POST a `clear` action; on success, the slot SHALL be empty and the video SHALL reappear in the pool

#### Scenario: `/compose` without corpus redirects home
- **WHEN** the user visits `/compose` while not connected, or with zero `videos` rows
- **THEN** the response SHALL redirect to `/`
- **AND** the workspace SHALL NOT render

### Requirement: Desktop-only workspace
The editor workspace SHALL detect mobile user agents and render a simplified "open on desktop" message in place of the board + pool on `/compose`. Drag-and-drop SHALL NOT be invoked on mobile.

#### Scenario: Mobile visits compose
- **WHEN** a request to `/compose` arrives with a user-agent matching the existing `isMobileUserAgent` helper
- **THEN** the workspace SHALL render a text message instructing the user to open the app on desktop, and the drag-and-drop components SHALL NOT mount

### Requirement: Workspace renders a chat panel co-equal with the slot board

The editor workspace SHALL render a two-column layout on desktop user agents: the existing slot board (cover, featured, brief slots, plus the inbox pool and title input) on the left, and the chat panel on the right. The chat panel SHALL bind to the same draft issue as the board. Both columns SHALL be visible without scrolling at typical desktop widths (≥1280px). On narrower desktops the chat panel SHALL collapse below the board rather than overlap it. The two-column layout SHALL render at `/compose`; `/` SHALL NOT render the chat panel under any branch.

#### Scenario: Two-column layout on wide desktop
- **GIVEN** the user is on `/compose` with a draft issue and a desktop user agent at viewport ≥1280px
- **WHEN** the page renders
- **THEN** the slot board SHALL appear in the left column
- **AND** the chat panel SHALL appear in the right column
- **AND** both SHALL be visible above the fold

#### Scenario: Stacked layout on narrow desktop
- **GIVEN** the user is on `/compose` with a draft issue and a desktop user agent at viewport <1280px
- **WHEN** the page renders
- **THEN** the slot board and chat panel SHALL stack vertically
- **AND** neither SHALL overlap the other

### Requirement: Chat panel hidden on mobile

The workspace mobile branch on `/compose` SHALL retain the existing "open on desktop" message; the chat panel SHALL NOT render on mobile user agents. The chat panel SHALL NOT render on `/` under any user agent.

#### Scenario: Mobile user agent
- **GIVEN** the user is on `/compose` with a draft issue and a mobile user agent
- **WHEN** the page renders
- **THEN** the existing desktop-only message SHALL render
- **AND** no chat panel DOM SHALL be present

### Requirement: Conversation hydration on page load

When `/compose` mounts with a draft issue that has an existing conversation, the chat panel SHALL hydrate from `GET /api/agent/conversation/[issueId]` once on mount. The panel SHALL render persisted turns in order before accepting new composer input.

#### Scenario: Existing conversation rehydrates
- **GIVEN** an open draft with 4 persisted conversation turns
- **WHEN** the user navigates to `/compose`
- **THEN** the chat panel SHALL render those 4 turns in order before the composer is enabled
- **AND** the user SHALL be able to send a fifth turn that appends to the same conversation

#### Scenario: New draft starts empty
- **GIVEN** a draft with no `conversations` row
- **WHEN** `/compose` mounts
- **THEN** the chat panel SHALL render an empty state with a one-line prompt suggestion
- **AND** the composer SHALL be enabled immediately
