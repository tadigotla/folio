## ADDED Requirements

### Requirement: Workspace renders a chat panel co-equal with the slot board

The editor workspace SHALL render a two-column layout on desktop user agents: the existing slot board (cover, featured, brief slots, plus the inbox pool and title input) on the left, and a new chat panel on the right. The chat panel SHALL bind to the same draft issue as the board. Both columns SHALL be visible without scrolling at typical desktop widths (≥1280px). On narrower desktops the chat panel SHALL collapse below the board rather than overlap it.

#### Scenario: Two-column layout on wide desktop
- **GIVEN** the user is on `/` with a draft issue and a desktop user agent at viewport ≥1280px
- **WHEN** the page renders
- **THEN** the slot board SHALL appear in the left column
- **AND** the chat panel SHALL appear in the right column
- **AND** both SHALL be visible above the fold

#### Scenario: Stacked layout on narrow desktop
- **GIVEN** the user is on `/` with a draft issue and a desktop user agent at viewport <1280px
- **WHEN** the page renders
- **THEN** the slot board and chat panel SHALL stack vertically
- **AND** neither SHALL overlap the other

### Requirement: Chat panel hidden on mobile

The workspace mobile branch SHALL retain the existing "open on desktop" message; the chat panel SHALL NOT render on mobile user agents.

#### Scenario: Mobile user agent
- **GIVEN** the user is on `/` with a draft issue and a mobile user agent
- **WHEN** the page renders
- **THEN** the existing desktop-only message SHALL render
- **AND** no chat panel DOM SHALL be present

### Requirement: Chat panel degrades gracefully without an API key

The chat panel SHALL render in a disabled-but-visible state when `ANTHROPIC_API_KEY` is unset (as reported by `GET /api/agent/status`). The composer SHALL be disabled and an inline card SHALL explain how to set the key. The slot board SHALL remain fully functional.

#### Scenario: API key absent
- **GIVEN** `GET /api/agent/status` returns `{ apiKeyPresent: false }`
- **WHEN** the chat panel renders
- **THEN** the composer SHALL be disabled (no input focus, no send button)
- **AND** an inline card SHALL link to the runbook section explaining how to set `ANTHROPIC_API_KEY`
- **AND** the slot board, drag affordances, keyboard shortcuts, publish, and discard SHALL work unchanged

#### Scenario: API key rejected at runtime
- **GIVEN** `ANTHROPIC_API_KEY` is set but the first call to `POST /api/agent/message` returns 401
- **WHEN** the chat panel processes the error
- **THEN** the panel SHALL render the same disabled-card state as the missing-key case
- **AND** the runbook link SHALL include a note about the rejected key

### Requirement: Slot mutations originate from agent or user with identical semantics

Slot rows in `issue_slots` SHALL be the single source of truth regardless of whether the change originated from the chat panel, the drag board, or the keyboard. The slot-mutation endpoint SHALL be the only writer; the agent's `assign_slot`, `swap_slots`, and `clear_slot` tools SHALL invoke the same library-level path. After an agent-driven slot change, the board view SHALL reflect the new state without a manual page reload.

#### Scenario: Agent assignment updates the board
- **GIVEN** the chat panel is open and the cover slot is empty
- **WHEN** the agent calls `assign_slot` for video `vid_a` to cover slot 0
- **THEN** the slot-mutation endpoint SHALL be invoked server-side
- **AND** the board SHALL reflect the new cover within ~200ms (via `router.refresh()` triggered by the SSE handler)

#### Scenario: User drag and agent fill produce identical rows
- **GIVEN** both a user-drag and an agent-assign produce the same logical action (assign vid_a to cover slot 0 of issue 7)
- **WHEN** the resulting `issue_slots` row is inspected
- **THEN** the row SHALL be byte-identical (same `video_id`, `assigned_at`, `slot_kind`, `slot_index`)

### Requirement: Conversation hydration on page load

When `/` mounts with a draft issue that has an existing conversation, the chat panel SHALL hydrate from `GET /api/agent/conversation/[issueId]` once on mount. The panel SHALL render persisted turns in order before accepting new composer input.

#### Scenario: Existing conversation rehydrates
- **GIVEN** an open draft with 4 persisted conversation turns
- **WHEN** the user navigates to `/`
- **THEN** the chat panel SHALL render those 4 turns in order before the composer is enabled
- **AND** the user SHALL be able to send a fifth turn that appends to the same conversation

#### Scenario: New draft starts empty
- **GIVEN** a draft with no `conversations` row
- **WHEN** `/` mounts
- **THEN** the chat panel SHALL render an empty state with a one-line prompt suggestion
- **AND** the composer SHALL be enabled immediately
