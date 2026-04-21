## Context

The data ingestion pipeline is working: orchestrator loads sources, runs fetchers, upserts events idempotently. One fetcher (Launch Library 2) is implemented and producing 20 space launch events. Five more sources are seeded in the DB but have no fetcher code. The `Fetcher` interface, registry pattern, and `NormalizedEvent` type are established.

Source configs in the seed define per-source URLs and channel lists. The YouTube sources store an array of `{ id, name }` channel objects plus an `rss_base` URL template.

## Goals / Non-Goals

**Goals:**
- Implement 5 fetchers so all 6 categories have data
- Follow the established pattern (same interface, same registry, same upsert flow)
- Use free, no-auth data sources wherever possible (RSS, public APIs, scraping)

**Non-Goals:**
- YouTube Data API v3 integration (RSS-first per prior decision)
- Phase 2 sources (Twitch, chess, etc.)
- Fetcher-specific polling cadence logic (orchestrator already handles `min_interval_minutes`)
- Stream link detection for sports (most sports streams require login — use `external_link`)

## Decisions

### 1. YouTube channel fetcher: RSS feeds, not Data API

Each YouTube channel has a public RSS feed at `https://www.youtube.com/feeds/videos.xml?channel_id={id}`. The feed contains recent uploads and sometimes scheduled/live streams. Parse with native XML (DOMParser or a lightweight approach using string matching on the Atom XML).

The fetcher iterates over all channels in the source config, fetches each RSS feed, and extracts video entries. Each entry becomes a `NormalizedEvent` with `stream_kind: 'youtube'` and the video ID as `stream_ref`.

**Status detection:** YouTube RSS feeds don't explicitly indicate live/upcoming status. All entries are treated as `scheduled`. The title or metadata may hint at live status but reliably detecting it from RSS alone is limited. This is acceptable — the orchestrator's stale sweep handles cleanup, and a future enhancement could ping the oEmbed endpoint for live status.

**Why not Data API:** Avoids quota concerns (10k units/day, 100 per search.list call). RSS is free and unlimited. Tradeoff: less metadata, no reliable live detection.

### 2. C-SPAN RSS: standard RSS parsing

C-SPAN publishes an RSS feed. Parse with a simple XML approach similar to YouTube RSS. Each `<item>` maps to a `NormalizedEvent`. C-SPAN entries rarely have direct stream embeds, so `stream_kind` will be `external_link` with the item link as `stream_ref`.

### 3. TheSportsDB: free-tier JSON API

The free tier at `thesportsdb.com/api/v1/json/` provides upcoming fixtures. The endpoint `eventsday.php?d=YYYY-MM-DD` returns events for a given day. Fetch today and the next 6 days to cover the schedule view window.

No stream links — sports broadcasts require paid subscriptions. All events use `stream_kind: 'external_link'`.

**Alternative considered:** scraping ESPN. Rejected — more fragile, legally riskier, and TheSportsDB's structured API is simpler.

### 4. NASA iCal: node-ical parsing

`node-ical` (already installed) parses the NASA iCal feed. Each `VEVENT` maps to a `NormalizedEvent`. The `SUMMARY` becomes the title, `DTSTART`/`DTEND` become `startsAt`/`endsAt`. Description may contain a YouTube link — extract it if present, otherwise use `external_link`.

**Recurrence rules:** `node-ical` expands `RRULE` entries. Limit to events within the next 30 days to avoid unbounded expansion.

### 5. Explore.org scraper: cheerio HTML parsing

`cheerio` (already installed) parses the Explore.org livecams page. Each cam entry becomes a `NormalizedEvent` with `status: 'always_on'` and `starts_at: null`. The scraper extracts the cam name, thumbnail, and iframe embed URL.

`stream_kind` is `generic_iframe` for cams with detectable iframe URLs, or `external_link` for cams that link to a page instead.

### 6. One fetcher file per source type, shared YouTube implementation

- `youtube-channel.ts` — shared by `youtube_culture` and `youtube_philosophy` source IDs
- `cspan-rss.ts`
- `sportsdb.ts`
- `nasa-ical.ts`
- `explore-org.ts`

The YouTube fetcher reads `source.config.channels` and `source.config.rss_base` to know which channels to poll. The fetcher is the same code for both sources — just different config.

## Risks / Trade-offs

- **YouTube RSS may not show upcoming/live streams reliably** → Accept this limitation. Recent uploads will appear. Live detection can be added later via oEmbed. The philosophy/culture categories are naturally sparse per the proposal's pre-mortem.

- **C-SPAN RSS structure may change without notice** → RSS feeds are generally stable. If parsing breaks, the orchestrator logs the error and moves on.

- **TheSportsDB free tier rate limits** → Generous for personal use. Fetching 7 days × 1 call = 7 requests per run, well within limits.

- **Explore.org HTML structure may change** → Scraping is inherently fragile. The scraper should fail gracefully and log the error. Cam data is `always_on` and changes rarely, so even daily scraping is sufficient.

- **NASA iCal feed may be slow or large** → Limit event expansion to 30 days. `node-ical` handles this well.
