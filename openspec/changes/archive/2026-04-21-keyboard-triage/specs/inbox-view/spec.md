## MODIFIED Requirements

### Requirement: Inbox keyboard bindings
The inbox page SHALL respond to keyboard input without requiring modifier keys. The following bindings SHALL be active whenever the user's focus is NOT inside an `<input>`, `<textarea>`, or `contenteditable` element:

- `j` — move focus to the next inbox card (no-op on the last)
- `k` — move focus to the previous inbox card (no-op on the first)
- `g` `g` — move focus to the first inbox card (chord: two `g` presses within 500ms)
- `G` — move focus to the last inbox card
- `s` — transition the focused card's video to `consumption.status = 'saved'`
- `d` — transition the focused card's video to `consumption.status = 'dismissed'`
- `o` — open the focused video's YouTube page in a new tab (no consumption change)
- `u` — undo the most recent dismiss from this page session (transition that video back to `inbox`)
- `?` — toggle the keyboard help overlay

When a handled key fires, the handler SHALL call `event.preventDefault()` so that browser-level bindings (e.g. quick-find on `/`) do not also fire.

#### Scenario: Navigation with j/k
- **WHEN** the inbox has at least two cards and the user presses `j`
- **THEN** the focused card SHALL advance to the next video in the list (top-to-bottom, left-to-right for grid layouts)

#### Scenario: Save via keyboard
- **WHEN** a card is focused and the user presses `s`
- **THEN** a POST to `/api/consumption` with `{ videoId, next: 'saved' }` SHALL be issued, the card SHALL be optimistically removed from the list, and focus SHALL move to the next remaining card (or clear if the list empties)

#### Scenario: Dismiss via keyboard
- **WHEN** a card is focused and the user presses `d`
- **THEN** a POST to `/api/consumption` with `{ videoId, next: 'dismissed' }` SHALL be issued, the card SHALL be optimistically removed, an undo entry `{ videoId, prevStatus: 'inbox' }` SHALL be pushed onto the in-memory undo stack, and focus SHALL advance as in the save case

#### Scenario: Keybindings suppressed in text fields
- **WHEN** the user's focus is inside an `<input>` / `<textarea>` / `contenteditable` element and they press `d`
- **THEN** no consumption mutation SHALL occur; the keystroke SHALL pass through to the text field unchanged

#### Scenario: Undo after dismiss
- **WHEN** the user dismisses a video via `d` and then presses `u` before a page reload
- **THEN** a POST to `/api/consumption` with `{ videoId, next: 'inbox' }` SHALL be issued and the video SHALL return to the inbox list on the next refresh

#### Scenario: Open in new tab
- **WHEN** a card is focused and the user presses `o`
- **THEN** `https://www.youtube.com/watch?v={id}` SHALL open in a new browser tab and `consumption.status` SHALL remain unchanged

### Requirement: Focused-row indicator
The inbox page SHALL visually distinguish the currently-focused card from the rest of the list.

#### Scenario: Initial focus on page load
- **WHEN** the inbox page renders with at least one card
- **THEN** the first card SHALL be visually marked as focused (via a visible ring or equivalent) and its root element SHALL carry `aria-current="true"`

#### Scenario: Focus follows navigation
- **WHEN** the user presses `j` or `k` (or `g g` / `G`)
- **THEN** the focused visual indicator SHALL move to the new card and the new card SHALL be scrolled into view if it is not already visible

#### Scenario: Focus after focused card is removed
- **WHEN** the focused card is saved or dismissed
- **THEN** focus SHALL advance to the next card (or the previous card if the focused card was last), OR SHALL clear if the list becomes empty

### Requirement: Keyboard help overlay
The inbox page SHALL provide a help overlay listing every active keybinding and its effect, toggled by the `?` key.

#### Scenario: Opening the overlay
- **WHEN** the user presses `?` on the inbox page
- **THEN** an overlay SHALL render listing every keybinding from the canonical keymap along with its human description

#### Scenario: Closing the overlay
- **WHEN** the help overlay is open and the user presses `Esc` or clicks the backdrop
- **THEN** the overlay SHALL close and keyboard bindings SHALL remain active

### Requirement: Optimistic mutation with failure recovery
Keyboard-initiated save/dismiss/undo actions SHALL update the rendered list optimistically before the server POST resolves.

#### Scenario: POST succeeds
- **WHEN** a keyboard action's POST returns 2xx
- **THEN** the optimistic UI SHALL be reconciled with the server via `router.refresh()` and no error UI SHALL appear

#### Scenario: POST fails
- **WHEN** a keyboard action's POST returns non-2xx or throws
- **THEN** the removed card SHALL be re-inserted at its prior position, focus SHALL return to it, and an inline error banner SHALL display for at least 4 seconds
