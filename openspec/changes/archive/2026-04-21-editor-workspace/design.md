## Context

Phase 1 ([archived 2026-04-21-yt-library-import](openspec/changes/archive/2026-04-21-yt-library-import/)) replaced the corpus source with the user's YouTube library and dropped the algorithmic "Today's Issue" machinery, including the old `issues` table, `src/lib/issue.ts`, and `src/app/api/issues/`. The app is now shaped as a corpus + triage inbox + library, with nothing to actually *do* in the editorial sense. This change brings back `issues` with a purpose-built shape and the workspace UI that composes them.

Current state relevant to this design:

- `videos`, `channels`, `consumption` are populated by the YouTube importer. The `consumption` lifecycle (`inbox | saved | in_progress | archived | dismissed`) is the load-bearing user-state record and continues to be authoritative here — slot assignment does not replace it, it *piggybacks* on it.
- `video_provenance` records import provenance with a `signal_weight` (1.0 for likes, 0.7 for playlists, 0.3 for subscription uploads). Phase 4 will use this for AI suggestions; this change does not read it.
- The old `issues` table is gone; there is no foreign key pressure from elsewhere in the schema, so the reintroduced shape is free to be deliberately slot-native rather than column-smooshed like the old composition rows.
- `/inbox` exists today and renders `consumption.status = 'inbox'` as a card list for keyboard-driven triage. This change deletes it.
- TopNav lists: `Library`, `Archive`, `Sections`, `YouTube`, `raw inbox`. We rewrite it to: `Library`, `Archive`, `Sections`, `Issues`, `YouTube`. No "raw inbox."

The app is single-user, local-only, desktop Next.js 16 + React 19 on port 6060. No auth. No multi-tenant. The constraints we're designing against are mostly UX (make dragging feel decent) and invariants (slots can't double-book a video inside one issue, published issues are frozen).

## Goals / Non-Goals

**Goals:**

- The editor can open a draft issue, drag videos from the inbox pool into any of 14 slots (1 cover, 3 featured, 10 briefs), rearrange by dragging between slots, and publish when satisfied.
- Slot state is server-authoritative. Every drop round-trips to the server and the client re-renders from the ack. No optimistic slot mutations — simpler code, slower but easily fast enough for single-user local.
- At any given time there is at most one draft issue. "New issue" is available iff no draft exists.
- Published issues are immutable. The lifecycle is `draft → published`, never back.
- Assigning an inbox video to a slot auto-promotes its consumption status to `saved` in the same DB transaction. This is the single way consumption state and editorial state couple; it happens only on the first assignment per video (`inbox → saved` is idempotent in that direction).
- `/issues` and `/issues/[id]` render a dignified magazine-style read of the frozen slot set — good enough to feel like the output is worth making.
- `/inbox` is deleted wholesale. Triage now lives inside the editor workspace.

**Non-Goals:**

- AI-assisted slot filling. Phase 4.
- Mobile drag-and-drop. Mobile sees an "open on desktop" message on `/`; `/library` and `/watch/[id]` remain fully mobile. `/issues` and `/issues/[id]` remain readable on mobile (no interactions on those pages anyway).
- Multiple concurrent drafts, draft naming, draft templates.
- Re-editing a published issue. One-way freeze.
- Per-slot editorial copy (captions, pull-quotes). Just video_id in the slot; the video's title is the display copy.
- New drag-and-drop libraries. Native HTML5 API only. We accept the ergonomics trade-off and revisit only if the feel is unacceptable in practice.
- Transcript/highlight surfaces. Phase 4.

## Decisions

### 1. Slot shape: fixed, addressable, one-table

Every issue has exactly 14 addressable slots. We represent them as `(issue_id, slot_kind, slot_index)` rows in `issue_slots`:

```sql
CREATE TABLE issue_slots (
  issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  slot_kind TEXT NOT NULL CHECK (slot_kind IN ('cover', 'featured', 'brief')),
  slot_index INTEGER NOT NULL,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (issue_id, slot_kind, slot_index)
);
CREATE UNIQUE INDEX idx_issue_slots_video ON issue_slots(issue_id, video_id);
CREATE INDEX idx_issue_slots_issue ON issue_slots(issue_id);
```

An empty slot is simply the absence of a row. The `(issue_id, video_id)` unique index prevents the same video from being double-booked inside one issue — trying to assign video A to two slots of the same issue is a constraint violation the server catches and rejects with HTTP 409.

