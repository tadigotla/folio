# Runbook
_Last verified: 2026-04-21 (editor-workspace)_

## Overview
Folio — a personal YouTube-library magazine. Single-process Next.js 16 app
(React 19) on port **6060**, reading/writing a local SQLite file (`events.db`
at the repo root — still named `events.db` for historical reasons; it now
holds `videos`, `channels`, `consumption`, `video_provenance`, `import_log`,
etc.). All corpus data is imported **on demand** from the user's YouTube
account via the `/settings/youtube` page. No cron, no background jobs, no
Docker, no prod deployment, no staging — this runs locally only.

## Services & Ports
| Service    | Port | Purpose                                                   |
|------------|------|-----------------------------------------------------------|
| `next dev` | 6060 | Web UI + API routes. Launched foreground via `just dev`.  |
| SQLite     | —    | File at `./events.db` (+ `-wal`, `-shm`). WAL mode.       |

## Quick start — `just dev`
1. `npm install` (first time only).
2. Copy `.env.example` to `.env` and fill in `YOUTUBE_OAUTH_CLIENT_ID` /
   `YOUTUBE_OAUTH_CLIENT_SECRET` (see "YouTube OAuth" below).
3. `just dev` — foreground Next.js dev server on http://localhost:6060.
   Migrations run automatically on boot, including the library-pivot
   migration `010_library_pivot.sql` which creates an empty corpus on a
   first boot.
4. Visit http://localhost:6060/settings/youtube and click **Connect
   YouTube account**. After consent you'll land back on the settings page
   with Import buttons enabled.

## Before risky migrations — **`just backup-db`**
**Any destructive migration MUST be preceded by `just backup-db`.** The
library-pivot migration (`010_library_pivot.sql`) drops the `sources` and
`issues` tables and truncates `videos`, `channels`, `consumption`,
`channel_tags`, `sections`, and `tags`. It is the intended one-time reset
for the Phase 1 pivot — but if you are re-applying it on a DB that already
holds content, back up first.

`just backup-db` checkpoints WAL and writes `events.db.YYYYMMDD-HHMMSS.bak`
alongside the live DB. To roll back after a botched migration:

1. Stop the dev server.
2. `cp events.db.<stamp>.bak events.db` (and delete any `-wal`/`-shm`
   siblings).
3. `git revert` the migration commit so the migration runner does not
   re-apply the migration on next boot.

Both steps are required — the restored backup contains a `_migrations` row
marking the migration as applied, so without the git revert the runner
would re-apply the migration on next boot.

## Is it running? — `just status`
Shows:
- Anything listening on `:6060` (the dev server).
- Size/presence of `events.db` and its WAL files.

## Stop everything — `just down`
Kills any process holding `:6060`.

## Environments
- **Local (only):** macOS, Node 24 (`v24.13.1` tested), `npm`/`npx tsx`. Port 6060.
  Secrets live in `.env` / `.env.local`.
- **Staging:** none.
- **Production:** none. Do not run `npm start` — the project is dev-only.

## YouTube OAuth
The app imports the user's YouTube library (Likes, Subscription uploads,
user-owned Playlists) via the YouTube Data API v3 with the
`https://www.googleapis.com/auth/youtube.readonly` scope. Read-only; Folio
never modifies your YouTube state.

### One-time Google Cloud setup
1. Create a project at https://console.cloud.google.com/.
2. **APIs & Services → Library → YouTube Data API v3 → Enable**.
3. **APIs & Services → OAuth consent screen** — pick **External**, fill in
   the minimum required fields, leave the app unpublished (**Testing**),
   and add your own Google account as a **Test user**. The consent screen
   will warn "Google hasn't verified this app" on sign-in — click
   **Advanced → Go to Folio (unsafe)**. Expected for a single-user local
   install.
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**,
   Application type **Web application**. Add authorized redirect URI:
   `http://localhost:6060/api/youtube/oauth/callback`. The port must match
   `next dev` (**6060**). If you change ports, update this URI in Google
   Cloud Console and update the hardcoded `REDIRECT_URI` in
   `src/lib/youtube-oauth.ts`.
5. Copy the client ID and client secret into `.env`:
   ```
   YOUTUBE_OAUTH_CLIENT_ID=...
   YOUTUBE_OAUTH_CLIENT_SECRET=...
   ```
6. Restart `just dev` and visit http://localhost:6060/settings/youtube →
   **Connect YouTube account**. Consent, then you'll land back with Import
   buttons.

### Where tokens live
Tokens are stored in the `oauth_tokens` table inside `events.db`, NOT in
`.env*`. The row is keyed on `provider = 'youtube'`. The DB file is
gitignored alongside the rest of app state. The access token is refreshed
lazily on each API call when it's within 60 seconds of expiry.

### Forcing re-auth
Click **Disconnect** on `/settings/youtube` — this deletes the
`oauth_tokens` row only. The imported corpus (videos, channels,
consumption, provenance) is untouched. Click **Connect** again to re-grant.

