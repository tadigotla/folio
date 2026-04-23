## Why

Phase 1 of the [consumption-first](../consumption-first/) umbrella. The umbrella pivots Folio from publication-shaped (issues, slots, publish) to consumption-shaped (a room to walk into, playlists as the primary organizing concept, taste weights actually wired into ranking). This phase introduces the missing primitive — **playlists** — and does nothing else. It is the cheapest, safest starting move: pure addition, no teardown, usable immediately alongside the existing magazine surface.

Playlists replace two things simultaneously: (a) the role *sections* used to play as a structural backbone (phase 4 will collapse sections into tags + playlists), and (b) the organizing intent the magazine *issues* provided. They are the one object a single reader actually wants: a named, ordered, reusable collection of videos with low ceremony.

Shipping playlists standalone — before the home flip (phase 3) or any teardown (phase 4) — lets the user start curating real collections today. By the time phase 3 reshapes `/`, playlists are populated and the new home has something to display.

## What Changes

- **NEW migration `014_playlists.sql`** — adds two tables:
  - `playlists` (id, name, description, show_on_home, created_at, updated_at)
  - `playlist_items` (playlist_id, video_id, position, added_at) with composite PK `(playlist_id, video_id)`
  Purely additive. No changes to `videos`, `channels`, `consumption`, or any other existing table.
- **NEW `src/lib/playlists.ts`** — the only legal mutation path for playlists. Exports typed mutation verbs (`createPlaylist`, `renamePlaylist`, `updatePlaylistMeta`, `deletePlaylist`, `addToPlaylist`, `removeFromPlaylist`, `reorderPlaylist`) and read helpers (`listPlaylists`, `getPlaylist`, `getPlaylistsForVideo`). All mutations run inside `db.transaction(...)`. Throws typed errors (`PlaylistNotFoundError`, `VideoNotFoundError`, `DuplicateVideoInPlaylistError`) that API routes map to HTTP codes.
- **NEW API routes** under `src/app/api/playlists/`:
  - `GET /api/playlists` — list with item counts and thumbnail preview
  - `POST /api/playlists` — create
  - `GET /api/playlists/[id]` — detail with ordered items
  - `PATCH /api/playlists/[id]` — rename / edit description / toggle `show_on_home`
  - `DELETE /api/playlists/[id]`
  - `POST /api/playlists/[id]/items` — add a video (append by default; optional explicit position)
  - `PATCH /api/playlists/[id]/items/[videoId]` — reorder (change position)
  - `DELETE /api/playlists/[id]/items/[videoId]` — remove
- **NEW pages** `src/app/playlists/page.tsx` (list) and `src/app/playlists/[id]/page.tsx` (detail). RSC pages reading `src/lib/playlists.ts`; thin client islands for mutation.
- **NEW `<AddToPlaylistButton>` component** (`src/components/playlist/AddToPlaylistButton.tsx`) — a small popover that lists existing playlists + a "Create new" affordance. Reused by every `VideoCard`-shaped surface (inbox, library, watch, future Proposed rail).
- **MODIFIED `src/components/VideoCard.tsx`** and `src/components/LibraryCard.tsx` — render the `AddToPlaylistButton` as one of the actions. Strictly additive to existing buttons.
- **MODIFIED `src/components/issue/TopNav.tsx`** — add a "Playlists" link. This file is slated for deletion in phase 4, but in phase 1 we keep nav simple by reusing it. Phase 3's new nav will replace the whole component.
- **NEW spec `openspec/specs/playlists/`** (delivered via this change) — capability definition with scenarios.
- **MODIFIED docs** — `CLAUDE.md` gains a "Playlists" subsection under Web UI; `RUNBOOK.md` gains a short "Playlists" section.

## Capabilities

### New capabilities

- **playlists** — named, ordered, many-to-many collections of videos. Mutation goes exclusively through `src/lib/playlists.ts`. All actions are user-initiated.

### Modified capabilities

- None in phase 1. The `show_on_home` flag is persisted but not read — phase 3 wires it into the home view.

## Impact

- **Code added:** ~500 LOC estimate. One migration, one library module, eight API routes, two pages, one new component, minimal edits to two existing components and one nav component.
- **Code removed:** none. Phase 1 is pure addition.
- **Database:** two new tables. Storage footprint: trivial (~100 bytes per playlist + ~40 bytes per item). Even at 100 playlists × 100 items each = 10,000 rows ≈ 400 KB. Negligible.
- **External services:** none added.
- **Operational:** no new processes, no new env vars, no new cron jobs. The only operational note is that `just backup-db` before applying the migration is good hygiene (additive migration; rollback = drop the two tables).
- **Cost:** none. No LLM usage, no API calls.
- **Privacy posture:** unchanged.
- **Reversibility:** fully reversible. Drop the two tables, delete the new files, revert the VideoCard/LibraryCard/TopNav edits, remove the spec.
- **Coexistence with magazine surface:** playlists live alongside issues/slots/sections. Zero interference. A video can be in an inbox, be assigned to multiple playlists, be dragged into an issue slot, and have a section — all simultaneously. Phase 3 and phase 4 resolve the taxonomy overlap; phase 1 tolerates it.

## Success metric

Phase 1 is shipped when:

1. The user can create a playlist, add videos to it (from inbox, library, or watch view), reorder its contents, and delete it — end to end, without the existing magazine surface breaking.
2. `/playlists` and `/playlists/[id]` render correctly with real data.
3. A video can belong to multiple playlists, and the VideoCard indicator reflects that.
4. Deleting a video (via its channel's deletion cascade) or a playlist removes the relevant rows cleanly.
5. No magazine functionality (inbox triage, issue composition, publish, section assignment) is regressed.

The qualitative bar: the user has enough playlists and enough items in them that phase 3's home view will feel populated on first render.
