## 1. Launch Library 2 Fetcher

- [x] 1.1 Create `src/fetchers/launch-library.ts` — implement the LL2 fetcher that calls the upcoming launches endpoint, maps LL2 fields to `NormalizedEvent` (id, name, net, status, vidURLs, image, webcast_live), extracts YouTube video IDs from vidURLs, and handles launches with no video URLs by falling back to `external_link`
- [x] 1.2 Create `src/fetchers/registry.ts` — static map of `sourceId → Fetcher` starting with `launch_library_2`

## 2. Orchestrator

- [x] 2.1 Create `src/fetchers/orchestrator.ts` — load enabled sources from DB, check `last_fetched_at` against `min_interval_minutes`, run each due fetcher from the registry, upsert results with `INSERT ... ON CONFLICT(id) DO UPDATE`, update `last_fetched_at` and `last_error` on each source, and run the stale-event sweep (scheduled events > 6h past → ended)
- [x] 2.2 Create `scripts/run-fetchers.ts` — entry point that calls `runMigrations()` then runs the orchestrator, suitable for `npm run fetch` or system cron

## 3. Verify Data Pipeline

- [x] 3.1 Run `npm run fetch` and verify events appear in the database — check that LL2 launches are inserted with correct fields, re-running produces no duplicates, and `sources.last_fetched_at` is updated

## 4. Home Page

- [x] 4.1 Create `src/components/EventCard.tsx` — card component showing thumbnail (or category placeholder), title, category badge, relative time, and linking to `/watch/[id]`
- [x] 4.2 Create `src/components/CategoryFilter.tsx` — client component with filter chips for the 6 categories, using URL search params to persist state
- [x] 4.3 Rewrite `src/app/page.tsx` — server component that queries SQLite for live events and next-6-hours events, renders "Live Now" strip (hidden when empty), hour-by-hour "Next Up" timeline (collapsing empty hours), and category filter

## 5. Player View

- [x] 5.1 Create `src/components/Player.tsx` — iframe embed component that maps `stream_kind` to the correct embed URL (YouTube, Twitch, generic_iframe) or renders an "Open on source" button for `external_link`, with a "Stream not yet available" fallback
- [x] 5.2 Create `src/app/watch/[id]/page.tsx` — server component that loads the event by ID, renders Player + event metadata (title, description, category, status badge, local time), a sidebar of other live events, and a 404 message for invalid IDs
