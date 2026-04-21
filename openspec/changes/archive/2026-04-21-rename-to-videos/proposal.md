## Why

This project started as a live-events aggregator (time-boxed streams, "what's on now?"). In practice, the highest-value content is on-demand YouTube material — videos you want to discover, triage, consume incrementally, capture highlights from, and revisit later. The current `events`-centric schema (status=scheduled/live/ended, stale sweep, conflict picks) models the wrong thing for that usage.

This change re-foundations the app as a YouTube-primary video library. It is the prerequisite for three follow-on changes — `oauth-youtube-import`, `incremental-consumption`, and `spaced-review` — which each assume a `videos` table, a `consumption` lifecycle, and a channel registry in place of the current `events`/`sources` pair.

## What Changes

- **BREAKING** Rename `events` → `videos`. New columns: `duration_seconds`, `channel_id`, `published_at`, `is_live_now`, `scheduled_start`, `discovered_at`. Removed columns: `starts_at`, `ends_at`, `status` (the old scheduled/live/ended lifecycle), `category`.
- **BREAKING** New `channels` table (id, name, handle, subscribed). Channel identity is first-class; previously it was buried in `sources.config`.
- **BREAKING** New `consumption` table keyed by `video_id`, holding the lifecycle (`inbox | saved | in_progress | archived | dismissed`) and a `last_viewed_at` timestamp. Replaces the existing boolean `watched` table.
- **BREAKING** Stub-only `highlights` and `oauth_tokens` tables (schema created, not yet used; populated by later changes).
- **BREAKING** Drop non-YouTube fetchers and their sources: Launch Library 2, C-SPAN, TheSportsDB, NASA iCal, Explore.org. Delete the `cspan_rss`, `thesportsdb`, `nasa_ical`, `launch_library_2`, `explore_org` rows from `sources`.
- **BREAKING** Simplify `StreamKind` to `youtube` only. Remove `twitch`, `nasa`, `explore_org`, `generic_iframe`, `external_link`.
- **BREAKING** Remove the `picks` table (conflict-resolution primitive that doesn't apply to on-demand videos) and the Lucky Pick capability it supports.
- **BREAKING** Remove `Category` enum and category filtering. Category-based browsing is replaced by channel-based browsing; categories will return later as user-defined tags (out of scope here).
- **BREAKING** Remove the stale-event sweep (events → ended after 48h). Videos don't expire; instead `is_live_now` is re-computed per-fetch.
- Home view becomes an entry point to three surfaces: Inbox (triage), Library (saved + in-progress), Archive (completed). No keyboard triage or SR review yet — those ship in later changes.
- Keep existing YouTube RSS ingestion working. Poll cadence relaxes from 5 min to 30 min (videos are not live-critical).
- Player view continues to use the plain iframe embed. The IFrame Player API upgrade happens in `incremental-consumption`.

## Capabilities

### New Capabilities
- `video-library`: Core data model for the pivoted app — videos, channels, and the consumption lifecycle (inbox/saved/in_progress/archived/dismissed). Defines the schema and the legal status transitions.
- `inbox-view`: Surface listing videos with `consumption.status = 'inbox'` with per-video actions to save or dismiss. Keyboard-driven triage is out of scope here; click-to-act is sufficient.
- `library-view`: Surfaces listing videos in `saved`, `in_progress`, and `archived` states, each as its own filtered list.

### Modified Capabilities
- `data-ingestion`: Upsert target changes from `events` to `videos`. Composite key changes from `${sourceId}:${sourceEventId}` to the YouTube video ID directly. Stale-event sweep is removed. Non-YouTube fetcher requirements are removed.
- `home-view`: Existing "Live Now strip" and "Next Up timeline" requirements are removed. Category filter chips are removed. Replaced by navigation tiles/links into Inbox, Library, and Archive.
- `player-view`: Reads from `videos` (not `events`). Twitch, generic-iframe, NASA, Explore.org, and external-link branches are removed — only YouTube iframe embed remains. "Other live events sidebar" is removed (live is a facet now, not a population worth sidebar-ing).
- `youtube-channel-fetcher`: Emits video-shaped records (video_id, channel_id, duration, published_at) rather than event-shaped ones. Status field dropped in favor of `is_live_now`. No behavior change to the RSS parsing itself.
- `cspan-fetcher`: Removed entirely.
- `nasa-ical-fetcher`: Removed entirely.
- `sportsdb-fetcher`: Removed entirely.
- `explore-org-fetcher`: Removed entirely.

## Impact

- **Code:** `src/lib/types.ts` rewrite; `src/lib/db.ts` migration plumbing unchanged but several new migrations applied; `src/fetchers/` loses four modules and the registry shrinks; `src/fetchers/youtube-channel.ts` emits new shape; `src/app/page.tsx` restructured; `src/app/watch/[id]/` simplified to YouTube-only; new routes `src/app/inbox/`, `src/app/library/`, `src/app/archive/`; `src/components/CategoryFilter.tsx`, `src/components/LuckyButton.tsx` deleted; `src/components/WatchedButton.tsx` repurposed into inbox/library actions.
- **Database:** One-shot migration. Existing YouTube `events` rows are copied into `videos` (with best-effort metadata backfill — duration and published_at may be null until next fetch re-populates them). Non-YouTube `events` rows are dropped. Existing `watched` rows migrate to `consumption` with `status = 'archived'`. `picks`, `sources.*` non-YT rows, and `events` table are dropped after copy.
- **Specs:** 3 new specs, 4 modified, 4 removed. Specs from the completed `lucky-pick` change (`lucky-pick`, `watched-history`, `channel-management`) are superseded by this change's removals/replacements.
- **Operational:** `RUNBOOK.md` needs update to drop references to non-YT sources, remove the 5-min cron cadence, document 30-min default. `justfile` verbs (`dev`/`down`/`status`/`logs`/`test`) unchanged.
- **Out of scope (deferred):** OAuth imports, IFrame Player API, highlights capture, SR review, tags/collections, keyboard triage, highlights export.
