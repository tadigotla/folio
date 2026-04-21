# Runbook
_Last verified: 2026-04-21 (mag-look)_

## Overview
Personal YouTube-primary video library. Single-process Next.js 16 app (React 19)
on port **6060**, reading/writing a local SQLite file (`events.db` at the repo
root — still named `events.db` for historical reasons; it now holds `videos`,
`channels`, `consumption`, etc.). An ingestion orchestrator
(`scripts/run-fetchers.ts`) is invoked every **30 minutes** by **user crontab**
on this laptop to refresh video data from YouTube RSS feeds. No Docker, no prod
deployment, no staging — this runs locally only.

## Services & Ports
| Service        | Port | Purpose                                                   |
|----------------|------|-----------------------------------------------------------|
| `next dev`     | 6060 | Web UI + API routes. Launched foreground via `just dev`.  |
| fetcher (cron) | —    | `npm run fetch` every 30 min. Logs to `.logs/fetch.log`.  |
| SQLite         | —    | File at `./events.db` (+ `-wal`, `-shm`). WAL mode.       |

## Quick start — `just dev`
1. `npm install` (first time only).
2. `just seed` — applies migrations and upserts the seed rows in `sources`. Safe to re-run.
3. `just dev` — foreground Next.js dev server on http://localhost:6060.
4. (Optional) `just cron-install` — adds the every-30-min fetcher entry to your user crontab.
   Without it, data only refreshes when you run `just fetch` by hand.

## Before risky migrations — `just backup-db`
Any migration that can move or destroy data (e.g. the videos pivot in
`003_videos_schema.sql` / `004_backfill_from_events.sql` / `005_drop_events.sql`)
MUST be preceded by a backup. `just backup-db` checkpoints WAL and writes
`events.db.YYYYMMDD-HHMMSS.bak` alongside the live DB. To roll back after a
botched migration, stop the dev server and the fetcher cron, then
`cp events.db.<stamp>.bak events.db` (removing `-wal`/`-shm` alongside).

## Is it running? — `just status`
Shows:
- Anything listening on `:6060` (the dev server).
- Whether the fetcher cron entry for this checkout is installed.
- Size/presence of `events.db` and its WAL files.

## Stop everything — `just down`
Kills any process holding `:6060`. The fetcher cron keeps firing
independently — run `just cron-uninstall` if you want it off too.

## Environments
- **Local (only):** macOS, Node 24 (`v24.13.1` tested), `npm`/`npx tsx`. Port 6060.
  Secrets live in `.env.local` (currently only `YOUTUBE_API_KEY`, optional —
  YouTube ingestion falls back to RSS if empty).
- **Staging:** none.
- **Production:** none. Do not run `npm start` — the project is dev-only.

## Fetcher cron
- `just cron-install` writes a line tagged with a per-checkout marker
  (`# folio:fetch (<repo path>)`) so re-installing is idempotent and
  multiple checkouts don't collide. The installed entry fires every 30 min
  (`*/30 * * * *`).
- The line invokes the fetcher via a login zsh (`/bin/zsh -lc`) so it
  picks up whichever `node`/`npm` your shell uses (nvm, Homebrew, etc.).
- Output (stdout + stderr) appends to `.logs/fetch.log` in the repo.
  `.logs/` is created by the recipe; add it to `.gitignore` if it isn't already.
- `just cron-uninstall` removes only the line for this checkout.

## Magazine issues

The home page at `/` is a daily magazine view. Composition is **frozen at first open** each day: the first GET on a new local-day (America/New_York) computes a new issue row (`issues` table) and renders it; subsequent opens the same day render the same composition. To recompose explicitly, click **↻ Publish new** in the masthead — this inserts a fresh `issues` row and redirects.

