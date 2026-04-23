## Stance

Phase 1 is a **data + surface** phase. It introduces the playlist primitive, the UI to manipulate it, and the API that backs both. It does **not**:

- wire playlists into home-page ranking (phase 2/3),
- wire playlists into the agent's tool set (phase 3),
- touch the magazine schema or UI (phase 4),
- implement any nightly/background process (phase 5).

Scope discipline here buys freedom later. The only long-lived cost of phase 1 is the schema; everything else is additive code that can be rewritten cleanly in subsequent phases.

## Schema

```sql
-- 014_playlists.sql

BEGIN;

CREATE TABLE playlists (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  description  TEXT,
  show_on_home INTEGER NOT NULL DEFAULT 0 CHECK (show_on_home IN (0, 1)),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX idx_playlists_updated ON playlists(updated_at DESC);
CREATE INDEX idx_playlists_show_on_home ON playlists(show_on_home)
  WHERE show_on_home = 1;

CREATE TABLE playlist_items (
  playlist_id  INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  video_id     TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL,
  added_at     TEXT NOT NULL,
  PRIMARY KEY (playlist_id, video_id)
);

CREATE INDEX idx_playlist_items_position ON playlist_items(playlist_id, position);
CREATE INDEX idx_playlist_items_video ON playlist_items(video_id);

COMMIT;
```

### Design choices

- **`playlists.name` is NOT unique.** Two playlists can share a name — the user may legitimately want "Weekly" and "Weekly" for different contexts. The UI surfaces name collisions but does not enforce uniqueness.
- **Composite PK `(playlist_id, video_id)`** enforces "a video can be in a playlist at most once." Duplicate insert → `SQLITE_CONSTRAINT_PRIMARYKEY` → mapped to `DuplicateVideoInPlaylistError` → HTTP 409.
- **`position` is a dense integer, NOT unique.** Uniqueness is enforced at the application layer inside transactions; skipping DB-level `UNIQUE(playlist_id, position)` keeps reorders simple (no deferred-constraint dance). The `idx_playlist_items_position` index makes ordered reads and rebalance scans fast.
- **`show_on_home`** column lands in phase 1 but stays unread until phase 3. It's boolean-shaped (`CHECK IN (0, 1)`); the partial index makes "which playlists should we show?" a fast lookup.
- **`ON DELETE CASCADE`** on both FKs: deleting a playlist removes its items; deleting a video removes it from all playlists. No orphans possible.
- **`idx_playlist_items_video`** supports the reverse lookup "which playlists is this video in?" used by `VideoCard` to render a "saved in N playlists" indicator.

### What we explicitly don't add

- No `UNIQUE(playlist_id, position)`. Tempting for invariant clarity, but forces elaborate swap logic on reorder. Application-layer invariant is sufficient for a one-user tool.
- No `playlist_tags` or category field. Playlists ARE the category; tagging them is out of scope and likely never needed.
- No soft-delete / archived flag. Delete means delete. If the user needs "archived playlist," they add an emoji to the name or copy items to a new playlist before deleting.
- No cover image / thumbnail column. The list view derives a thumbnail mosaic from the first four items at render time. Zero denormalization.

## Mutation semantics (`src/lib/playlists.ts`)

Every mutation wraps in `db.transaction(...)`. Every mutation updates `playlists.updated_at` on the affected row (so the list view's "recently used" sort works).

```ts
// Typed errors
class PlaylistNotFoundError extends Error {}         // → HTTP 404
class VideoNotFoundError extends Error {}            // → HTTP 404
class DuplicateVideoInPlaylistError extends Error {} // → HTTP 409
class InvalidPositionError extends Error {}          // → HTTP 422

// Mutations
createPlaylist({ name, description?, show_on_home? }): Playlist
renamePlaylist(id, { name?, description?, show_on_home? }): Playlist
deletePlaylist(id): void

addToPlaylist(playlistId, videoId, { position? }): { position: number }
// - appends at position = max(existing) + 1 when position omitted
// - when position is provided, inserts at that position and shifts:
//   UPDATE playlist_items SET position = position + 1
//   WHERE playlist_id = ? AND position >= ?

removeFromPlaylist(playlistId, videoId): void
// - removes the row; leaves gaps (positions 1,2,4,5 is fine).
//   The ordered read path uses ORDER BY position ASC and is gap-tolerant.

reorderPlaylist(playlistId, videoId, newPosition): void
// - moves one item to newPosition and renumbers the affected range
//   densely. Dense renumber within the affected range only, not across
//   the whole playlist. Acceptable perf at playlist sizes < 10k items.

// Reads
listPlaylists(): Array<{
  id, name, description, show_on_home,
  item_count, latest_thumbnail_urls: string[4], updated_at
}>
// - sorted by updated_at DESC
// - latest_thumbnail_urls pulls up to 4 most-recently-added items' thumbnails

getPlaylist(id): { playlist, items: Array<{ video_id, position, video_row, consumption_status }> }
// - items sorted by position ASC

getPlaylistsForVideo(videoId): Array<{ id, name, item_count }>
// - sorted by name ASC
```

### Rebalance strategy for `reorderPlaylist`

Given `(playlist_id, video_id, new_position)`:

1. `SELECT current_position FROM playlist_items WHERE playlist_id = ? AND video_id = ?` — throws `PlaylistNotFoundError` or just empty result = no-op.
2. Normalize `new_position`: clamp to `[1, COUNT(*) WHERE playlist_id = ?]`.
3. If `new_position == current_position`: no-op.
4. If `new_position < current_position` (moving up): shift items in `[new_position, current_position - 1]` down by 1:
   ```sql
   UPDATE playlist_items SET position = position + 1
   WHERE playlist_id = ? AND position >= ? AND position < ?
   ```
   Then set the moved item to `new_position`.
5. If `new_position > current_position` (moving down): shift items in `[current_position + 1, new_position]` up by 1 (symmetric).
6. `UPDATE playlists SET updated_at = datetime('now') WHERE id = ?`

All steps inside one transaction.

**Edge case:** if positions are non-contiguous (e.g. the table is in state `[1, 2, 4, 7]` because of prior removals), the rebalance uses `position` as an ordering key, not as an absolute slot. The update condition `WHERE position >= old AND position < new` still works correctly because positions are strictly ordered. We do NOT eagerly renormalize on removals — it's wasted writes. Occasional gaps are fine; an opportunistic compaction function can be added later if positions ever drift far enough to matter (they won't, for a personal tool).

