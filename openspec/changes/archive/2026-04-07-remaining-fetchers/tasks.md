## 1. YouTube Channel Fetcher

- [x] 1.1 Create `src/fetchers/youtube-channel.ts` — fetch RSS feeds for all channels in `source.config.channels` using the `rss_base` URL template, parse Atom XML entries, extract video IDs, map to `NormalizedEvent` with `stream_kind: 'youtube'`, handle per-channel failures gracefully

## 2. C-SPAN RSS Fetcher

- [x] 2.1 Create `src/fetchers/cspan-rss.ts` — fetch and parse the C-SPAN RSS feed, map each `<item>` to a `NormalizedEvent` with `stream_kind: 'external_link'`, extract timing from `pubDate`

## 3. TheSportsDB Fetcher

- [x] 3.1 Create `src/fetchers/sportsdb.ts` — fetch fixtures for today + next 6 days via `eventsday.php`, map each fixture to a `NormalizedEvent` with `stream_kind: 'external_link'`, include league info in description, use `strThumb` for thumbnails, skip empty days

## 4. NASA iCal Fetcher

- [x] 4.1 Create `src/fetchers/nasa-ical.ts` — fetch and parse the NASA iCal feed with `node-ical`, map VEVENTs to `NormalizedEvent`, extract YouTube links from descriptions when present, limit to events within the next 30 days, use VEVENT UID as `sourceEventId`

## 5. Explore.org Scraper

- [x] 5.1 Create `src/fetchers/explore-org.ts` — fetch the livecams HTML page, parse with cheerio, extract camera entries with names/thumbnails/URLs, set `status: 'always_on'` and `starts_at: null`, use `generic_iframe` or `external_link` for stream kind, derive stable slugs for `sourceEventId`

## 6. Registry Update

- [x] 6.1 Update `src/fetchers/registry.ts` — add all 5 new fetchers to the registry map, mapping `youtube_culture` and `youtube_philosophy` to the shared YouTube channel fetcher

## 7. Verification

- [x] 7.1 Run `npm run fetch` and verify events appear across all categories — confirm each fetcher produces events (or logs clear errors for sources with feed issues), re-run to confirm idempotency