To revoke Folio's access from Google's side, visit
https://myaccount.google.com/permissions. After revocation, the next
import will fail with HTTP 409 and the settings page will show a
**Reconnect YouTube** banner.

## Importing your library
All imports are manual. Run them whenever you want; each is idempotent
(existing consumption state is preserved).

| Button | What it imports | Default consumption status | Signal weight |
|---|---|---|---|
| **Import likes** | Every video in your YouTube Likes (paginates through `LL`). | `saved` | 1.0 |
| **Import subscriptions** | The N most-recent uploads per subscribed channel (N = `YOUTUBE_SUBSCRIPTION_UPLOAD_LIMIT`, default 25). | `inbox` | 0.3 |
| **Load my playlists → Import** | All items in a user-selected playlist. | `saved` | 0.7 |

Signal weight is written to `video_provenance.signal_weight` and is
consumed by a future Phase 4 curation agent; Phase 1 records it but does
not use it for ranking. A video imported by multiple routes gets multiple
`video_provenance` rows.

Quota notes: `playlistItems.list` and `subscriptions.list` are 1 unit per
page. Importing ~10k Likes (200 pages) + 100 subs + a handful of playlists
is comfortably under the 10,000 units/day default quota.

## Data reset
The library-pivot migration (`010_library_pivot.sql`) is destructive: it
drops the legacy `sources` and `issues` tables and truncates the content
tables (`videos`, `channels`, `consumption`, `channel_tags`, `sections`,
`tags`). It runs automatically on next boot after the migration file
lands in `db/migrations/`.

**Before the first boot with this migration** present:

1. `just backup-db` — write a timestamped copy of the pre-reset state.
2. Confirm the backup file exists and is non-empty.
3. Start `just dev` — migration runs, DB is reset, app boots into the
   "not connected" state.
4. Connect YouTube and import (see above).

**Rollback** is the two-step procedure in the "Before risky migrations"
section above: restore the backup **and** `git revert` the migration
commit.

## Editor workspace
The home page at `/` is the editor when a corpus is present. Compose an
issue by dragging videos from the inbox **pool** (right column) onto the
slots on the **board** (left column). Each issue has exactly 14 slots:
1 cover, 3 featured, 10 briefs. Empty slots render as dashed placeholders.

### Lifecycle
- `draft → published`, one direction. Published issues are frozen — the
  API rejects slot mutations on them with HTTP 409 `issue_frozen`.
- **At most one draft at a time.** `POST /api/issues` returns HTTP 409
  `{ error: 'draft_exists', draft_id }` if a draft already exists. The
  **Discard** button in the workspace header deletes the current draft
  (and all its slot assignments) so a new one can be started.
- Publishing a **partial** issue is allowed — any slot count from 1 to 14
  will publish. Empty slots render as muted placeholders on `/issues/[id]`.
- Assigning an inbox video to any slot auto-promotes its consumption
  status `inbox → saved` in the same transaction. Clearing or swapping a
  slot does **not** demote.

### Where published issues live
- `/issues` — reverse-chron grid of all published issues.
- `/issues/[id]` — read-only magazine-style view.

### Desktop only
The drag-and-drop workspace is **desktop-only**. On a mobile user agent
the home page renders an "open on desktop" message; `/library`,
`/issues`, `/issues/[id]`, and `/watch/[id]` remain fully mobile. There
is no touch drag-and-drop fallback in this phase.

### URL change
`/inbox` has been **removed**. Triage now happens inside the editor
workspace by dragging videos from the pool into slots, or dismissing
them with the hover button on the pool card. Bookmarks to `/inbox`
will 404.

## Troubleshooting
- **"Port 6060 in use"** — `just down`, or `lsof -i :6060` to see what's
  holding it.
- **"Reconnect required" banner on settings page** — the stored refresh
  token was revoked (manually, via Google security settings, or by
  prolonged inactivity). Click Connect to re-consent. Imports will
  resume; the existing corpus is untouched.
- **"Missing YOUTUBE_OAUTH_CLIENT_ID"** at
  `/api/youtube/oauth/authorize` — env vars not loaded. Restart
  `just dev` after editing `.env` / `.env.local`.
- **Import button returns an error with HTTP 403 / quota** — you've
  exhausted the daily YouTube API quota. Wait until midnight Pacific and
  retry. See quota notes above.
- **"DB is locked" / busy** — SQLite busy timeout is 5s. Don't hold a
  `sqlite3 events.db` shell open while the dev server is writing.
- **"Where did dev server logs go?"** — `next dev` runs in the
  foreground. Logs only exist in whatever terminal ran `just dev`.
- **`/inbox` returns 404** — expected. The raw inbox page was removed
  in the editor-workspace change; use the editor at `/` instead.
- **Can't start a new issue, button is missing** — there is already a
  draft. Either finish it (Publish), or click **Discard** on the
  workspace header to throw it away. Only one draft may exist at a time.
