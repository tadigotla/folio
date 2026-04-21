## Why

The app currently only ingests space launches from Launch Library 2 — one source, one category. The remaining 5 Phase 1 fetchers need to be built so all 6 categories (space, nature, sports, news, culture, philosophy) have data. This directly follows the build plan step 8 and is the prerequisite for the schedule view and conflict cards to be meaningful.

## What Changes

- **YouTube channel fetcher** — parses YouTube RSS feeds for the culture and philosophy source entries (12 channels total). Detects upcoming/live streams from feed entries. Shared implementation used by both `youtube_culture` and `youtube_philosophy` sources.
- **C-SPAN RSS fetcher** — parses the C-SPAN RSS feed for daily programming schedule, normalizes entries into events.
- **TheSportsDB fetcher** — calls the free-tier API for upcoming fixtures across major leagues, maps to events. No stream links (sports streams require login), so uses `external_link` stream kind.
- **NASA iCal fetcher** — parses NASA's public iCal feed for non-launch events (spacewalks, press briefings, live coverage).
- **Explore.org scraper** — scrapes the livecams page for ambient camera streams, stores them as `always_on` events in the events table.
- **Registry update** — all 5 fetchers registered in the fetcher registry so the orchestrator picks them up.

## Capabilities

### New Capabilities
- `youtube-channel-fetcher`: YouTube RSS-based fetcher for detecting upcoming/live streams from channel feeds
- `cspan-fetcher`: C-SPAN RSS feed parser for news/civic programming
- `sportsdb-fetcher`: TheSportsDB API client for upcoming sports fixtures
- `nasa-ical-fetcher`: NASA iCal feed parser for space events beyond launches
- `explore-org-fetcher`: Explore.org livecam page scraper for always-on nature streams

### Modified Capabilities

_None — the existing data-ingestion orchestrator and UI handle new sources automatically._

## Impact

- **New files**: 5 fetcher modules in `src/fetchers/`
- **Modified files**: `src/fetchers/registry.ts` (add 5 new entries)
- **Dependencies**: `cheerio` and `node-ical` are already installed
- **Database**: events table will receive data across all 6 categories; no schema changes
- **External APIs**: YouTube RSS (free, no key), C-SPAN RSS (free), TheSportsDB free tier (no key), NASA iCal (free), Explore.org HTML (scrape)