The kind/index valid ranges are an application-level check (cover: index 0 only; featured: 0..2; brief: 0..9). CHECK-ing those in SQL is possible but noisy; we do it in `issues.ts` and return 400 on violation.

**Alternative considered:** a wide `issues` table with 14 nullable video_id columns (`cover_video_id`, `featured_0_video_id`, …, `brief_9_video_id`). Rejected because every drop would be an UPDATE of one of 14 columns, making "swap two slots" a multi-statement write without leverage from a unique key to prevent double-booking. The normalized table is better shaped for the drag mutation vocabulary.

**Alternative considered:** a single JSON `slots` column on `issues`. Rejected because SQLite has no leverage to enforce the video-uniqueness invariant inside JSON; we'd have to materialize it in the application. Also the JOIN from slot → video via a normal row is trivial and much cheaper to query than JSON extraction.

### 2. Draft + published lifecycle, one draft at a time

```sql
CREATE TABLE issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published')),
  title TEXT,
  created_at TEXT NOT NULL,
  published_at TEXT
);
CREATE UNIQUE INDEX idx_issues_one_draft ON issues(status) WHERE status = 'draft';
```

The partial unique index enforces the "at most one draft" invariant at the DB level. The `createDraftIssue` code path doesn't need to check-then-insert; it just inserts and lets SQLite raise `SQLITE_CONSTRAINT_UNIQUE` if a draft already exists, which the route maps to HTTP 409.

`published_at` is NULL while `status = 'draft'` and set on publish. `publishIssue(id)` runs inside a transaction that (a) asserts `status = 'draft'`, (b) updates `status`, (c) sets `published_at = NOW()`. No other column changes.

`discardDraft(id)` deletes the row; `ON DELETE CASCADE` on `issue_slots` cleans up automatically. Published issues cannot be deleted through the API — enforced by a check in the route that rejects with 409 when `status = 'published'`.

**Alternative considered:** soft-delete drafts (mark as `discarded`). Rejected as overengineering for a single-user local tool with no audit requirements. Hard delete keeps the table small and the one-draft invariant clean.

**Alternative considered:** allow multiple named drafts. Rejected for UX reasons — the user stated they want a deliberate, sacred cadence. One draft at a time matches that. If we want multiple later, dropping the partial unique index is the migration.

### 3. Slot mutation vocabulary: `assign`, `swap`, `clear`

The client's drag handlers emit one of three actions to `POST /api/issues/:id/slots`:

- `assign(videoId, targetKind, targetIndex)` — drop a pool video onto an empty slot. Fails with 409 if the slot is occupied or the video is already on the issue. Runs the auto-save-to-`saved` consumption transition inside the same transaction.
- `swap({ fromKind, fromIndex } | { fromPool: videoId }, toKind, toIndex)` — drop onto an occupied slot. Two sub-cases:
  - **Slot-to-slot swap:** both endpoints are slots. Two rows, both update.
  - **Pool-to-slot swap:** pool video replaces the occupant, occupant returns to the pool. One delete + one insert + auto-save-to-`saved` on the pool video.
- `clear(kind, index)` — drag a slot video out of the board, or click the ×. Deletes the `issue_slots` row. Video's consumption status is NOT demoted (per decision 4); the video stays in `saved` and reappears in the pool because it's no longer assigned.

All three are atomic: one transaction per request. The client never sees partial state.

The server returns the full slot set after each mutation so the client can render from ack. That's `{ slots: [{ kind, index, video: {...} }], pool: [...pool videos...] }`. The response includes the updated inbox pool too, so a single round-trip is enough to re-render both panes.

**Alternative considered:** a GraphQL-ish batch mutation endpoint. Rejected as overkill. Three verbs with a clear URL is simpler and maps well to Next.js route handlers.

### 4. Consumption-status coupling: assign → `saved`; clear → no-op

Assigning a video to any slot auto-promotes its consumption status from `inbox → saved`. The rationale:

- It matches user intent: the editor has *chosen* this video for an issue, so it's implicitly endorsed.
- It keeps the inbox pool logic clean: the pool shows `consumption.status IN ('inbox', 'saved')` minus videos currently on the current draft's slots. Without auto-save, slot removal would re-populate the pool with an `inbox` video even though the user had effectively graduated it.

Conversely, clearing a slot does NOT demote `saved → inbox`. The rationale:

- The video stays in the pool (now unassigned on the current draft), so it's still visible for re-assignment.
- Demoting would feel punitive and create noise — the editor likely removed the video to rearrange, not to repudiate.
- The `saved → inbox` direction is also not a legal transition in the current consumption state machine; we'd have to add it, which is more surface for less value.