## API routes

All routes return JSON. Errors use the standard `{ error: string, code: string }` shape already present in the codebase.

| Method | Path | Body | Response | Errors |
|---|---|---|---|---|
| GET | `/api/playlists` | — | `{ playlists: [...] }` (from `listPlaylists()`) | — |
| POST | `/api/playlists` | `{ name, description?, show_on_home? }` | `201 { playlist }` | `422` on empty name |
| GET | `/api/playlists/[id]` | — | `{ playlist, items }` | `404 playlist_not_found` |
| PATCH | `/api/playlists/[id]` | `{ name?, description?, show_on_home? }` | `200 { playlist }` | `404`, `422` |
| DELETE | `/api/playlists/[id]` | — | `204` | `404` |
| POST | `/api/playlists/[id]/items` | `{ video_id, position? }` | `201 { position }` | `404`, `409 duplicate_video`, `422 invalid_position` |
| PATCH | `/api/playlists/[id]/items/[videoId]` | `{ position }` | `200 { position }` | `404`, `422` |
| DELETE | `/api/playlists/[id]/items/[videoId]` | — | `204` | `404` |

Notes:

- Idempotent deletes: removing a video that isn't in the playlist → `204`, not `404`. Only "playlist doesn't exist" → `404`.
- `POST /items` returns the effective position (useful when client posted without `position` and wants to know where it landed).
- The `videoId` in the path is the raw YouTube video ID (same as `videos.id`).

## UI

### `/playlists` (list)

```
┌────────────────────────────────────────────────────────────────┐
│  Playlists                                      [ + New ]     │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │ [thumb mosaic]│  │ [thumb mosaic]│  │ [thumb mosaic]│         │
│  │ Morning coffee│  │ Research: ...│  │ Slow Sunday  │         │
│  │ 12 items      │  │ 34 items      │  │ 5 items      │         │
│  │ updated 2h ago│  │ updated 3d ago│  │ updated 9d ago         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

- RSC page, calls `listPlaylists()`.
- Card click → `/playlists/[id]`.
- "+ New" → client dialog → POST → redirect to the new detail page.
- Cards sorted by `updated_at DESC`.
- Thumbnail mosaic: 1, 2, 3, or 4 thumbnails depending on item count; renders gray if `item_count == 0`.

### `/playlists/[id]` (detail)

```
┌────────────────────────────────────────────────────────────────┐
│  ← All playlists                                               │
│                                                                │
│  Morning coffee                           [ Edit ] [ Delete ] │
│  A short description if set.                                   │
│                                                                │
│  ┌────────────────────────────────────────────────────┐       │
│  │ 1. [thumb] Title of the first video                │       │
│  │            @Channel · 12 min · saved               │       │
│  │                                   [⇅] [Remove]     │       │
│  └────────────────────────────────────────────────────┘       │
│  ┌────────────────────────────────────────────────────┐       │
│  │ 2. [thumb] Another title                           │       │
│  │            @OtherChannel · 28 min · in progress    │       │
│  │                                   [⇅] [Remove]     │       │
│  └────────────────────────────────────────────────────┘       │
│  …                                                             │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