- `issues.cover_video_id` is deterministic (affinity × recency × duration depth; see `src/lib/issue.ts`). `pinned_cover_video_id` overrides it as long as the pinned video is still inbox-valid; if the user archives or dismisses the pin, the rule-picked cover resumes silently.
- `issues.featured_video_ids` is a JSON array (up to 3 video IDs).
- The `sections` table plus `channels.section_id` (added in migration `008_magazine.sql`) power the departments strip and `/section/[slug]` pages. A channel with `section_id IS NULL` is "Unsorted".
- Tags are an additive secondary taxonomy: `tags` + `channel_tags` join (migration `009_tags.sql`). Channels can carry multiple tags; `/tag/[slug]` lists the inbox videos from channels carrying a tag. Tag management lives on `/sections` — each channel row has a Tags popover next to its Section chip.
- Freeze check compares local-date (America/New_York) — crossing midnight opens a new issue on next visit.

## YouTube OAuth
The app can import the user's YouTube subscriptions as per-channel `sources`
rows so new subs appear automatically. OAuth is used **only** to discover
*which* channels to poll — video listing still goes through RSS (quota-free).

### One-time Google Cloud setup
1. Create a project at https://console.cloud.google.com/.
2. **APIs & Services → Library → YouTube Data API v3 → Enable**.
3. **APIs & Services → OAuth consent screen** — pick **External**, fill in the
   minimum required fields, leave the app unpublished (**Testing**), and add
   your own Google account as a **Test user**. The consent screen will warn
   "Google hasn't verified this app" on sign-in — expected for a single-user
   local install.
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**,
   Application type **Web application**. Add authorized redirect URI:
   `http://localhost:6060/api/youtube/oauth/callback`. The port must match
   `next dev` (6060); if you change ports you must update the redirect URI.
5. Copy the client ID and client secret into `.env.local`:
   ```
   YOUTUBE_OAUTH_CLIENT_ID=...
   YOUTUBE_OAUTH_CLIENT_SECRET=...
   ```
6. Restart `just dev` and visit http://localhost:6060/settings/youtube →
   **Connect YouTube account**. Consent, and you'll land back on the settings
   page with an imported-channel count.

### Where tokens live
Tokens are stored in the `oauth_tokens` table inside `events.db`, NOT in
`.env*`. The row is keyed on `provider = 'youtube'`. The DB file is gitignored
alongside the rest of app state. Disconnect from `/settings/youtube` deletes
that row; optionally disables all imported user sources.

### Re-syncing
Subscription sync runs automatically once per fetcher cron tick (every
30 min). Force a run with `just youtube-sync` or the **Re-sync now** button
on `/settings/youtube`. Failures are captured in the synthetic
`youtube_subscriptions_meta` row in `sources` (`last_fetched_at` =
last success, `last_error` = last failure message) and surfaced on the
settings page.

### Troubleshooting
- **"Reconnect required" banner on settings page** — the stored refresh token
  was revoked (manually, via Google security settings, or by prolonged
  inactivity). Click Connect to re-consent. Existing user sources keep
  polling via RSS in the meantime.
- **"Missing YOUTUBE_OAUTH_CLIENT_ID"** at `/api/youtube/oauth/authorize` —
  env vars not loaded. Restart `just dev` after editing `.env.local`.

## Troubleshooting
- **"Port 6060 in use"** — `just down`, or `lsof -i :6060` to see what's holding it.
- **"Fetcher hasn't run"** — `just status` to confirm the cron entry is installed.
  `tail -f .logs/fetch.log` (or `just logs`) to watch the next tick.
  Run `just fetch` once to force a fetch and see errors inline.
- **"DB is locked" / busy** — SQLite busy timeout is 5s. If a long `just fetch`
  is running, the dev server will wait; don't hold a `sqlite3 events.db`
  shell open while writing.
- **"Migrations out of sync"** — `just seed` reapplies migrations (tracked in
  the `_migrations` table) and re-upserts seed rows. Safe to re-run. Take a
  backup first with `just backup-db` if you are worried.
- **"YouTube channel fetcher errors"** — dynamic sources (`id LIKE '%_user'`)
  are built per-request; check `sources.last_error` in `events.db` for the
  captured message. An empty `YOUTUBE_API_KEY` is fine — RSS is the primary path.
- **"Where did dev server logs go?"** — `next dev` runs in the foreground.
  Logs only exist in whatever terminal ran `just dev`. There is no log file
  for the dev server by design.
