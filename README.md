# Folio

A personal, magazine-shaped reading experience for YouTube. Rather than another
endless inbox of thumbnails, Folio treats the videos you subscribe to as a
daily issue — a cover story, a few featured pieces, department columns, and
a briefs list — so opening it feels like sitting down with something considered
instead of processing a queue.

Designed as a single-user, local-only app. No accounts, no cloud, no telemetry.

## What it looks like

- **Home** (`/`) — today's issue. Frozen at first open, recomposed on demand.
  - **Masthead** with the date and a ↻ Publish-new-issue button.
  - **Cover** — the rule-picked lead piece (affinity × recency × duration-depth).
    Hover any Featured or Briefs item to pin it as the cover instead.
  - **Featured** — one per top section.
  - **Departments** — section counts + a few channels per section.
  - **Tags** — an additive slicing layer for channels that span departments.
  - **Briefs** — ten shortest pieces, quick wins.
- **Inbox** (`/inbox`) — the raw firehose. Keyboard-driven triage with undo.
- **Library** (`/library`) — Saved / In Progress / Archived.
- **Sections** (`/sections`) — assign channels to one section (1:1) and any
  number of tags (M:N). Click chips or use the keyboard.
- **Watch** (`/watch/[id]`) — editorial chrome around the YouTube embed.
  Desktop gets the embedded player with keyboard nav (`n`/`p`/`s`/`a`/`d`/`.`)
  and auto-advance + undo. Mobile gets a dedicated layout that hands off to
  the YouTube app/web for playback.

Typography: Fraunces / Inter / IBM Plex Mono. Palette: cream paper, ink,
oxblood, sage. Light-only.

## Quick start

```bash
cp .env.example .env.local
# fill in YOUTUBE_OAUTH_CLIENT_ID / SECRET (see RUNBOOK.md)

npm install
just seed       # apply migrations
just dev        # http://localhost:6060
```

Then visit `/settings/youtube` to connect your YouTube account and import
subscriptions. See [RUNBOOK.md](./RUNBOOK.md) for the full Google Cloud OAuth
walkthrough, cron setup, troubleshooting, and the magazine-issue lifecycle.

### Commands

| Command             | What it does                                                     |
|---------------------|------------------------------------------------------------------|
| `just dev`          | Next.js dev server on **port 6060**                              |
| `just fetch`        | One-shot run of the ingestion orchestrator (what cron invokes)   |
| `just seed`         | Apply migrations + upsert seed sources                           |
| `just status`       | Port / cron / DB health check                                    |
| `just backup-db`    | Timestamped SQLite snapshot (run before risky migrations)        |
| `just cron-install` | Install the every-30-min fetcher cron entry                      |
| `npm run lint`      | ESLint                                                           |
| `npm run build`     | Production build                                                 |

## Architecture

- **Next.js 16** (React 19) App Router. RSC pages read SQLite directly via
  `better-sqlite3`; mutations go through thin JSON API routes.
- **SQLite** at `events.db` in the repo root (gitignored). WAL mode, FKs on.
- **Ingestion**: user-subscribed YouTube channels polled via RSS every 30 min.
  OAuth used only to discover which channels to poll — **video listing is
  quota-free**. The app never proxies or restreams video; playback is the
  official YouTube IFrame Player API (desktop) or a link out (mobile).

Full notes in [CLAUDE.md](./CLAUDE.md) (architecture) and
[RUNBOOK.md](./RUNBOOK.md) (operations).

## Layout on disk

```
src/
  app/            # App Router pages + API routes
  components/     # UI (DuotoneThumbnail, SectionChip, TagsEditor, …)
    issue/        # Home-page issue composition (Masthead/Cover/Featured/…)
    watch/        # Watch page pieces (NextPieceFooter, WatchKeyboard)
    ui/           # Editorial primitives (Kicker, Rule, EditorialMeta)
  lib/            # db, consumption, issue, sections, tags, time, device
  fetchers/       # YouTube RSS orchestrator + per-channel fetchers
db/
  migrations/     # Numbered .sql files applied in lexical order
  seed-sources.ts # Starter YouTube sources
scripts/
  run-fetchers.ts # Cron entrypoint
openspec/         # Per-feature specs + in-flight change proposals
```

## License

Not yet licensed. Pick one before you commit others' code.

## Credits

Design system + editorial approach guided by the idea that magazines are a
solved instance of *"curate too much into something a person can read."*
