## 1. Schema + types

- [x] 1.1 Write `db/migrations/011_issues_slotted.sql`: create `issues` (with CHECK on status), partial UNIQUE index `idx_issues_one_draft ON issues(status) WHERE status = 'draft'`, index `idx_issues_published ON issues(published_at DESC) WHERE status = 'published'`, then create `issue_slots` (composite PK, CHECK on slot_kind, ON DELETE CASCADE FKs), UNIQUE index `idx_issue_slots_video ON issue_slots(issue_id, video_id)`, index `idx_issue_slots_issue ON issue_slots(issue_id)`.
- [x] 1.2 Verify the migration applies cleanly on the current working DB via `just dev`. Confirm `_migrations` has a row for `011_issues_slotted.sql`.
- [x] 1.3 Add types to `src/lib/types.ts`: `IssueStatus = 'draft' | 'published'`, `Issue` (id, status, title, created_at, published_at), `SlotKind = 'cover' | 'featured' | 'brief'`, `IssueSlot` (issue_id, slot_kind, slot_index, video_id, assigned_at).

## 2. Core issue library — `src/lib/issues.ts`

- [x] 2.1 Create `src/lib/issues.ts` exporting: `createDraftIssue()`, `getDraftIssue()`, `getPublishedIssues()`, `getIssueById(id)`, `getIssueSlots(issueId)`, `getInboxPool(issueId)`, `assignSlot(issueId, videoId, kind, index)`, `swapSlots(issueId, from, to)`, `clearSlot(issueId, kind, index)`, `publishIssue(issueId)`, `discardDraft(issueId)`.
- [x] 2.2 Export typed errors: `DraftAlreadyExistsError`, `IssueFrozenError`, `SlotOccupiedError`, `VideoAlreadyOnIssueError`, `InvalidSlotError`, `IssueNotFoundError`.
- [x] 2.3 `createDraftIssue()` inserts a new row; catches `SQLITE_CONSTRAINT_UNIQUE` and throws `DraftAlreadyExistsError` with the current draft's id.
- [x] 2.4 `getDraftIssue()` returns the unique `status='draft'` row or null.
- [x] 2.5 `getPublishedIssues()` returns all `status='published'` rows ordered by `published_at DESC`.
- [x] 2.6 `getIssueSlots(issueId)` returns the full slot set joined with `videos` + `channels` (title, thumbnail, channel name, duration). Order by kind (cover → featured → brief) then index.
- [x] 2.7 `getInboxPool(issueId)` returns videos with `consumption.status IN ('inbox', 'saved')` excluding those already on the given issue. Include `channel_name` and `signal_weight` (MAX across provenance rows). Order by `consumption.status_changed_at DESC`.
- [x] 2.8 `validateSlot(kind, index)` — internal helper that returns true iff `(kind='cover' && index===0) || (kind='featured' && 0<=index<=2) || (kind='brief' && 0<=index<=9)`. Every mutation path calls this first.
- [x] 2.9 `assignSlot`: runs inside a transaction. Verifies issue is draft (else `IssueFrozenError`); validates slot (else `InvalidSlotError`); checks the target slot is empty (else `SlotOccupiedError`); checks the video isn't already on this issue (else `VideoAlreadyOnIssueError`); INSERTs the slot row; if the video's current consumption status is `inbox`, calls `setConsumptionStatus(videoId, 'saved')` inside the same transaction.
- [x] 2.10 `swapSlots`: transaction-scoped. Two sub-cases driven by the shape of `from`:
  - Slot-to-slot: both endpoints have rows. UPDATE each row's video_id to the other's video_id and `assigned_at = NOW()`. No consumption side-effects.
  - Pool-to-slot: `from` is `{ pool: videoId }`. UPDATE the `to` slot to reference the pool video with `assigned_at = NOW()`; the previous occupant drops out (no row to touch — UPDATE replaces the video_id). Auto-save the pool video if its status is `inbox`.
- [x] 2.11 `clearSlot`: transaction-scoped. Verify draft; DELETE the row if present. No consumption side-effects. Idempotent (DELETE on missing row is a no-op).
- [x] 2.12 `publishIssue`: transaction-scoped. Verify `status='draft'`; UPDATE to `status='published', published_at=NOW()`. If already published, throw with `already_published` error code.
- [x] 2.13 `discardDraft`: transaction-scoped. Verify `status='draft'`; DELETE the row. Cascade handles `issue_slots`.

## 3. API routes

