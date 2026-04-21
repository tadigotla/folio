## MODIFIED Requirements

### Requirement: Embedded stream player
The player view at `/watch/[id]` SHALL embed the video using the YouTube IFrame Player API (not a plain `<iframe src>`). The rendered player SHALL visually match the prior embed (same aspect ratio, same autoplay behavior) while additionally emitting state-change events the app can observe.

#### Scenario: Player binds to IFrame API
- **WHEN** `/watch/[id]` renders for a valid video
- **THEN** the YouTube IFrame API script SHALL be loaded once per session, a `YT.Player` SHALL be constructed bound to the page's player element, and `onStateChange` SHALL be registered

#### Scenario: Autoplay still applies
- **WHEN** the page loads
- **THEN** the player SHALL be constructed with `playerVars.autoplay = 1` so playback begins immediately when the browser permits

### Requirement: Auto-seek to last known position
When a video has a non-null `consumption.last_position_seconds`, the player SHALL auto-seek to that position silently on load. No visible "resume" UI SHALL be rendered.

#### Scenario: Resume mid-video
- **WHEN** the user opens `/watch/[id]` for a video with `consumption.last_position_seconds = 742`
- **THEN** the player SHALL begin playback at 742 seconds (via the `start` playerVar) without showing a resume prompt

#### Scenario: Fresh video
- **WHEN** the user opens `/watch/[id]` for a video with `consumption.last_position_seconds = NULL`
- **THEN** the player SHALL begin playback from 0

### Requirement: Playback events drive progress endpoint
The player SHALL dispatch playback lifecycle events to `POST /api/consumption-progress`. Event-to-action mapping:

- `onStateChange` PLAYING (state `1`), first occurrence since mount → `{ action: 'start' }`
- `onStateChange` PAUSED (state `2`) → `{ action: 'pause', position: player.getCurrentTime() }`
- `onStateChange` ENDED (state `0`) → `{ action: 'end' }`
- A recurring 30-second interval while the player is in PLAYING → `{ action: 'tick', position: player.getCurrentTime() }`
- `document.visibilitychange` transitioning to `hidden`, and `window.pagehide` → `{ action: 'pause', position: player.getCurrentTime() }` sent via `navigator.sendBeacon`

Other state codes (UNSTARTED `-1`, BUFFERING `3`, CUED `5`) SHALL be ignored. Dispatch failures SHALL be swallowed silently — progress reporting is fire-and-forget.

#### Scenario: First play emits 'start'
- **WHEN** the player transitions from UNSTARTED to PLAYING for the first time after mount
- **THEN** a single `POST /api/consumption-progress` with `action: 'start'` SHALL be issued

#### Scenario: Resume after pause does not re-emit 'start'
- **WHEN** the player transitions PLAYING → PAUSED → PLAYING after the initial 'start'
- **THEN** only the 'pause' action SHALL be dispatched on the PAUSED transition, and no second 'start' SHALL be dispatched on the subsequent PLAYING

#### Scenario: 30-second tick while playing
- **WHEN** the player has been in PLAYING state for 30 seconds continuously
- **THEN** a `tick` action SHALL be dispatched with the current `player.getCurrentTime()` value

#### Scenario: Tab hidden mid-playback
- **WHEN** the user switches tabs while the video is playing
- **THEN** a `pause` action SHALL be sent via `navigator.sendBeacon` with the current position, so the write survives the tab becoming inactive
