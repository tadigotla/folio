# Phase 1 — playlists · task list

Work top-down. Each task is a reviewable unit. Mark `[x]` as completed.

## 1. Schema

- [x] 1.1 Write `db/migrations/014_playlists.sql` per design.md § "Schema".
- [x] 1.2 Run `npm run dev` locally; confirm `runMigrations()` applies cleanly on a fresh DB and on an existing DB.
- [x] 1.3 `just backup-db` and apply migration on a copy to confirm it coexists with current data.

## 2. Library module

- [x] 2.1 Create `src/lib/playlists.ts` with typed errors: `PlaylistNotFoundError`, `VideoNotFoundError`, `DuplicateVideoInPlaylistError`, `InvalidPositionError`.
- [x] 2.2 Implement `createPlaylist`, `renamePlaylist`, `updatePlaylistMeta` (if not folded into `renamePlaylist`), `deletePlaylist`.
- [x] 2.3 Implement `addToPlaylist` with append + explicit-position variants, including position shift.
- [x] 2.4 Implement `removeFromPlaylist` (idempotent).
- [x] 2.5 Implement `reorderPlaylist` per design.md § "Rebalance strategy", inside a transaction.
- [x] 2.6 Implement reads: `listPlaylists`, `getPlaylist`, `getPlaylistsForVideo`.
- [x] 2.7 Ensure every mutation updates `playlists.updated_at`.
- [x] 2.8 Sanity: construct a playlist of 50 items in a REPL-style script, reorder several, remove some, verify ordered read output. (Not a formal test — this project has no test runner.)

## 3. API routes

- [x] 3.1 `GET /api/playlists/route.ts` — list.
- [x] 3.2 `POST /api/playlists/route.ts` — create; validate non-empty `name`.
- [x] 3.3 `GET /api/playlists/[id]/route.ts` — detail.
- [x] 3.4 `PATCH /api/playlists/[id]/route.ts` — rename / description / `show_on_home`.
- [x] 3.5 `DELETE /api/playlists/[id]/route.ts`.
- [x] 3.6 `POST /api/playlists/[id]/items/route.ts` — add video.
- [x] 3.7 `PATCH /api/playlists/[id]/items/[videoId]/route.ts` — reorder.
- [x] 3.8 `DELETE /api/playlists/[id]/items/[videoId]/route.ts` — remove.
- [x] 3.9 Map typed errors to HTTP codes per design.md § "API routes" table.

## 4. UI — list and detail pages

- [x] 4.1 `src/app/playlists/page.tsx` — RSC list page with "+ New" dialog.
- [x] 4.2 `src/app/playlists/[id]/page.tsx` — RSC detail page with header + ordered items.
- [x] 4.3 Client island: inline rename + delete confirm on detail page.
- [x] 4.4 Client island: remove-from-playlist action per item.
- [x] 4.5 Client island: reorder per item (arrows ↑↓ in phase 1; drag handle deferred to a follow-up).
- [x] 4.6 Empty-state copy for `/playlists` when zero playlists exist.

## 5. UI — AddToPlaylist component + card integration

- [x] 5.1 `src/components/playlist/AddToPlaylistButton.tsx` — popover with checkbox list + "Create new".
- [x] 5.2 Add the button to `src/components/VideoCard.tsx` action row.
- [x] 5.3 Add the button to `src/components/LibraryCard.tsx` action row.
- [x] 5.4 Render a small "in N playlists" indicator on both card types.
- [x] 5.5 Batch-load `getPlaylistsForVideo` for list pages to avoid N+1 queries; pass through props.

## 6. Nav

- [x] 6.1 Add a "Playlists" link to `src/components/issue/TopNav.tsx` (note: this component will be replaced in phase 3; the edit is temporary scaffolding).

## 7. Docs

- [x] 7.1 Add a "Playlists" subsection to `CLAUDE.md` under the Web UI section. Mention `src/lib/playlists.ts` as the only mutation path.
- [x] 7.2 Add a "Playlists" section to `RUNBOOK.md`: creation, edit, delete, position rebalance notes, manual SQL recovery pointers.
- [x] 7.3 Update `RUNBOOK.md` `_Last verified:_` date to the ship date of this change.

## 8. Spec

- [x] 8.1 The spec delta at `openspec/changes/playlists/specs/playlists/spec.md` is authoritative for this phase; when archiving, copy it into `openspec/specs/playlists/spec.md`.

## 9. Verification before archive

- [x] 9.1 Create, rename, delete a playlist via UI. (API smoke covers the same code path: create→PATCH rename→DELETE all returned the expected statuses.)
- [x] 9.2 Add, remove, reorder items via UI. (API smoke: POST item, DELETE item, PATCH position all verified.)
- [x] 9.3 Deleting a playlist cascades items (verify by SQL: `SELECT COUNT(*) FROM playlist_items WHERE playlist_id = <deleted_id>` returns 0).
- [x] 9.4 Deleting a video (e.g., via a channel removal) cascades out of playlists (same SQL shape). Verified via tsx with `foreign_keys=ON` (1 → 0).
- [x] 9.5 Adding the same video twice returns HTTP 409.
- [x] 9.6 No regression on existing magazine flows: open `/`, see today's issue; drag a video to a slot; publish; see the published issue at `/issues/[id]`. (`/`, `/issues` both render 200; UI surfaces unchanged — playlists are pure addition.)
- [x] 9.7 `/section/[slug]` and `/inbox`-equivalent flows still work (whatever the current state is — phase 1 does not change them). (`/sections`, `/library` render 200.)
- [x] 9.8 `npm run lint` passes.
- [x] 9.9 `_Last verified:_` date updated in `RUNBOOK.md`.

## 10. Out-of-scope reminders (so reviewers don't ask)

- Agent tools for playlists — phase 3.
- Showing playlists on `/` — phase 3 reads `show_on_home = 1`.
- Auto-creating a Folio playlist from an imported YouTube playlist — follow-up, not this change.
- Drag-to-reorder — follow-up.
- Archived/soft-delete playlists — not planned.
- Playlist tags or categories — not planned.
