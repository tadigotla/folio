## Context

`rename-to-videos` landed the schema shape (`videos` + `consumption`) and a legal transition matrix, but left three lifecycle edges theoretical:
- `saved → in_progress` — has no writer.
- `in_progress → archived` — has no writer.
- Resume position — no schema column, no persistence.

The existing `/watch/[id]` is a ten-line `<iframe src="youtube.com/embed/{id}?autoplay=1" />`. Zero feedback from the player to the app. This change adds that feedback loop.

Constraints carried forward:
- Next.js 16 + React 19; RSC reads SQLite, client islands handle interactivity.
- No OAuth, no YouTube Data API calls. Only the public IFrame Player API (`www.youtube.com/iframe_api`) which is key-free and loads client-side.
- Single-user local app; single-tab in practice. No distributed-systems concerns.
- SQLite via `better-sqlite3`, migrations under `db/migrations/NNN_*.sql`.
- All timestamp display goes through `src/lib/time.ts`.

## Goals / Non-Goals

**Goals:**
- Starting playback automatically tracks the video as `in_progress`, from any prior status.
- Pausing / closing / completing a video persists the last known position so the next open resumes where the user left off (auto-seek on load).
- Natural completion auto-archives the video so the user isn't managing lifecycle for stuff they've finished.
- The In Progress section of the Library stops being empty.
- No new dependencies; no OAuth; no Data API.

**Non-Goals:**
- Distinguishing "watched" from "skimmed to 95%" — needs `duration_watched_seconds`, deferred.
- Backfilling `videos.duration_seconds` where RSS didn't carry it — deferred to `oauth-youtube-import`.
- Timestamped highlights, SR review scheduling — `spaced-review` territory.
- A visible resume UI. Auto-seek is silent.
- Keyboard shortcuts on `/watch`. Separate change.
- Handling two tabs playing the same video coherently. Accept last-write-wins.

## Decisions

### IFrame Player API, loaded via a client island

```
WatchPage (RSC, unchanged in shape)
  reads video + consumption from SQLite
  passes { id, initialPosition: consumption.last_position_seconds ?? 0 } to Player

Player (client)
  ensures the global YT API script is loaded (once per session)
  on YT.Player ready → bind onStateChange
  on state change → dispatchProgress({ action, position? })
```

The API script (`https://www.youtube.com/iframe_api`) is loaded once via a tiny module-level promise (subsequent `<Player>` mounts reuse it). `YT.Player` is constructed inside a `useEffect`; `onStateChange` fires with numeric codes (`-1`, `0`, `1`, `2`, `3`, `5`). We handle `1` PLAYING, `2` PAUSED, `0` ENDED; ignore the rest.

- **Alternative considered:** `react-youtube` or `@u-wave/react-youtube` wrapper. Rejected — both add a dependency and hide the state-event names we want to reason about directly. The vanilla API is small.

### Auto-seek on load, not an explicit "Resume" button

The IFrame API supports `playerVars.start = <seconds>` at construction time. We pass `initialPosition` when > 0. No visible UI. Decision locked.

- **Consequence:** if the user finished a video and it was auto-archived (position cleared), replay starts at 0. Expected.
- **Consequence:** if a user wants to restart a partially-watched video, they have to scrub to 0 manually. Acceptable for v1 — a keyboard binding can land in a follow-up change.

### `/api/consumption-progress` separate from `/api/consumption`

```
POST /api/consumption           ← explicit user intent (button click)
  body: { videoId, next: ConsumptionStatus }

POST /api/consumption-progress  ← implicit playback signal
  body: { videoId, action: 'start' | 'tick' | 'pause' | 'end', position?: number }
```

The two endpoints have different semantics (explicit transition vs. side-effectful tick), different failure modes (a 422 from `/consumption` should surface to the user; a 422 from `/consumption-progress` is probably a race and should be swallowed), and different payload shapes. Decision locked: keep them separate.

### Transition matrix update

| From | To | When | Legal before? |
|------|-----|------|---------------|
| `inbox` | `in_progress` (via `saved`) | PLAYING event, two-hop in one handler | No — chain via existing edges |
| `saved` | `in_progress` | PLAYING event | Yes |
| `archived` | `in_progress` | PLAYING event | **No — new edge** |
| `in_progress` | `archived` | ENDED event | Yes |
| `dismissed` | anything on PLAYING | — | Never; see below |

Locked: add direct `archived → in_progress`. The `inbox → in_progress` case stays as a two-hop through `saved` (no new matrix edge needed — the handler just calls `setConsumptionStatus` twice inside a single SQLite transaction).

**Dismissed and playing.** If the user lands on `/watch/[id]` for a dismissed video (e.g. via a direct URL), the iframe still plays because `/api/consumption-progress` is what gatekeeps. Progress writes against a dismissed row: we skip the status transition (`dismissed` has no play-triggered legal edge) but still persist `last_position_seconds`. Position without lifecycle — acceptable; the user acted deliberately by deep-linking.

### The auto-transition handler: `recordProgress`

New function in `src/lib/consumption.ts`:

```ts
export type ProgressAction = 'start' | 'tick' | 'pause' | 'end';

export function recordProgress({
  videoId,
  action,
  position,
}: {
  videoId: string;
  action: ProgressAction;
  position?: number;
}): void {
  const db = getDb();
  const current = db.prepare('SELECT * FROM consumption WHERE video_id = ?').get(videoId) as Consumption | undefined;
  if (!current) return; // video not in inbox/library — skip silently

  db.transaction(() => {
    switch (action) {
      case 'start':
        if (current.status === 'inbox') {
          setConsumptionStatus(videoId, 'saved');
          setConsumptionStatus(videoId, 'in_progress');
        } else if (current.status === 'saved' || current.status === 'archived') {
          setConsumptionStatus(videoId, 'in_progress');
        }
        touchLastViewedAt(videoId);
        break;
      case 'tick':
      case 'pause':
        if (typeof position === 'number') updatePosition(videoId, position);
        touchLastViewedAt(videoId);
        break;
      case 'end':
        if (current.status === 'in_progress') {
          setConsumptionStatus(videoId, 'archived');
          clearPosition(videoId);
        }
        break;
    }
  })();
}
```

