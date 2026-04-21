## 1. Client island structure

- [x] 1.1 Create `src/components/inboxKeymap.ts` exporting `INBOX_KEYMAP` — an ordered list of `{ keys, action, help }` entries (see design.md for the canonical list)
- [x] 1.2 Create `src/components/InboxList.tsx` — client component taking `videos: VideoWithConsumption[]` as prop; owns `focusedVideoId`, `undoStack`, `helpOpen` state; renders the grid that `inbox/page.tsx` used to render inline
- [x] 1.3 Refactor `src/app/inbox/page.tsx` to pass `videos` into `<InboxList>`; keep the `← Home` link, heading, and empty-state in the RSC

## 2. Focused-row indicator

- [x] 2.1 Thread a `focused?: boolean` prop into `src/components/VideoCard.tsx`; when true, add `data-focused="true"` and `aria-current="true"` on the root element
- [x] 2.2 Extend the card's Tailwind classes to render a visible ring when `data-focused` is set
- [x] 2.3 In `InboxList`, attach a ref to each card's root; on focus change, call `ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })`
- [x] 2.4 Initialize `focusedVideoId` to `videos[0]?.id ?? null`; when the focused video is removed (optimistically or via server refresh), advance to the next one, or to the previous if it was the last

## 3. Keyboard handler

- [x] 3.1 In `InboxList`, attach a `window` `keydown` listener on mount (remove on unmount). Guard with `isTextEntry(document.activeElement)` — bail if true
- [x] 3.2 Implement a `g g` chord: after `g` with no modifier, wait up to 500ms for a second `g` before treating the first as a no-op
- [x] 3.3 Switch on `event.key` against `INBOX_KEYMAP`; prevent default for handled keys so browser-level bindings (e.g. quick-find) don't fire
- [x] 3.4 Implement actions:
  - [x] 3.4.1 `next` / `prev` — move `focusedVideoId` within `videos`
  - [x] 3.4.2 `top` / `bottom` — jump to first/last
  - [x] 3.4.3 `save` — POST `{ videoId: focusedVideoId, next: 'saved' }`; optimistically remove from list; on failure, re-insert and flash inline error
  - [x] 3.4.4 `dismiss` — same as save but `next: 'dismissed'`; additionally push `{ videoId, prevStatus: 'inbox' }` onto `undoStack`
  - [x] 3.4.5 `open` — `window.open(`https://www.youtube.com/watch?v=${id}`, '_blank', 'noopener')`; does not change consumption
  - [x] 3.4.6 `undo` — pop top of `undoStack`; POST `{ videoId, next: 'inbox' }`; after `router.refresh()` the row re-appears in the server-rendered list
  - [x] 3.4.7 `help` — toggle `helpOpen`

## 4. Help overlay

- [x] 4.1 Create `src/components/InboxHelpOverlay.tsx` — client component taking `open: boolean`, `onClose: () => void`; renders a dim backdrop + panel iterating `INBOX_KEYMAP`
- [x] 4.2 Close on `Esc` (handled inside the overlay — do not propagate) or on backdrop click
- [x] 4.3 Format each row as `<kbd>key</kbd> — help`; chord entries (`g g`) render as two kbd tags

## 5. Error UX

- [x] 5.1 When a POST from a keyboard action fails, render an inline toast-like banner at the top of the list (`"Failed: could not dismiss. Press u to retry."`); auto-dismiss after 4 seconds
- [x] 5.2 On failure, re-insert the optimistically removed card at its prior index and re-focus it

## 6. Spec + verify

- [x] 6.1 Update `openspec/changes/keyboard-triage/specs/inbox-view/spec.md` per the MODIFIED requirements here
- [x] 6.2 `npm run lint`
- [x] 6.3 `npm run build`
- [x] 6.4 Manual: on `/inbox`, press `?` to open help, `j` / `k` / `g g` / `G` to navigate, `s` and `d` on known-legal rows, `u` after a dismiss, `o` to confirm new-tab opens the correct YouTube URL, then click a button with the mouse to confirm the legacy path still works
- [x] 6.5 Manual: focus a hypothetical input (e.g. paste `<input>` into the DOM via devtools) and confirm `d` does not dismiss while it is focused
