## Why

Phase 1 seeded a personal YouTube corpus (Likes, Subscription uploads, Playlists) and left the user with a raw triage inbox and no way to actually *make* an issue of the magazine. The original product thesis — a hand-edited magazine of videos — now needs its editorial surface. This change delivers it in one step: a slot-based issue shape in the database **and** the drag-and-drop editor workspace that fills those slots. It collapses Phase 2 (retire-algo-issues schema cleanup) and Phase 3 (editor workspace) from the pivot roadmap because Phase 2 is effectively already done — `issues` was dropped in migration `010_library_pivot.sql` — so what's left is a greenfield reintroduction of `issues` with the right shape, paired with the UI that consumes it.

## What Changes

- **NEW**: `issues` table reintroduced with a deliberate **slot-based** shape — `(id, status 'draft'|'published', created_at, published_at, title)`. No rule-derived columns; composition is entirely editor-driven.
- **NEW**: `issue_slots` table — `(issue_id, slot_kind 'cover'|'featured'|'brief', slot_index, video_id)` with composite PK `(issue_id, slot_kind, slot_index)`. Every issue has exactly 14 addressable slots: 1 cover (index 0), 3 featured (indexes 0..2), 10 briefs (indexes 0..9). Empty slots are represented by the absence of a row.
- **NEW**: Editor workspace at `/` for the connected-and-non-empty-corpus case. Desktop-only. Two-column layout: slot board on the left (magazine-shaped), inbox pool on the right (list of candidate videos). HTML5 drag-and-drop moves videos between pool and slots and between slots; dropping on an occupied slot swaps; dropping outside a slot returns to pool.
- **NEW**: Slot-assignment endpoint `POST /api/issues/:id/slots` with a small action vocabulary (`assign`, `swap`, `clear`) used by the client drag handlers. All state changes go through it; the client never mutates slot state optimistically without the server's ack.
- **NEW**: Issue lifecycle endpoints — `POST /api/issues` (create draft; 409 if a draft already exists), `POST /api/issues/:id/publish` (freeze the slot set, set `status='published'`, `published_at=now`), `DELETE /api/issues/:id` (discard draft; only allowed while `status='draft'`).
- **NEW**: Published-issue list at `/issues` (reverse-chron list of all published issues, each with cover thumbnail + title + published date).
- **NEW**: Read-only published-issue view at `/issues/[id]` — renders the frozen 14-slot composition magazine-style (cover + featured + briefs). No editing affordances; the lifecycle is one-way.
- **NEW**: `.dismiss` affordance in the workspace inbox pool (keyboard + hover button) that triggers the existing `POST /api/consumption` with `next='dismissed'`, removing a candidate from the pool without assigning it to a slot.
- **MODIFIED**: Home page at `/` — for the `connected + non-empty corpus` branch, now renders the editor workspace instead of the "your library has N videos" summary. The `not connected` and `connected + empty corpus` branches from Phase 1 are unchanged.
- **MODIFIED**: Assigning an inbox video to any slot SHALL auto-promote its consumption status from `inbox → saved` inside the same transaction that writes the `issue_slots` row. Removing from a slot does NOT demote.
- **MODIFIED**: `TopNav` — `Inbox` link is replaced by `Issues` (→ `/issues`). The `raw inbox` link in the secondary row is removed.
- **BREAKING REMOVAL**: `/inbox` route and the entire `src/app/inbox/` directory. The client-side inbox keymap, `InboxCard`, `InboxList`, and `inboxKeymap.ts` supporting components are removed. Triage happens during composition — anything the editor chooses not to slot stays as a candidate for the next draft; anything actively dismissed leaves the candidate pool.

## Capabilities

### New Capabilities

- `editorial-workspace`: The drag-and-drop editor surface — slot-board layout, pool-to-slot and slot-to-slot transitions, swap semantics, auto-save to `saved` on first assignment, the "one draft at a time" invariant, draft-vs-published lifecycle, and the in-pool dismiss affordance. Owns the endpoints `POST /api/issues`, `POST /api/issues/:id/slots`, `POST /api/issues/:id/publish`, `DELETE /api/issues/:id`.
- `issue-archive`: The read side of published issues — the `/issues` list and `/issues/[id]` detail view, the rendering rules for the 14-slot composition, and the invariant that a published issue's slots are frozen (no mutations after publish).

### Modified Capabilities

