## Context

The inbox page today is a Server Component that renders a grid of `VideoCard`s, each wrapping two `ConsumptionAction` client components (Save, Dismiss). Server owns the data; client owns per-button mutation. For keyboard triage, the client needs to know *which* card is focused and dispatch actions against the whole list — a concern that spans cards. That pushes the list itself onto the client.

Constraints:
- Next.js 16 App Router + React 19. Hot paths are RSC; client islands are used sparingly.
- Existing mutation path (`POST /api/consumption`) stays the canonical way to change consumption state. Keyboard is just another trigger for that same call.
- Single-user local app. No accessibility audit target beyond "works with a keyboard"; no screen-reader acceptance criteria.

## Goals / Non-Goals

**Goals:**
- Drop the cost-per-triage from "move mouse, click, wait" to one keystroke.
- Undo a mistaken dismiss without reaching for the mouse.
- Keep the click-to-act path fully working; keyboard is additive.
- Zero new dependencies.

**Non-Goals:**
- Bulk select / "dismiss all from this channel". Useful, but out of scope.
- Keyboard on `/library`, `/watch`, `/`, global app hotkeys. Inbox-only for this change.
- User-configurable bindings.
- Undoing saves. Legal transition graph doesn't allow `saved → inbox` directly, and chaining through `saved → dismissed → inbox` to fake an undo is more surprising than useful.
- Persisted undo (survives page reload). In-memory only.

## Decisions

### Move list rendering into a single client island

The inbox page becomes:

```
InboxPage (RSC)
  └── InboxList (client)       ◀── owns focusedIndex + undo stack + keydown
        └── VideoCard          ◀── unchanged
              └── ConsumptionAction   (still usable for mouse users)
```

`InboxPage` still does the SQLite read; it passes the array of `VideoWithConsumption` down to `InboxList` as props. Navigation via `router.refresh()` after a mutation re-runs the RSC; the server is the source of truth, the client just overlays optimistic removal so keystrokes feel instant.

- **Alternative considered:** keep `InboxPage` as-is, attach a global keyboard listener via a tiny client wrapper. Rejected — the handler still needs the ordered list of videos and a notion of focused row; pushing the list into a single island is cleaner than sharing state through refs.

### One keymap constant, consumed by both the handler and the help overlay

```ts
// src/components/inboxKeymap.ts
export const INBOX_KEYMAP = [
  { keys: ['j'],        action: 'next',     help: 'Next video' },
  { keys: ['k'],        action: 'prev',     help: 'Previous video' },
  { keys: ['g', 'g'],   action: 'top',      help: 'Jump to top' },
  { keys: ['G'],        action: 'bottom',   help: 'Jump to bottom' },
  { keys: ['s'],        action: 'save',     help: 'Save focused video' },
  { keys: ['d'],        action: 'dismiss',  help: 'Dismiss focused video' },
  { keys: ['o'],        action: 'open',     help: 'Open in new tab (YouTube)' },
  { keys: ['u'],        action: 'undo',     help: 'Undo last dismiss' },
  { keys: ['?'],        action: 'help',     help: 'Toggle this help' },
] as const;
```

The help overlay iterates the same constant that the handler switches on. Adding a binding = one line change in one place.

- **Alternative considered:** a library like `tinykeys` or `react-hotkeys-hook`. Rejected — eight bindings don't justify a dep. Handling is a single switch statement.

### Ignore keydown when focus is inside a text field

```ts
function isTextEntry(el: Element | null) {
  if (!el) return false;
  if (el instanceof HTMLInputElement) return true;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  return false;
}
```

Guard at the top of the keydown handler. Prevents `d` from dismissing a card while the user is typing in a search box we haven't added yet (future-proof) and sidesteps accidental triggers from browser dev-tools quirks.

### Focused row indication: ring + scrollIntoView

Visual: `aria-current="true"` on the focused card's root, plus a `data-focused="true"` attribute the card's CSS reads to render a ring. On focus change, `ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })`.

`VideoCard` already owns its styling; the ring is toggled via a passed-in `focused: boolean` prop that triggers the data attribute. Keeping the card styling dumb (no `useContext`) keeps the mouse-only path untouched.

### Undo is client-local and dismiss-only

On dismiss, push `{ videoId, prevStatus: 'inbox' }` onto an in-memory stack and optimistically remove the card. `u` pops the top entry and POSTs `{ videoId, next: 'inbox' }` (legal: `dismissed → inbox`). On a page reload the stack is lost — the dismiss is permanent (the user can still recover it by searching the DB or, later, a dismissed-items view).

Why dismiss-only:
- `dismissed → inbox` is legal in the transition matrix; `saved → inbox` is not.
- Undoing a save is ambiguous ("put it back where I saw it" ≠ any single legal state). Dismiss is unambiguous.
- We can always add save-undo later by extending the transition matrix; not worth the scope now.

### Help overlay

Simple modal component: backdrop + centered panel listing each `INBOX_KEYMAP` entry as `keys — help`. `?` toggles; `Esc` closes. No focus trap (single-user tool, low stakes). Rendered inside `InboxList` so it shares state.

### Optimistic removal + eventual consistency via `router.refresh()`

The current `ConsumptionAction` already calls `router.refresh()` after a successful POST. In the keyboard flow we go further: remove the row from the rendered list immediately (before the POST resolves), then `router.refresh()` when it does. If the POST fails, the row is re-inserted and an inline error toast shows. Matches the mouse UX latency-wise while giving keyboard users the rapid-fire feel they want.

## Risks / Trade-offs

- **Keyboard focus desync with DOM reorder.** If a fetcher adds a new inbox video while the user is triaging, `router.refresh()` will re-render the list and the `focusedIndex` may point at a different video. Mitigation: keep focus as `focusedVideoId` (not an index) and re-resolve to the new position on each render; if the focused video is gone, advance to the next.
- **`?` as a binding requires Shift on US keyboards.** Handled — the `KeyboardEvent.key` value is already `?` after shift resolution. Document it; if it trips the user we can map `/` too.
- **Browsers intercept some keys.** `g` chord, `j`/`k` are fine. `o` may conflict in Vimium-style browser extensions; accept it — the user controls their extensions.
- **Loss of undo on reload.** Accepted; a durable undo would need a server-side "recent transitions" log for one binding. Not worth it.

## Open Questions

- Should `s` also work on the `/library` page for a Saved → Archive move? Probably yes eventually, but out of scope here.
- Should the focused card auto-open on `Enter`? Leaning yes (free binding) — easy to add if the user wants it. Leaving out of v1 so we can see if `o` (open in new tab) covers the need.
- Do we want a "jump to next unseen channel" binding once the inbox grows into the thousands? Deferrable — single-press channel grouping is a heavier change.
