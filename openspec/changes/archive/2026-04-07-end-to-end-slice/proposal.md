## Why

The foundation is in place (schema, types, time lib, seeded sources) but nothing works end-to-end yet. No data flows in, nothing renders. Steps 4-7 of the build plan deliver the first usable slice: pull space launch data from an external API, store it in SQLite, display it on the home page, and let the user click through to an embedded YouTube player. This proves the entire pipeline before adding more sources.

## What Changes

- **Launch Library 2 fetcher** — new fetcher module that calls the LL2 API, normalizes launches into `NormalizedEvent[]`, and returns them for upsert
- **Fetcher orchestrator** — loads enabled sources, runs their fetchers respecting `min_interval_minutes`, upserts events idempotently (`INSERT ... ON CONFLICT DO UPDATE`), sweeps stale events to `ended`
- **Cron entry script** — `scripts/run-fetchers.ts` runnable via `npm run fetch` or system cron
- **Home page** — replaces Next.js boilerplate with a "Live Now" strip and "Next Up" timeline grouped by hour for the next 6 hours, with category filter chips
- **Player view** — `/watch/[id]` route with an embedded iframe (YouTube/Twitch/generic) and event metadata, plus a sidebar of other live events
- **Supporting components** — EventCard, Player, CategoryFilter

## Capabilities

### New Capabilities
- `data-ingestion`: Fetcher interface, orchestrator, upsert pipeline, stale-event sweep, and the Launch Library 2 fetcher as the first implementation
- `home-view`: Home page rendering live-now events and next-6-hours timeline from the database
- `player-view`: Watch page with embedded stream player and event metadata

### Modified Capabilities

_None — no existing specs to modify._

## Impact

- **New files**: `src/fetchers/` directory (orchestrator + launch-library fetcher), `scripts/run-fetchers.ts`, app routes (`page.tsx` rewrite, `watch/[id]/page.tsx`), components (EventCard, Player, CategoryFilter)
- **Modified files**: `src/app/page.tsx` (full rewrite from boilerplate)
- **Dependencies**: no new npm packages needed (all required deps already installed)
- **Database**: events table will begin receiving data; no schema changes