- `home-view`: Reintroduced (was archived in yt-library-import). The home page at `/` now has three branches: not-connected → Connect CTA, connected-but-empty → Import CTA, connected-with-corpus → editor workspace (or "no draft — New issue" button when nothing is in progress).
- `youtube-library-import`: One clarifying scenario added to the "Idempotent upsert and user-state preservation" requirement — slot-assignment-driven `inbox → saved` is an application-level transition that does NOT interact with import re-run behavior (consumption state is preserved on re-import either way). No new requirements, no behavioral changes to existing scenarios.

### Removed Capabilities

- None. The inbox UI is removed but it was never a spec-level capability — `video-library` owns the `consumption` lifecycle, which is unchanged, and `home-view` absorbs the change.

## Impact

- **Code added**:
  - `db/migrations/011_issues_slotted.sql` — creates the reintroduced `issues` + new `issue_slots`.
  - `src/lib/issues.ts` — issue + slot CRUD: `createDraftIssue`, `getDraftIssue`, `getPublishedIssues`, `getIssueById`, `assignSlot`, `swapSlots`, `clearSlot`, `publishIssue`, `discardDraft`, `getInboxPool`. Each operation runs inside a transaction; slot mutations also handle the auto-save-to-`saved` transition.
  - `src/app/api/issues/route.ts` (`POST` → create draft), `src/app/api/issues/[id]/route.ts` (`DELETE` → discard draft), `src/app/api/issues/[id]/slots/route.ts` (`POST` → assign/swap/clear), `src/app/api/issues/[id]/publish/route.ts` (`POST`).
  - `src/app/page.tsx` — adds the editor-workspace branch for connected + non-empty corpus. Switches between "no draft" CTA and "board + pool" layout.
  - `src/app/issues/page.tsx` — list.
  - `src/app/issues/[id]/page.tsx` — read-only detail.
  - `src/components/workspace/` — `EditorBoard.tsx`, `EditorPool.tsx`, `SlotCard.tsx`, `PoolCard.tsx`, drag-and-drop glue (client components using the HTML5 `dragstart`/`dragover`/`drop` API; no new npm deps).
- **Code removed**:
  - `src/app/inbox/` (entire directory).
  - `src/components/InboxCard.tsx`, `src/components/InboxList.tsx`, `src/components/inboxKeymap.ts`.
  - The `Inbox` and `raw inbox` links from `src/components/issue/TopNav.tsx`.
- **Database**:
  - New migration `011_issues_slotted.sql` creates the reintroduced `issues` and new `issue_slots`. Purely additive — no destructive step, no `backup-db` gate.
- **API changes**:
  - Added: `POST /api/issues`, `DELETE /api/issues/:id`, `POST /api/issues/:id/slots`, `POST /api/issues/:id/publish`.
  - Unchanged: `POST /api/consumption` (still used by the in-pool dismiss affordance and by the auto-save-to-`saved` transition, via internal call), `POST /api/consumption-progress`, all OAuth + import endpoints.
- **Operational**:
  - `justfile`: no changes. `RUNBOOK.md`: new "Editor workspace" section covering the slot model, the draft/published lifecycle, the one-draft-at-a-time invariant, and what to do if you want to throw away a draft. Update `Last verified:`.
  - `.env.example`: unchanged.
- **Dependencies**: No new npm packages. Drag-and-drop uses the native HTML5 API; a future change can upgrade to `dnd-kit` if the feel is insufficient.
- **Security / threat model**: Unchanged from Phase 1. No new network surfaces. All mutations go through the existing same-origin API routes on `localhost:6060`.
- **Risk**:
  - HTML5 drag-and-drop is well-known for awkward UX on touch and for its brittle event model (`dragover` requiring `preventDefault`, shadow-DOM oddities, etc.). The workspace is desktop-only mouse-only in this phase; mobile gets an "open on desktop" placeholder. We document this trade-off and accept it — upgrading later to `dnd-kit` is scoped but not in this change.
  - The "one draft at a time" invariant simplifies the UI but means a hung/forgotten draft blocks creating a new issue. Explicit Discard action on the workspace handles this.
- **Out of scope, deferred**:
  - AI slot-fill suggestions (Phase 4).
  - Multiple concurrent drafts, named drafts, draft templates.
  - Per-slot annotations / captions / editorial pull-quotes.
  - Transcripts, highlights (Phase 4).
  - Mobile editor workspace.
  - Re-editing a published issue (one-way freeze stands).