The auto-save happens inside `assignSlot`'s transaction by calling `setConsumptionStatus(videoId, 'saved')` iff the current status is `'inbox'`. Other statuses (`saved`, `in_progress`, `archived`, `dismissed`) are left alone. In particular, a video in `archived` can still be assigned to a slot (rare but legal) without its consumption status changing — the archival record and the editorial record are independent facts.

**Alternative considered:** add a new consumption state `slotted` that's distinct from `saved`. Rejected as redundant. The slot-set on each issue is itself the authoritative record of "what's in an issue"; the consumption state answers a different question ("has the user engaged with this video personally"). Keeping them independent is cleaner.

### 5. Inbox pool: which videos appear

The pool on the right side of the workspace shows:

```sql
SELECT v.*, ch.name AS channel_name, p.signal_weight
  FROM videos v
  JOIN consumption c ON c.video_id = v.id
  JOIN channels ch   ON ch.id      = v.channel_id
  LEFT JOIN (
    SELECT video_id, MAX(signal_weight) AS signal_weight
      FROM video_provenance
      GROUP BY video_id
  ) p ON p.video_id = v.id
 WHERE c.status IN ('inbox', 'saved')
   AND NOT EXISTS (
     SELECT 1 FROM issue_slots s
      WHERE s.issue_id = ? AND s.video_id = v.id
   )
 ORDER BY c.status_changed_at DESC;
```

Rationale:

- `inbox` and `saved` are both reasonable candidates for a new issue. `in_progress` implies the user is currently watching; surfacing it in the pool invites weird mid-playback reassignment. `archived` is "done"; `dismissed` is "rejected." Both excluded.
- Filtering out videos currently assigned to the draft keeps the pool clean — you don't see what you've already used.
- `signal_weight` is joined in so the pool UI can tint cards differently by weight (likes show brightest, subscription uploads dimmest). Phase 4 will use this for ranking/suggestions; Phase 3 just surfaces it as a visual cue.
- No explicit `section` filter. Section grouping is a separate concern; the pool is flat and sorted by recency.

**Alternative considered:** pool = all inbox only, `saved` shown in a separate tab. Rejected — treating saved as graduated-from-pool would punish the auto-save step. The whole "save this for later" gesture should still make the video available for slotting.

### 6. Pool search and filtering — in scope, minimal

The pool needs search because 100s of inbox + saved candidates is real. A simple client-side text filter box over title + channel name is enough for Phase 3; indexed search is deferred to a future change. If the pool exceeds ~500 items in practice and scrolling feels bad, we'll add paging, but we don't build for that now.

No section/tag filters in the pool in Phase 3. Section-level composition (e.g., "fill featured slots with one video per top-3 sections") is explicitly out of scope — this phase is manual only. Phase 4's suggestions can do that.

### 7. Drag-and-drop implementation: native HTML5

No `dnd-kit`, no `react-beautiful-dnd`. We use the native `draggable`, `onDragStart`, `onDragOver`, `onDrop` props directly on client components. A minimal helper (`src/components/workspace/useDragSlot.ts`) centralizes the `dataTransfer` protocol so pool cards and slot cards share a serialization:

```
dataTransfer.setData('application/x-folio-drop', JSON.stringify({
  from: 'pool' | 'slot',
  video_id: '...',
  slot_kind?: 'cover' | 'featured' | 'brief',
  slot_index?: number,
}));
```

The drop target reads this, decides which action (`assign` / `swap` / `clear`), and POSTs. The drop target must call `event.preventDefault()` in `onDragOver` for the drop to fire at all — the #1 native-DnD footgun. We wrap this in a `<DropZone>` component to make it hard to forget.

Known limitations we accept:

- No touch support. Mobile workspace is out-of-scope anyway.
- The drag-preview image is the default browser translucent clone. No custom ghost image in Phase 3.
- Cross-browser differences are mild for our targets (Chrome + Safari on macOS); we don't attempt Firefox parity if it comes up.

**Alternative considered:** `dnd-kit/core` (+ `~40 KB gzipped`). Rejected for dependency-weight reasons given it's a single-user local tool and the native API is genuinely enough for the 14-slot use case. A follow-up change can swap it in if the feel is poor; the abstraction layer (`useDragSlot` + `<DropZone>`) makes that a localized change.

### 8. Server-authoritative rendering, no optimistic updates

