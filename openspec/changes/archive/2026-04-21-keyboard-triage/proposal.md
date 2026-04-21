## Why

The inbox currently holds 670 untriaged videos. The only way to clear it is clicking Save or Dismiss on each card, one at a time, mouse-only. That friction is why the pile keeps growing.

The original `rename-to-videos` proposal bundled keyboard triage into the later `incremental-consumption` change. Splitting it out ships the biggest ergonomics win on its own, without waiting for the IFrame Player API work. It is schema-free and API-free; it only adds client-side keyboard handling to the existing `/inbox` page.

## What Changes

- **MODIFIED** `inbox-view`: add keyboard bindings to the inbox page. Navigation (`j` / `k`, `g g`, `G`), actions (`s` = save, `d` = dismiss, `o` = open in new tab, `u` = undo last dismiss), help (`?` toggles overlay). Bindings only fire when focus is not inside an input/textarea/contenteditable.
- **MODIFIED** `inbox-view`: the inbox list gains a "focused row" visual indicator (ring + auto-scroll into view). Initial focus is the first card. If the list empties, focus clears.
- **MODIFIED** `inbox-view`: local undo stack for dismissed items only. `u` pops the most recent dismiss and transitions it back to `inbox`. Stack is in-memory; a page reload clears it.

## Capabilities

### Modified Capabilities
- `inbox-view`: add keyboard-driven triage on top of the existing click-to-act flow. No behaviors are removed — the buttons still work.

## Impact

- **Code:** `src/app/inbox/page.tsx` stays an RSC that fetches the list, but list rendering moves into a new client island (`src/components/InboxList.tsx`) that owns the focused-row state and keydown handler. A small `src/components/InboxHelpOverlay.tsx` renders the `?` modal. Keymap lives in one constant.
- **Database:** none.
- **API:** none — uses existing `POST /api/consumption`.
- **Operational:** no `justfile` / `RUNBOOK.md` changes (no new service/port/env).
- **Out of scope (deferred):** bulk select (multi-row), keyboard on library/archive/watch pages, user-configurable bindings, save-action undo (only dismiss is undoable in this change — reversing a save requires two transitions and is noise for v1).
