## 1. Pre-flight

- [x] 1.1 Back up `events.db` to `events.db.pre-pivot.bak` and confirm row counts for `events`, `watched`, and `sources`
- [x] 1.2 Add a `backup-db` verb to `justfile` that copies `events.db` to a timestamped file
- [x] 1.3 Update `RUNBOOK.md`: add pre-migration backup step, bump `Last verified`, document the new 30-min cadence

## 2. Schema migrations

- [x] 2.1 Write `db/migrations/003_videos_schema.sql`: create `videos`, `channels`, `consumption`, `highlights` stub, `oauth_tokens` stub with columns per the `video-library` spec
- [x] 2.2 Add indexes: `consumption(status, status_changed_at DESC)`, `videos(channel_id)`, `videos(is_live_now)` partial where `is_live_now = 1`
- [x] 2.3 Write `db/migrations/004_backfill_from_events.sql`: copy YouTube-sourced `events` rows into `videos` (strip `${sourceId}:` prefix from id, deduplicate by most recent `updated_at`), seed `channels` from distinct channel IDs found in `events.raw`, create `consumption` rows with `status = 'inbox'` for each migrated video, then migrate `watched` rows to `consumption.status = 'archived'` (overriding the `inbox` default)
- [x] 2.4 Write `db/migrations/005_drop_events.sql`: delete non-YT rows from `sources` (`launch_library_2`, `cspan_rss`, `thesportsdb`, `nasa_ical`, `explore_org`), drop `events`, `picks`, `watched`
- [x] 2.5 Run `npm run fetch` (which calls `runMigrations()`) against the backed-up DB and verify counts: `videos` ≈ pre-pivot YT `events`, `consumption` 1:1 with `videos`, archived count = pre-pivot `watched` count

## 3. Types and data layer

- [x] 3.1 Rewrite `src/lib/types.ts`: remove `Category`, `EventStatus`, `StreamKind` (collapse to constant `'youtube'` only), `Event`, `NormalizedEvent`, `Pick`; add `Video`, `Channel`, `Consumption`, `ConsumptionStatus` union, `NormalizedVideo`, updated `Fetcher` interface
- [x] 3.2 Create `src/lib/consumption.ts` with `setConsumptionStatus(videoId, nextStatus)` enforcing the legal transition matrix from the `video-library` spec; throw on illegal transitions
- [x] 3.3 Create small helpers in the same file: `getInboxVideos()`, `getLibraryVideos()` (saved + in_progress + archived, grouped), `getArchivedVideos()`, `getVideoById(id)`, `getLiveNowVideos()`

## 4. Ingestion

- [x] 4.1 Update `src/fetchers/youtube-channel.ts`: change return type to `NormalizedVideo[]`, parse `<yt:channelId>` from feed entries, emit `channelName` from the feed `<title>`, default `isLiveNow = false`
- [x] 4.2 Delete `src/fetchers/launch-library.ts`, `src/fetchers/cspan-rss.ts`, `src/fetchers/sportsdb.ts`, `src/fetchers/nasa-ical.ts`, `src/fetchers/explore-org.ts`
- [x] 4.3 Update `src/fetchers/registry.ts`: drop deleted fetchers, keep only YouTube channel fetchers (static + dynamic user-added); leave the dynamic `createYouTubeChannelFetcher` path intact
- [x] 4.4 Update `src/fetchers/orchestrator.ts`: upsert into `videos` keyed on YouTube video ID, auto-insert `channels` rows for unseen channel IDs, auto-create `consumption` rows with `status = 'inbox'` for new videos, remove the 48h stale-event sweep, keep the per-source error isolation and `last_fetched_at` update
- [x] 4.5 Remove dependencies from `package.json` that only those fetchers used (`node-ical`, `cheerio` — verify via grep before removing); run `npm install`
- [x] 4.6 Update `min_interval_minutes` on remaining YouTube sources to 30 via a one-off UPDATE inside `db/seed-sources.ts`

