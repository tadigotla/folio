## Why

The app aggregates hundreds of YouTube videos from curated channels, but there's no way to discover them serendipitously. You scroll the timeline or ignore them. An "I Feel Lucky" button turns the back-catalog into a personal radio station — pick a random unwatched video, track what you've seen, and let the pool refresh as new videos arrive. The user also wants to add YouTube channels on the fly without editing seed files.

## What Changes

- **"I Feel Lucky" button** on the home page — picks a random YouTube-embeddable event the user hasn't watched yet, respecting the active category filter. Navigates to `/watch/[id]`.
- **Watched tracking** — new `watched` table to record which events the user has seen. "Mark as watched" button on the player view. Random picker excludes watched events.
- **Watched history page** — `/history` route showing all watched videos in reverse chronological order, with the ability to clear individual entries or the entire history.
- **My Channels page** — `/channels` route with a form to add YouTube channels (paste URL or channel ID, pick a category). Channels are stored in the `sources` table and picked up by the existing YouTube channel fetcher on the next run. List of current channels with ability to remove them.
- **Pool exhaustion handling** — when all YouTube events in a category have been watched, the lucky button shows a message with an option to clear watched history for that category.

## Capabilities

### New Capabilities
- `lucky-pick`: Random video selection from unwatched YouTube events, category-aware, with pool exhaustion handling
- `watched-history`: Watched event tracking, history page, clear/reset functionality
- `channel-management`: Add/remove YouTube channels via a web UI, stored as sources

### Modified Capabilities
- `home-view`: Adding the "I Feel Lucky" button to the home page
- `player-view`: Adding "Mark as watched" button to the player view

## Impact

- **New files**: `/channels` page + components, `/history` page + components, API routes for lucky-pick, watched CRUD, and channel CRUD
- **Modified files**: home page (lucky button), player view (watched button)
- **Database**: new `watched` table; new rows in `sources` table for user-added channels
- **New migration**: `002_watched.sql`