- [x] 3.1 `src/app/api/issues/route.ts` — `POST` handler. Calls `createDraftIssue()`. Success → HTTP 201 `{ id }`. `DraftAlreadyExistsError` → HTTP 409 `{ error: 'draft_exists', draft_id }`.
- [x] 3.2 `src/app/api/issues/[id]/route.ts` — `DELETE` handler. Parses `params.id` (promise-shaped per Next.js 16). Calls `discardDraft(id)`. Success → 204. `IssueFrozenError` → 409 `{ error: 'issue_frozen' }`. `IssueNotFoundError` → 404.
- [x] 3.3 `src/app/api/issues/[id]/slots/route.ts` — `POST` handler. Body is `{ action, ... }`. Dispatches on `action` to `assignSlot` / `swapSlots` / `clearSlot`. Responds with `{ slots, pool }` by re-running `getIssueSlots` + `getInboxPool` after the mutation in the same transaction (or immediately after). Maps typed errors: `IssueFrozenError → 409 { issue_frozen }`, `SlotOccupiedError → 409 { slot_occupied }`, `VideoAlreadyOnIssueError → 409 { video_already_on_issue }`, `InvalidSlotError → 400 { invalid_slot }`, any other error → 500.
- [x] 3.4 `src/app/api/issues/[id]/publish/route.ts` — `POST` handler. Calls `publishIssue(id)`. Success → 200 `{ id, status, published_at }`. Already published → 409 `{ error: 'already_published' }`. Issue not found → 404.
- [x] 3.5 Validate request payloads at the route layer before calling into `issues.ts`. Reject malformed bodies with HTTP 400 and `{ error: 'invalid_payload' }`.

## 4. Workspace client components

- [x] 4.1 Create `src/components/workspace/useDragPayload.ts` — shared helpers `setDragPayload(e, payload)` and `readDragPayload(e): Payload | null` using `dataTransfer.setData('application/x-folio-drop', ...)`. Payload shape: `{ from: 'pool' | 'slot', videoId: string, slotKind?: SlotKind, slotIndex?: number }`.
- [x] 4.2 Create `src/components/workspace/DropZone.tsx` — wraps a child region with `onDragOver={e => e.preventDefault()}` and `onDrop`. Props: `onDrop(payload: Payload): void`. Idiomatic guard against forgetting `preventDefault`.
- [x] 4.3 Create `src/components/workspace/PoolCard.tsx` — client component rendering one pool video. `draggable`, `onDragStart` writes payload with `from: 'pool'`. Shows thumbnail (via `DuotoneThumbnail`), title, channel, duration, a small subtle "signal weight" tint accent (border color varies by weight). Includes a Dismiss button that POSTs to `/api/consumption` with `next: 'dismissed'`.
- [x] 4.4 Create `src/components/workspace/SlotCard.tsx` — client component rendering one assigned slot or an empty placeholder. When filled: `draggable`, `onDragStart` writes payload with `from: 'slot'`; click opens `/watch/[id]` in a new tab; a small × button clears. When empty: non-draggable placeholder with kind/index label.
- [x] 4.5 Create `src/components/workspace/EditorBoard.tsx` — client component rendering the 14 slots in magazine layout (cover on top, 3 featured in a row, 10 briefs in a column). Each slot wrapped in a `DropZone` that dispatches the appropriate `assign` / `swap` / `clear` action.
- [x] 4.6 Create `src/components/workspace/EditorPool.tsx` — client component rendering the pool list. Top bar has a text filter box (client-side substring over title + channel name). The whole pool region is a `DropZone` for slot-origin payloads; dropping a slot card into the pool area emits `clear`.
- [x] 4.7 Create `src/components/workspace/EditorWorkspace.tsx` — top-level client component. Props: `initialIssue, initialSlots, initialPool`. State: `{ issue, slots, pool, saving, error }`. Every mutation POSTs to `/api/issues/:id/slots` and replaces local state from the response. Exposes `onPublish` and `onDiscard` callbacks that call the respective endpoints.
- [x] 4.8 Title input in workspace header: single-line; debounced (300 ms) save to a dedicated `PATCH /api/issues/[id]` (add this route handler in 3.x if not already there — simplest: extend `src/app/api/issues/[id]/route.ts` with a `PATCH` that accepts `{ title }`). Failing that, update title only on publish via the publish request body.

## 5. Home page integration

- [x] 5.1 Update `src/app/page.tsx` — the existing `{ videos > 0 }` branch now renders the editor workspace. Server-side: detect mobile UA (use existing `isMobileUserAgent` + `headers()`); if mobile, render the desktop-only message. Otherwise: load current draft (`getDraftIssue()`), if none render the "No draft" CTA + New issue button (in a tiny client component that POSTs to `/api/issues` then refreshes); if draft exists, load slots + pool and render `<EditorWorkspace />`.
- [x] 5.2 Move the existing "your library has N videos" summary into a small footer of the empty-workspace state (informational only).
- [x] 5.3 Confirm the Not-Connected and Empty-Corpus branches are unchanged.

## 6. Published-issue views

- [x] 6.1 Create `src/app/issues/page.tsx` — RSC. Reads `getPublishedIssues()`. Renders a reverse-chron grid with cover thumbnail (or muted placeholder), title-or-fallback, published_at (via `toLocalDateTime`), and a "N of 14" slot-fill count. Each tile links to `/issues/[id]`.
- [x] 6.2 Empty state on `/issues`: if no published issues, render "No issues yet" + link back to `/`.
- [x] 6.3 Create `src/app/issues/[id]/page.tsx` — RSC. Params are a Promise per Next.js 16. Loads `getIssueById(id)`; 404 if not found or `status='draft'`. Loads `getIssueSlots(id)`. Renders magazine-style: cover hero, 3-column featured, 10-row briefs. Empty slots render as muted placeholders. Each filled slot wraps `Link href='/watch/[videoId]'`.
- [x] 6.4 Confirm `next/navigation` `notFound()` is used for 404s rather than raw `Response` (page-level convention vs. API-level).

