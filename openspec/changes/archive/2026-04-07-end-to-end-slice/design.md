## Context

The project has a working foundation: Next.js 16 app with SQLite (better-sqlite3), full schema with `sources` and `events` tables, 7 seeded Phase 1 sources, TypeScript types, and time utilities. The home page is still Next.js boilerplate. No fetcher code exists, no data has been ingested, and no UI renders events.

The proposal doc (`live-events-aggregator-proposal.md`) defines a 12-step build plan. Steps 1-3 are done. This change covers steps 4-7: the first fetcher, the orchestrator, and the two core UI views (home + player).

## Goals / Non-Goals

**Goals:**
- Prove the full pipeline: external API → fetcher → SQLite → UI → embedded player
- Build the orchestrator framework so subsequent fetchers slot in trivially
- Deliver a usable home page showing live/upcoming space launches
- Let the user click an event and watch the stream in an embedded player

**Non-Goals:**
- Remaining 5 Phase 1 fetchers (YouTube channels, C-SPAN, TheSportsDB, NASA iCal, Explore.org) — separate change
- Schedule view, conflict cards, always-on rail — separate change
- Picks/history recording — separate change
- Notifications, auth, mobile optimization

## Decisions

### 1. Fetcher module pattern

Each fetcher is a file in `src/fetchers/` that exports a function matching the `Fetcher` interface from `types.ts`. The orchestrator discovers fetchers via a registry map (`sourceId → fetcher`), not dynamic file scanning.

**Why not dynamic discovery:** With only 7 sources, a static map is simpler and gives TypeScript full type safety. Dynamic import scanning adds complexity for no benefit at this scale.

### 2. Orchestrator runs as a standalone script, not inside Next.js

`scripts/run-fetchers.ts` is the entry point, run via `npm run fetch` (tsx). It imports `getDb()`, loads enabled sources, checks `min_interval_minutes` against `last_fetched_at` to decide which sources to poll, runs their fetchers, and upserts results.

**Why not API route or Next.js middleware:** The proposal explicitly recommends separation. A standalone script is testable, cron-friendly, and doesn't couple data ingestion to the web server lifecycle.

### 3. Upsert strategy

`INSERT INTO events (...) VALUES (...) ON CONFLICT(id) DO UPDATE SET ...` — updates all mutable fields (title, status, starts_at, ends_at, stream_ref, thumbnail_url, last_checked_at, updated_at, raw) while preserving `first_seen_at`.

The event `id` is `${sourceId}:${sourceEventId}`, as specified in the proposal.

### 4. Stale event sweep

After all fetchers run, the orchestrator marks any event with `status = 'scheduled'` and `starts_at` more than 6 hours in the past as `ended`. This catches events whose sources never reported completion.

### 5. Home page: Server Components with minimal client interaction

The home page is a React Server Component that queries SQLite directly (no API route needed for reads). It renders:
- A "Live Now" strip for events with `status = 'live'`
- An hour-by-hour timeline for the next 6 hours
- Category filter chips (client component for interactivity, uses URL search params)

**Why server components for data:** Single-user app, SQLite is local, no need for a fetch-from-API-route round trip. Server components read the DB directly at render time.

### 6. Player view: `/watch/[id]` dynamic route

A dynamic route that loads the event by ID, renders the appropriate embed iframe based on `stream_kind`, and shows event metadata. A sidebar lists other currently-live events for quick switching.

Embed mapping:
- `youtube` → `https://www.youtube.com/embed/{stream_ref}?autoplay=1`
- `twitch` → `https://player.twitch.tv/?channel={stream_ref}&parent=localhost`
- `generic_iframe` → direct `stream_ref` URL
- `external_link` → "Open on source" button (no embed)

### 7. Launch Library 2 fetcher specifics

Endpoint: `https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=20&mode=detailed`

Maps LL2 fields:
- `id` → `sourceEventId`
- `name` → `title`
- `net` (No Earlier Than) → `startsAt`
- `window_end` → `endsAt`
- `status.abbrev` → mapped to `EventStatus` (`Go` → `scheduled`, `TBD` → `scheduled`, `Success` → `ended`, `Failure` → `ended`, `In Flight` → `live`)
- `vidURLs[0].url` → parsed for YouTube video ID → `streamRef`
- `image.image_url` → `thumbnailUrl`
- `pad.wiki_url` or LL2 launch page → `sourceUrl`
- `webcast_live` boolean → if true and status is `Go`, override to `live`

No API key required. Rate limit is generous (15 req/min). The `min_interval_minutes: 60` in the seed is sufficient.

## Risks / Trade-offs

- **LL2 `vidURLs` may be empty for future launches** → Show event card without a playable stream; player view shows "Stream not yet available" message instead of an iframe. This is expected — most launches don't have stream URLs until hours before.

- **YouTube video IDs in `vidURLs` may point to pre-launch placeholder streams** → Accept this; the ID is stable, YouTube just shows "waiting" until the stream starts.

- **`better-sqlite3` is synchronous and blocks the Node event loop** → Acceptable for a personal tool. Queries are fast (sub-ms on this data volume). The orchestrator runs sequentially anyway.

- **No error retry in orchestrator** → If a fetcher fails, the error is logged to `sources.last_error` and the orchestrator moves on. Next cron run retries naturally. No exponential backoff needed at this scale.

- **Home page shows stale data until next page load** → No real-time updates. The user refreshes the page. Acceptable for v1. Could add `revalidate` tag later if desired.
