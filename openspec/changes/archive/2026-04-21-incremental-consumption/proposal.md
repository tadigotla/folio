## Why

Today the `in_progress` state has no writer — nothing in the system ever transitions a video into it, which is why the Library's In Progress section renders empty by design. The player is a dumb iframe with no feedback loop: it doesn't know when the user started watching, how far they got, or whether they finished. The consequence is that the consumption lifecycle is stuck as a manual two-state toggle (saved ↔ archived) instead of the four-state model the schema already supports.

This change wires the YouTube IFrame Player API into `/watch/[id]` so playback events drive `consumption` state. Starting a video auto-transitions it to `in_progress`; pause and periodic ticks persist position; natural end-of-video auto-transitions to `archived`; re-opening saves resume position. It is the prerequisite for `spaced-review` (which needs a real notion of "watched" beyond a boolean).

## What Changes

- **MODIFIED** `player-view`: replace the plain iframe with a YouTube IFrame Player API embed. Same visible player; now emits `onReady` and `onStateChange`. Autoplay stays on.
- **MODIFIED** `player-view`: when `consumption.last_position_seconds > 0`, the player auto-seeks to that position on load (via the `start` URL param). No visible "resume" UI — seek happens silently.
- **MODIFIED** `player-view`: wire `onStateChange` to a new `POST /api/consumption-progress` endpoint. Fires on PLAYING, PAUSED, ENDED, a 30s interval while PLAYING, and on `visibilitychange → hidden` / `pagehide` (via `navigator.sendBeacon`).
- **MODIFIED** `video-library`: `consumption` gains `last_position_seconds INTEGER NULL`. `last_viewed_at` (already in schema, unused) starts being written.
- **MODIFIED** `video-library`: add `archived → in_progress` to the legal transition matrix. Auto-promote: when a video with status `inbox` begins playing, the handler performs `inbox → saved → in_progress` in a single transaction. When a video with status `saved` begins playing, it transitions directly to `in_progress`. When a video with status `archived` begins playing, it transitions directly to `in_progress` (new edge).
- **MODIFIED** `video-library`: introduce a separate `POST /api/consumption-progress` endpoint for playback events. The existing `POST /api/consumption` keeps its role for explicit user actions (save, dismiss, archive, re-open) — the two endpoints stay separate because their payloads and semantics differ.
- **MODIFIED** `library-view`: the In Progress section is populated. Its cards render a thin progress bar (`last_position_seconds / duration_seconds`) when duration is known; otherwise no bar. The "populated by later changes" requirement is removed.
- **ADDED** `video-library`: auto-archive on natural end-of-video. When `onStateChange` reports ENDED and the current status is `in_progress`, transition to `archived`. If the video is already `archived`, no-op. `last_position_seconds` is cleared on archive.

## Capabilities

### Modified Capabilities
- `video-library`: adds `last_position_seconds` column, adds the `archived → in_progress` edge, introduces auto-transitions on playback events, and defines the `/api/consumption-progress` endpoint alongside the existing `/api/consumption`.
- `player-view`: upgrades the iframe to the IFrame Player API, wires state events to the progress endpoint, and auto-seeks to the stored resume position.
- `library-view`: populates the In Progress section and adds a progress-bar visual.

## Impact

- **Code:**
  - `src/components/Player.tsx` — rewrite as a client island that loads the IFrame API script, binds `YT.Player`, and dispatches events.
  - `src/lib/consumption.ts` — extend `LEGAL_TRANSITIONS` with `archived → in_progress`; new exported function `recordProgress({ videoId, action, position? })` holding the switch over `start | tick | pause | end`.
  - `src/app/api/consumption-progress/route.ts` — new POST handler. Returns 204 on success, 422 on illegal transition, 400 on malformed payload.
  - `src/app/watch/[id]/page.tsx` — pass `last_position_seconds` to `<Player>`.
  - `src/components/VideoCard.tsx` (or a small `ProgressBar.tsx`) — render the progress bar for in-progress videos.
  - `src/app/library/page.tsx` — stop treating In Progress as decorative; render its content.
  - `db/migrations/007_consumption_position.sql` — add the `last_position_seconds` column.
- **Database:** one additive migration (`ALTER TABLE consumption ADD COLUMN`). No data backfill required — existing rows stay `NULL`, meaning "no resume position", which the player handles.
- **API:** one new route (`/api/consumption-progress`). Existing `/api/consumption` unchanged.
- **Operational:** no `justfile` / `RUNBOOK.md` changes (no new service/port/env). `npm run build` should still produce a working app with no new runtime deps.
- **Out of scope (deferred):**
  - `duration_watched_seconds` (distinct from `last_position_seconds` — needed by `spaced-review` to distinguish "watched the whole thing" from "scrubbed to the end"). YAGNI until `spaced-review`.
  - Duration backfill for videos where `duration_seconds` is NULL. Slots into `oauth-youtube-import` via the Data API.
  - Highlights capture (`H` key at timestamp → `highlights` row). Belongs in `spaced-review`.
  - Keyboard bindings on `/watch` (pause, seek, mark highlight, etc.). Follow-up change.
  - Cross-tab reconciliation. Last write wins.
  - "Continue watching" rail on the home page. Data will be there; UI is a separate, easy follow-up.