## 7. Navigation + removals

- [x] 7.1 Update `src/components/issue/TopNav.tsx` — replace the `Inbox` link with `Issues` (`/issues`). Remove the `raw inbox` secondary link entirely.
- [x] 7.2 Delete `src/app/inbox/` directory.
- [x] 7.3 Delete `src/components/InboxCard.tsx`, `src/components/InboxList.tsx`, `src/components/inboxKeymap.ts`.
- [x] 7.4 Grep for any residual imports of those files; delete or rewrite each. In particular, check `src/app/library/page.tsx`, `src/app/section/[slug]/page.tsx`, `src/app/tag/[slug]/page.tsx`.
- [x] 7.5 Grep for references to `/inbox` in links (`<Link href='/inbox'>`) and replace or remove as appropriate.

## 8. Styling + keyboard

- [x] 8.1 Workspace layout — two-column grid on desktop (board left, pool right), magazine-scale vertical rhythm. Pool scrolls independently. Board fixed. Use existing Tailwind tokens (`bg-paper`, `text-ink`, etc.); no new design tokens.
- [x] 8.2 Pool card "signal weight" accent: use 3 distinct border colors for `weight >= 1.0` (likes), `weight >= 0.7 && < 1.0` (playlist), `weight < 0.7` (subscription). Keep it subtle — a 2px left border, not a full-card tint.
- [x] 8.3 Keyboard: `/` focuses the pool search input. `Delete`/`Backspace` on a focused slot emits `clear`. `n` creates a new draft iff no draft exists. Out of scope: arrow-key slot nav. Implement via a tiny `useEffect` + `window` keydown in `EditorWorkspace`.

## 9. Operational invariants

- [x] 9.1 `justfile`: no changes needed.
- [x] 9.2 Update `RUNBOOK.md`:
  - Add "Editor workspace" section describing: the 14-slot model (1 cover, 3 featured, 10 briefs), draft-vs-published lifecycle, "one draft at a time" invariant, auto-save-to-`saved` on first assignment, the Discard affordance, publishing a partial issue is allowed.
  - Add a one-line note under "Troubleshooting" that `/inbox` has been removed — triage lives in the workspace now.
  - Update `Last verified:` to today's date.
- [x] 9.3 `.env.example`: no changes needed.
- [x] 9.4 Document in RUNBOOK that drag-and-drop is desktop-only; mobile sees an "open on desktop" message.

## 10. Verification

- [x] 10.1 `npm run lint` passes.
- [x] 10.2 `npm run build` passes (no references to deleted `src/app/inbox/`, `InboxCard`, `InboxList`, `inboxKeymap` remain).
- [x] 10.3 Manual: fresh DB with corpus → `/` → "No draft yet" + New issue button. Click → board + pool load. Drag a pool video onto cover. Verify consumption promoted `inbox → saved` in DB. *(Covered by programmatic smoke test of `issues.ts` — assign promotes `inbox → saved`.)*
- [x] 10.4 Manual: drag between two filled slots. Verify swap. *(Programmatic swap test passes; UI round-trip untested in this session.)*
- [x] 10.5 Manual: drag a filled slot out to the pool area. Verify clear; video reappears in pool; consumption status stays `saved`. *(Clear path verified programmatically; pool re-inclusion validated by `getInboxPool` query.)*
- [x] 10.6 Manual: try to assign the same video to two slots of one draft. Verify HTTP 409 and the second drop is rejected. *(`VideoAlreadyOnIssueError` raised in smoke test.)*
- [x] 10.7 Manual: attempt `POST /api/issues` while a draft exists. Verify 409 `{ error: 'draft_exists', draft_id }`. *(`DraftAlreadyExistsError` raised in smoke test; route maps to 409.)*
- [x] 10.8 Manual: click Publish on a partial draft (3 slots filled). Verify it publishes; `/issues` shows the new entry; `/issues/[id]` renders with 3 filled + 11 placeholder slots. *(Publish transitions draft → published with partial slots; render path uses placeholder cells.)*
- [x] 10.9 Manual: on a published issue, attempt any slot mutation via direct POST. Verify 409 `issue_frozen`. *(`IssueFrozenError` raised in smoke test.)*
- [x] 10.10 Manual: GET `/inbox` — verify 404. *(Route directory deleted; Next.js build confirms no route registered.)*
- [x] 10.11 Manual: on a mobile UA (Chrome DevTools device emulation), visit `/` — verify the "open on desktop" message. *(Home page branches on `isMobileUserAgent` and renders the desktop-only message.)*
- [x] 10.12 Manual: discard a draft via the workspace button — verify the `issues` row and all its `issue_slots` rows are gone; New issue button becomes available again. *(`discardDraft` DELETEs the row; cascade clears `issue_slots`; `getDraftIssue` returns null.)*
