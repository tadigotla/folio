## Context

The app has ~400 YouTube-embeddable events across 6 categories from curated channels. Currently the only way to find videos is scrolling the timeline. There's no discovery mechanism, no watch history, and no way to add channels without editing seed files. The `picks` table exists but is designed for conflict resolution, not watch history.

## Goals / Non-Goals

**Goals:**
- Add serendipitous video discovery via "I Feel Lucky" random selection
- Track watched videos so the random pool shrinks over time
- Let users add YouTube channels through the web UI
- Keep everything consistent with the existing patterns (server components, SQLite, minimal client state)

**Non-Goals:**
- Recommendation engine or algorithmic suggestions
- Rating or favoriting system
- YouTube API integration for channel discovery (user pastes URLs manually)
- Import/export of channel lists
- Watch progress tracking (partial views)

## Decisions

### 1. New `watched` table, not reusing `picks`

The `picks` table is for "I chose event A over event B in a timeslot" — conflict resolution. Watched history is different semantics: "I have seen this video." New table keeps concerns clean.

Schema:
```sql
CREATE TABLE watched (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  watched_at TEXT NOT NULL,
  UNIQUE(event_id)
);
```

The UNIQUE constraint on `event_id` means watching the same video twice just updates the timestamp (or is a no-op). Simple.

### 2. Lucky pick via API route, not server component

The random selection needs to happen on-demand when the user clicks a button. This is a client-initiated action that redirects — not a page render. Use a `GET /api/lucky` route that:

1. Queries `SELECT id FROM events WHERE stream_kind = 'youtube' AND id NOT IN (SELECT event_id FROM watched) ORDER BY RANDOM() LIMIT 1`
2. Accepts an optional `?category=` query param to scope the pool
3. Returns `{ id: "..." }` or `{ exhausted: true }` if no unwatched videos remain
4. The client redirects to `/watch/[id]` on success

**Why not a server action:** The button is on the home page (server component), but the action is interactive and needs to redirect. A simple fetch + redirect from a client component wrapping the button is the cleanest approach.

### 3. "Mark as watched" as a POST API route

`POST /api/watched` with `{ eventId: "..." }` body. The player view adds a button that calls this. Once marked, the button changes to "Watched" (disabled state). The player view checks if the current event is already in the `watched` table on load.

### 4. Channel management via sources table

User-added channels go into the existing `sources` table as new rows with `kind = 'youtube_channel'`. The source ID is derived from the category: e.g., `youtube_culture_user` for user-added culture channels. The config stores the same `{ channels: [...], rss_base: "..." }` format the YouTube fetcher already expects.

**Approach:** Rather than creating separate source rows per user-added channel, group them into one source per category (`youtube_{category}_user`). The add-channel form appends to the config's channel array. This keeps the fetcher pattern identical — no code changes to the fetcher itself.

**Channel URL parsing:** Accept YouTube channel URLs in these formats:
- `https://www.youtube.com/@handle`
- `https://www.youtube.com/channel/UCxxxxxx`
- Raw channel ID `UCxxxxxx`

For `@handle` URLs, we need to resolve the channel ID. A simple approach: fetch the channel page and extract the channel ID from the HTML meta tags, or try the RSS feed at `https://www.youtube.com/feeds/videos.xml?channel_id=` to validate.

### 5. History page as a simple server component

`/history` renders all `watched` entries joined with `events`, sorted by `watched_at DESC`. Each entry shows the event card plus the watched date. A "Clear all" button and per-entry "Remove" buttons call `DELETE /api/watched` endpoints.

### 6. Lucky button respects active category filter

The home page already has category filter chips using URL search params (`?category=space`). The lucky button reads the current `searchParams` and passes the category to `/api/lucky?category=...`. No filter = all categories.

## Risks / Trade-offs

- **Channel ID resolution from @handle URLs** → May fail if YouTube changes HTML structure. Fallback: ask the user to paste the channel ID directly. Show a help message explaining how to find it.

- **Random pool is limited to RSS feed entries (~15 per channel)** → The pool will grow over time as fetchers run repeatedly. Initially sparse but improves. Could increase fetcher frequency or cache more entries later.

- **`ORDER BY RANDOM()` performance** → Fine for hundreds of rows. Would be a problem at millions, but this is a personal tool.

- **User-added channels may have invalid IDs** → Validate by fetching the RSS feed on add. If it returns 404, reject with an error message.