## 5. Web UI — home

- [x] 5.1 Rewrite `src/app/page.tsx` as a navigation hub: tiles for Inbox / Library / Archive with counts from `consumption.status` aggregates, plus a compact Live Now strip populated from `videos WHERE is_live_now = 1`
- [x] 5.2 Delete `src/components/CategoryFilter.tsx`, `src/components/LuckyButton.tsx`, `src/components/EventCard.tsx`
- [x] 5.3 Create `src/components/VideoCard.tsx` taking a `Video` plus optional action slot; used by inbox and library

## 6. Web UI — inbox

- [x] 6.1 Create `src/app/inbox/page.tsx`: RSC that SELECTs `videos` joined `consumption` where `status = 'inbox'` ordered by `discovered_at DESC`, renders `VideoCard`s with Save + Dismiss controls
- [x] 6.2 Create `src/app/api/consumption/route.ts` POST handler taking `{ videoId, next }`, calling `setConsumptionStatus`; returns 204 on success, 422 on illegal transition
- [x] 6.3 Create a small `src/components/ConsumptionAction.tsx` client component wrapping the POST + optimistic removal-from-list

## 7. Web UI — library

- [x] 7.1 Create `src/app/library/page.tsx`: RSC rendering three sections (Saved, In Progress, Archived). Use anchor ids so `/library#archived` scrolls to the archived section
- [x] 7.2 Each card gets the status-appropriate action: Saved → Archive, Archived → Re-open, In Progress → (no-op in this change since section is empty)
- [x] 7.3 Empty-state copy per section per the `library-view` spec; "In Progress" reads "Activated in the next release" (or similar)

## 8. Web UI — player

- [x] 8.1 Rewrite `src/app/watch/[id]/page.tsx` to read from `videos`; iframe src uses the raw `id` column (which is the YouTube video ID); remove the Twitch / nasa / explore-org / generic-iframe / external-link branches
- [x] 8.2 Render title, description, channel name, duration formatted via new helper, `published_at` formatted via `toLocal` from `src/lib/time.ts`, LIVE badge when `is_live_now = 1`
- [x] 8.3 Delete the "Other live events" sidebar component / logic
- [x] 8.4 404-equivalent branch: show "Video not found" with link to `/`

## 9. Cleanup

- [x] 9.1 Remove `src/app/channels/`, `src/app/history/` if their existing content depends on the removed concepts; evaluate and either delete or leave a thin stub
- [x] 9.2 Delete `src/components/WatchedButton.tsx` (its role is now covered by `ConsumptionAction`)
- [x] 9.3 Grep for references to `events`, `Category`, `stream_kind`, `status = 'live'|'scheduled'|'ended'|'always_on'`, `picks`, `watched` across `src/` and remove or update each hit
- [x] 9.4 Run `npm run lint` and fix any new warnings/errors

## 10. Verify end-to-end

- [x] 10.1 `npm run dev` on port 6060; navigate to `/`, `/inbox`, `/library`, `/watch/<an-id>`; each renders without console errors
- [x] 10.2 `npm run fetch` and confirm new RSS entries arrive as `videos` with `consumption.status = 'inbox'`; existing rows are not duplicated
- [x] 10.3 Exercise Save, Dismiss, Archive, Re-open on real rows and confirm rows move between Inbox/Library sections as expected; confirm illegal transitions via direct API call return 422
- [x] 10.4 `npm run build` succeeds

## 11. Docs / operational invariant

- [x] 11.1 Update `RUNBOOK.md`: services section (no non-YT sources), cron cadence (30 min), add backup step reference, update `Last verified` date
- [x] 11.2 Update `justfile` if any verbs change shape (e.g. `backup-db` added; `status`/`logs` unaffected)
- [x] 11.3 Update `CLAUDE.md`: change the "Architecture" narrative from events → videos, remove references to the removed fetchers and the stale-event sweep, mention the new `consumption` lifecycle
