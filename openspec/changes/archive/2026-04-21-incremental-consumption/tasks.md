## 1. Schema

- [x] 1.1 Write `db/migrations/007_consumption_position.sql`: `ALTER TABLE consumption ADD COLUMN last_position_seconds INTEGER` (nullable, defaults to NULL)
- [x] 1.2 Verify `npm run fetch` applies the migration cleanly (it invokes `runMigrations()`); confirm `PRAGMA table_info(consumption)` shows the new column
- [x] 1.3 Extend `src/lib/types.ts`: add `last_position_seconds: number | null` to the `Consumption` interface

## 2. Consumption layer

- [x] 2.1 Add the `archived → in_progress` edge to `LEGAL_TRANSITIONS` in `src/lib/consumption.ts`
- [x] 2.2 Add helpers to the same file (not exported via the route — internal):
  - [x] 2.2.1 `updatePosition(videoId: string, position: number): void` — writes `last_position_seconds` and `last_viewed_at`
  - [x] 2.2.2 `clearPosition(videoId: string): void` — sets `last_position_seconds = NULL`
  - [x] 2.2.3 `touchLastViewedAt(videoId: string): void`
- [x] 2.3 Add exported `recordProgress({ videoId, action, position? })` wrapping everything in `db.transaction()`:
  - [x] 2.3.1 `'start'` on `inbox` → two-hop `inbox → saved → in_progress` via `setConsumptionStatus` twice
  - [x] 2.3.2 `'start'` on `saved` or `archived` → single-hop to `in_progress`
  - [x] 2.3.3 `'start'` on `in_progress` → no status change, only `touchLastViewedAt`
  - [x] 2.3.4 `'start'` on `dismissed` → no status change, no position write (skip silently)
  - [x] 2.3.5 `'tick'` / `'pause'` on any non-dismissed status → `updatePosition` + `touchLastViewedAt`
  - [x] 2.3.6 `'end'` on `in_progress` → transition to `archived` + `clearPosition`
  - [x] 2.3.7 `'end'` on any other status → no-op
- [x] 2.4 Update `VideoWithConsumption` and the `SELECT_VIDEO_WITH_CONSUMPTION` projection to include `last_position_seconds`

## 3. API route

- [x] 3.1 Create `src/app/api/consumption-progress/route.ts` exporting `POST`
- [x] 3.2 Validate payload: `videoId` string non-empty; `action` one of `'start' | 'tick' | 'pause' | 'end'`; `position` optional number ≥ 0
- [x] 3.3 Respond `400` on malformed payload; `204` on success; `422` if `setConsumptionStatus` throws `IllegalTransitionError` (rare, typically a race)
- [x] 3.4 Accept `sendBeacon` payloads: the `Content-Type` is often `text/plain;charset=UTF-8` (beacon default). Parse body as JSON regardless of content-type

## 4. Player rewrite

- [x] 4.1 Rewrite `src/components/Player.tsx` as a `'use client'` component taking `{ videoId: string; initialPosition?: number }`
- [x] 4.2 Load the IFrame API script exactly once per session via a module-level promise that resolves on `window.onYouTubeIframeAPIReady`
- [x] 4.3 Construct `new YT.Player(elementId, { videoId, playerVars: { autoplay: 1, start: initialPosition ?? 0, enablejsapi: 1 }, events: { onStateChange } })` inside a `useEffect`; destroy the player on unmount
- [x] 4.4 Implement `dispatchProgress(action, position?)` as a small `fetch('/api/consumption-progress', ...)` call. Swallow errors — this is fire-and-forget
- [x] 4.5 In `onStateChange`:
  - [x] 4.5.1 State `1` (PLAYING) → `dispatchProgress('start')` on the first PLAYING since mount; otherwise skip (subsequent PLAYING events come from un-pause and don't need another 'start')
  - [x] 4.5.2 State `2` (PAUSED) → `dispatchProgress('pause', player.getCurrentTime())`
  - [x] 4.5.3 State `0` (ENDED) → `dispatchProgress('end')`
  - [x] 4.5.4 Other states → ignore
- [x] 4.6 Set up a 30-second `setInterval` while PLAYING that calls `dispatchProgress('tick', player.getCurrentTime())`; clear the interval on non-PLAYING states and on unmount
- [x] 4.7 On `document.visibilitychange → 'hidden'` and on `window.pagehide`, use `navigator.sendBeacon('/api/consumption-progress', JSON.stringify({ videoId, action: 'pause', position: player.getCurrentTime() }))`. Detach the listeners on unmount
- [x] 4.8 Ensure the component still renders the same `aspect-video` container and fills its parent

## 5. Watch page

- [x] 5.1 Update `src/app/watch/[id]/page.tsx` to read `last_position_seconds` from the joined `consumption` and pass it as `initialPosition` to `<Player>`
- [x] 5.2 No visible "Resume at …" UI — auto-seek is silent

## 6. Library view

- [x] 6.1 Update `src/app/library/page.tsx`: In Progress section now renders `getLibraryVideos().inProgress` (already returned by the helper). Remove or update any "populated by later changes" copy
- [x] 6.2 Sort In Progress by `last_viewed_at DESC`, falling back to `status_changed_at DESC` when null — adjust `getLibraryVideos` query accordingly (or sort client-side in JS)
- [x] 6.3 In `src/components/VideoCard.tsx`, render a 4px-tall progress bar at the bottom of the thumbnail when `status === 'in_progress'`, `last_position_seconds` is non-null, and `duration_seconds` is non-null. Width = `(last_position_seconds / duration_seconds) * 100%`, capped at 100

## 7. Spec deltas

- [x] 7.1 Write `openspec/changes/incremental-consumption/specs/video-library/spec.md` with the MODIFIED / ADDED requirements per the design
- [x] 7.2 Write `openspec/changes/incremental-consumption/specs/player-view/spec.md` with MODIFIED requirements (IFrame API, state events, auto-seek)
- [x] 7.3 Write `openspec/changes/incremental-consumption/specs/library-view/spec.md` with MODIFIED requirements (In Progress populated, progress bar) and REMOVED requirement ("In Progress is populated by later changes")

## 8. Verify end-to-end

- [x] 8.1 `npm run lint` and `npm run build` clean
- [x] 8.2 `npm run dev`; open `/watch/<an-inbox-video-id>`; confirm the card moves from Inbox to Library's In Progress section after ~1 second of playback (verify via the Library page)
- [x] 8.3 Pause the player; wait ~3 seconds; re-open the same `/watch/[id]`; confirm the video resumes at the paused position
- [x] 8.4 Let a short video play to natural end; confirm it moves to Archived and `last_position_seconds` is NULL
- [x] 8.5 Close the tab mid-playback; re-open `/watch/[id]` within a minute; confirm resume position is recent (beacon worked)
- [x] 8.6 Navigate to a `/watch/[id]` for a dismissed video directly (by URL); play briefly; confirm status stays `dismissed` and no progress row is written

## 9. Docs

- [x] 9.1 Update `CLAUDE.md`: Player view note — "IFrame Player API upgrade happens in `incremental-consumption`" becomes current reality; describe `/api/consumption-progress` briefly alongside `/api/consumption`
- [x] 9.2 No `RUNBOOK.md` change required (no new service/port/env). If scope creeps into any of those, update `justfile` and `RUNBOOK.md` in the same change per the standing invariant