- RSC page for the header + list; client island for reorder + inline rename + delete.
- `[⇅]` drag handle uses native HTML5 drag events (same library the current slot board uses, if it's factored for reuse; otherwise a small custom hook — drag ergonomics are not a phase-1 risk surface).
- Click on item row → `/watch/[video_id]`.
- "Edit" opens inline name/description edit. "Delete" opens a confirm dialog.

### `<AddToPlaylistButton>` component

Reusable action attached to any `VideoCard`-shaped context:

```
┌──────────────────────────────────────┐
│  Add to playlist                     │
│  ──────────────────────────────      │
│  ☐ Morning coffee                    │
│  ☑ Research: compilers               │
│  ☐ Slow Sunday                       │
│  ──────────────────────────────      │
│  + Create new playlist               │
└──────────────────────────────────────┘
```

- Shows which playlists already contain this video (checked = present).
- Checking / unchecking is immediate: calls `POST /items` or `DELETE /items` — no separate "save" step.
- "+ Create new playlist" opens a tiny inline input → creates → auto-adds the video to the fresh playlist.
- Lives in `src/components/playlist/AddToPlaylistButton.tsx`.

### Card integration

Both `src/components/VideoCard.tsx` and `src/components/LibraryCard.tsx` gain the `<AddToPlaylistButton>` alongside existing actions. No layout rewrite — button sits in the existing actions row.

Additionally, each card renders a small indicator when the video is in ≥ 1 playlist:

```
  ♪ in 2 playlists
```

The indicator reads from `getPlaylistsForVideo(videoId)`. To avoid N+1 queries, list pages (inbox, library) batch-load playlists for all visible videos in a single query and pass through props.

## Coexistence with the magazine surface

During phase 1, the existing magazine UI remains fully functional:

- `/` still renders today's issue.
- Drag-board still assigns slots.
- Section chips still assign channels to sections.
- Issue publish still works.

A video can simultaneously be in an inbox, be assigned to a slot on a draft issue, have a section on its channel, and be in three playlists. These are independent axes. Phase 3 starts retiring this overlap; phase 4 completes it.

The only risk in this coexistence is UI density — adding a new "Add to playlist" action to already-crowded cards. Mitigation: the button is compact (icon + count) and uses a popover, not a permanent dropdown.

## Observability + manual recovery

- All mutations log via the existing db wrapper. No new logging infrastructure.
- Manual recovery for a mis-inserted playlist: `sqlite3 events.db "DELETE FROM playlists WHERE id=?"` — cascade handles items.
- Manual recovery for position corruption: `sqlite3 events.db "SELECT * FROM playlist_items WHERE playlist_id=? ORDER BY position"` then a manual renumber. Expected to be rare enough not to warrant a UI affordance.

## What phase 2 and later depend on from phase 1

- Phase 2 (`taste-ranking-loop`): no dependency. Phase 2 ranks videos, not playlists.
- Phase 3 (`consumption-home`): reads `playlists WHERE show_on_home = 1` to render a "Playlists" strip on `/`. Also re-points the agent's curation tools at `src/lib/playlists.ts`.
- Phase 4 (`magazine-teardown`): no dependency. Teardown can run whether or not phase 1 shipped.
- Phase 5 (`overnight-enrichment`): no dependency.
- Phase 6 (`discovery`): no dependency. Approved candidates could optionally land in a "Discovered" playlist, but that's a nice-to-have, deferred.

The promise phase 1 makes to phase 3: the schema and read helpers are stable, and `src/lib/playlists.ts` is the only mutation path — phase 3 just wires the agent to call the same module.

## Risks

| Risk | Mitigation |
|---|---|
| Position rebalance corrupts order under concurrent writes | Single-user app; SQLite's busy-timeout + transactions are sufficient. No retry logic needed |
| Deleting a video mid-use leaves a broken playlist row | `ON DELETE CASCADE` on `playlist_items.video_id` — deletion propagates |
| Drag-to-reorder has janky UX on first implementation | Acceptable to ship with click-to-reorder arrows first; drag handle can be added as a follow-up. Explicit call-out in tasks |
| Playlist proliferation (user creates dozens, list becomes unwieldy) | Sort by `updated_at DESC` surfaces recently-used. If it becomes an issue, add an `archived` flag later |
| `show_on_home` persisted but not read in phase 1 leads to confusion | UI has no checkbox for `show_on_home` in phase 1 — field defaults to 0 and is invisible to the user. Phase 3 introduces the affordance |

## Open questions

- **Drag vs. arrows for reorder?** Lean: ship arrows (↑↓ per row) in phase 1; drag-to-reorder lands as a small follow-up. Lower risk, zero library churn.
- **Empty-state copy?** `/playlists` with zero playlists: "No playlists yet. Make one — group videos by mood, project, or session." Lock copy in implementation.
- **Import from YouTube playlists?** The existing `src/app/api/youtube/import/playlists/` route imports videos from a YT playlist into the corpus. In phase 1 the imported videos land in `consumption=saved`; they do NOT auto-create a Folio playlist of the same name. Adding that auto-creation is a tempting follow-up but out of scope for phase 1 — ships as a separate tiny change if wanted.