The workspace fetches state on mount (SSR via the RSC page, hydration into a client tree) and re-fetches after every mutation. We do NOT optimistically move cards in the client before the ack.

Reasoning: single-user localhost. Round-trip to the server is ~2ms. The complexity cost of a reconciling optimistic layer vastly outweighs the UX gain at that latency. Users feel the cursor leaving the card → the card arriving at its destination is one frame.

Implementation:

- `/` server-renders the workspace (RSC that loads the current draft + slots + pool).
- The client component holds `{ slots, pool }` in state, initialized from RSC props.
- Each mutation is `fetch('/api/issues/:id/slots', { method: 'POST', body: ... })`; on `ok`, replace local state with the response body. On non-ok, show a toast and don't move.

**Alternative considered:** optimistic updates with rollback on error. Rejected per above. If we ever host this remotely, revisit.

### 9. Published-issue rendering

`/issues/[id]` for a published issue renders the frozen slot set magazine-style:

- Cover: the video's thumbnail (via `DuotoneThumbnail`) large, title over/under, channel + duration underneath.
- Featured (3): three equal columns, thumbnail + title + channel.
- Briefs (10): vertical list, title + channel + duration.

No next/prev navigation between issues on this page (that's the `/issues` list's job). Clicking any tile routes to `/watch/[id]`.

`/issues` is a simple flex-wrap of published issues, reverse-chron, showing each one's cover thumbnail + title + published_at date + slot-fill count (e.g., "12 of 14 slots filled" — yes, you can publish a partial issue; we don't gate on a full set because the user wants the freedom to ship a short issue).

**Alternative considered:** gate publish on "all 14 slots filled." Rejected — the user's aesthetic is deliberate, occasional, small. Forcing 14-slot completion is a friction we shouldn't impose.

### 10. `/inbox` deletion, zero-downtime

Delete the route handler directory `src/app/inbox/`, the client components `InboxCard`, `InboxList`, `inboxKeymap`, and remove the two TopNav links. No data migration — the `inbox` status stays in the consumption state machine; only the page is removed. Users hitting `/inbox` get a 404, which is acceptable for a single-user local install. We do NOT add a 301 to `/` — one-off tool, user will update their bookmarks.

RUNBOOK gets a note mentioning the URL change.

### 11. Keyboard support

Deferred to a small set that matters:

- In the pool: `/` focuses the search box. Arrow keys and Enter for navigation are out of scope this phase.
- On a slot (when focused): `Delete` / `Backspace` clears it (same as `clear`).
- Global: `n` opens a new draft iff no draft exists; otherwise no-op.

No pin-as-cover, no keyboard slot assignment in Phase 3. The drag metaphor is canonical; keyboard is an escape hatch only.

### 12. Schema migration `011_issues_slotted.sql`

```sql
CREATE TABLE issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published')),
  title TEXT,
  created_at TEXT NOT NULL,
  published_at TEXT
);

CREATE UNIQUE INDEX idx_issues_one_draft ON issues(status) WHERE status = 'draft';
CREATE INDEX idx_issues_published ON issues(published_at DESC) WHERE status = 'published';

CREATE TABLE issue_slots (
  issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  slot_kind TEXT NOT NULL CHECK (slot_kind IN ('cover', 'featured', 'brief')),
  slot_index INTEGER NOT NULL,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (issue_id, slot_kind, slot_index)
);

CREATE UNIQUE INDEX idx_issue_slots_video ON issue_slots(issue_id, video_id);
CREATE INDEX idx_issue_slots_issue ON issue_slots(issue_id);
```