Wrapped in a `db.transaction()` so the two-hop `inbox → saved → in_progress` is atomic. `setConsumptionStatus` still enforces the legal matrix; if a race produces an illegal intermediate state, `IllegalTransitionError` aborts the transaction and the tick is lost (correct).

- **Alternative considered:** bypass `setConsumptionStatus` and write `UPDATE consumption SET status = ?` directly inside `recordProgress`. Rejected — the whole point of routing through `setConsumptionStatus` is that the matrix is enforced in one place.

### Tick cadence: 30 seconds

While the player is in PLAYING, fire `action: 'tick'` every 30s with the current `getCurrentTime()`. Locked. Additional sync points:
- `onStateChange → PAUSED` → `action: 'pause'`
- `onStateChange → ENDED` → `action: 'end'`
- `document.visibilitychange → hidden` → `action: 'pause'` with current position, via `navigator.sendBeacon`
- `window.pagehide` → same, via `sendBeacon`

A 2-hour video generates ~240 `tick` writes plus 1-2 `pause`/`end` writes. SQLite absorbs that without breaking a sweat. If it ever becomes a problem, bump the interval to 60s.

- **Alternative considered:** debounce writes to "only write if position moved by ≥ interval seconds". Rejected for v1 — the 30s cadence already bounds it; debouncing adds code without a clear win.

### `sendBeacon` over `fetch(keepalive)` for unload writes

Both work. `navigator.sendBeacon` is purpose-built, has the simpler API (fire-and-forget, no response handling), and doesn't require the extra `keepalive: true` flag dance. Use it. Fall back to `fetch(..., { keepalive: true })` only if `navigator.sendBeacon` is somehow unavailable (all modern browsers support it; this is theoretical).

### Progress bar on library cards

A 4px-tall bar at the bottom of the card's thumbnail, red-ish, width `= (last_position_seconds / duration_seconds) × 100%`. Only rendered when both values are known and status is `in_progress`. Implemented inline in `VideoCard.tsx` — not worth a separate component.

- **Alternative considered:** show the bar on Saved and Archived cards too (percent-of-video-touched, regardless of status). Rejected — out of scope, and would confuse the "In Progress" distinction.

### What `last_viewed_at` means now

It gets updated on every `start`, `tick`, `pause`, `end`. That makes it a "most recently interacted with in the player" timestamp, which is what `library-view` can sort In Progress by (most recently touched first). Decision: sort In Progress by `last_viewed_at DESC`, falling back to `status_changed_at DESC` if null.

## Risks / Trade-offs

- **Event flood during scrubbing.** Seeking can emit PAUSED → BUFFERING → PLAYING rapidly. The handler ignores BUFFERING; PAUSED+PLAYING near-simultaneous just means a position write then a status confirmation — both fine. Not mitigating further.
- **Spurious ENDED on end-scrubbing.** If a user scrubs to the very end and back, ENDED might fire, archiving the video. Mitigation: only treat ENDED as completion if the current status is already `in_progress` (which it will be after the prior PLAYING). Still archives in the scrub case — acceptable; the user can re-open. If it becomes a nuisance, add a "position must be within 2s of duration" guard.
- **Two-hop `inbox → saved → in_progress` bypasses Inbox triage intent.** A user who clicked an inbox card to preview a video has now *implicitly saved* it just by the iframe playing. Locked decision — user confirmed auto-promote. Side effect: inbox items the user "bounced off" within 3s are still saved. Acceptable; the user can archive or dismiss-from-library later.
- **Autoplay blocking.** Chromium may block autoplay in some contexts (no prior interaction, tab opened in background). The IFrame API will just not emit PLAYING until the user clicks play. Nothing breaks; progress tracking just starts when they click.
- **Beacon writes after the user navigates away.** `sendBeacon` is best-effort; the request may be dropped if the browser is shutting down hard. Accept. We also have the 30s tick; the worst case is ~30s of lost progress.
- **Migration additive only.** `ALTER TABLE consumption ADD COLUMN last_position_seconds INTEGER` is a fast, non-blocking SQLite operation. No backup-required step. Existing `RUNBOOK.md` pre-migration-backup guidance still applies generally, but this specific migration is low-risk.
- **Operational invariant.** No ports, env vars, or services change. `justfile` + `RUNBOOK.md` do **not** need updating for this change. (Still, if anything below stretches the scope into new deps / env, update both — per the standing invariant.)

## Open Questions

- **Should the home page get a "Continue watching" rail fed by `in_progress`?** Data will exist immediately; the UI is ~30 lines. Leaning: include as a bonus in this change. Flagging — if it adds scope, cut.
- **Should `last_position_seconds` persist across archive?** Currently we clear it on auto-archive. If the user re-opens an archived video, seek from 0. Alternative: preserve the position so re-open resumes at end. Leaning **clear on archive** (current decision) — finished is finished.
- **Should we track position for `saved` videos that the user plays for 2 seconds and bounces from?** Currently yes — any tick writes position. Could introduce a minimum-watch threshold before writing. Leaning **no threshold** — the auto-promote to `in_progress` already means any playback is a lifecycle event.