Purely additive. No data to migrate. The migration runner applies it on next `just dev`; no backup gate required (recommend but don't enforce).

### 13. RUNBOOK update

New section "Editor workspace" covering:

- Draft / published lifecycle, one-draft-at-a-time invariant.
- Slot layout (1 cover + 3 featured + 10 briefs).
- Auto-save-to-`saved` on first assignment.
- Where published issues live (`/issues`).
- How to abandon a draft (Discard button in the workspace header).

Update `Last verified:` date. No changes to the YouTube or Import sections.

## Risks / Trade-offs

- **[Risk]** Native HTML5 drag-and-drop feel on Chrome/Safari can be clunky (weird ghost previews, awkward drag-start thresholds). → **Mitigation:** keep the workspace desktop-only, encapsulate DnD logic behind a small helper so swapping to `dnd-kit` later is scoped. If user feedback is that the feel is bad, that's a 1-day follow-up change, not a blocker for shipping Phase 3.
- **[Risk]** "Server-authoritative, no optimistic updates" might feel sluggish if SQLite writes turn out to be slower than expected (e.g., WAL checkpoint during a drag). → **Mitigation:** localhost + WAL mode is fast enough (<5ms per transaction in practice). If we observe jank, add a local optimistic layer; the server response already carries full state, so reconciliation is trivial.
- **[Risk]** Auto-save-to-`saved` on assign surprises users who assumed "dragging into a slot is exploratory." → **Mitigation:** document in RUNBOOK; the promotion is to `saved`, not `archived` or something destructive, and the video still shows in the pool (unassigned) if you drag it back out. Low blast radius.
- **[Risk]** Partial unique index on `issues(status) WHERE status = 'draft'` is a SQLite-supported feature, but some tools may not display it correctly. → **Mitigation:** we don't depend on external tooling. The `better-sqlite3` driver supports it natively. Verified locally as part of task 1.x.
- **[Risk]** Deleting `/inbox` without a redirect breaks user bookmarks. → **Accepted:** single-user local tool, user will adapt. Documented in RUNBOOK.
- **[Risk]** Publishing a partial issue (fewer than 14 slots filled) leaves visible empty slots in the `/issues/[id]` read-only view. → **Design choice:** empty slots render as muted placeholders. The editor can see the slot count indicator before publishing. Acceptable.
- **[Risk]** A draft that's been sitting for weeks and a corpus that's been refreshed in the meantime may have slot videos whose `consumption.status` has moved to `archived`. → **Behavior:** assignment doesn't care about later state changes. The slot holds the video_id; the draft can still be published. No validation runs at publish time against the current consumption state.
- **[Trade-off]** HTML5 DnD doesn't support touch. → **Accepted:** desktop-only workspace. Mobile already can browse `/library` and `/watch/[id]` fine. Mobile editors are not a design target.
- **[Trade-off]** No per-slot captions / pull-quotes. → **Accepted:** Phase 3 is about proving the composition loop works. Captions add surface without proving that loop.

## Migration Plan

Ordered steps (mirrored in `tasks.md`):

1. Pull code; run `just dev`. Migration `011_issues_slotted.sql` applies automatically. No backup required (purely additive), but run `just backup-db` if you're feeling cautious.
2. Verify `/` loads:
   - Not connected → Connect CTA (Phase 1 branch, unchanged).
   - Connected + empty corpus → Import CTA (Phase 1 branch, unchanged).
   - Connected + non-empty corpus → new editor workspace with "No draft — New issue" button.
3. Click **New issue** → workspace loads with empty 14-slot board + inbox pool.
4. Drag a few videos from the pool into slots. Verify consumption status auto-promoted to `saved`.
5. Drag between slots. Verify swap behavior.
6. Drag a slot video out of the board. Verify it returns to the pool.
7. Click **Publish**. Verify the draft is frozen and appears at `/issues`. Clicking it opens the read-only view.
8. Verify `/issues/[id]` looks right.
9. Verify `/inbox` returns 404.
10. Re-click **New issue** — confirm it's enabled again (the prior draft was published, so no draft exists).

**Rollback:** `git revert` the migration commit + the app-code commit. The migration is additive, so reverting it drops the `issues` and `issue_slots` tables cleanly; no data loss for anything outside those two tables.

## Open Questions

- **Should `/issues` and `/issues/[id]` be public-by-URL or gated?** Proposed: public-by-URL. The app is single-user on localhost; there's no notion of "public" that matters. If we ever deploy this remotely, that's when the question becomes real — not now.
- **Should we surface "N of 14 slots filled" as a visible progress indicator while editing?** Proposed: yes, in the workspace header. Low-cost affordance, answers the user's "am I almost done?" question without forcing completion.
- **Pool search: client-side substring over title + channel — is that enough?** Proposed: yes for Phase 3 (<500 items). If the corpus grows past that, add full-text search (SQLite FTS5) in a follow-up.
- **`title` on the issue — editor-provided, optional, or auto-derived?** Proposed: editor-provided via a small input in the workspace header; blank is legal; `/issues` list falls back to `Issue #<id>` if title is NULL.
- **Published issue → Watch next/prev navigation.** Today the `/watch/[id]` page's next/prev is based on the current section's inbox. Should a published issue set its own next/prev walk when the user navigates in from `/issues/[id]`? → **Proposed:** no for Phase 3. Keep the watch page's next/prev simple (section-inbox based). A future change can add "issue-scoped reading mode" if desired.
