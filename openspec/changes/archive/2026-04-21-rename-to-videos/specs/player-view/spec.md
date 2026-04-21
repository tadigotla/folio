## MODIFIED Requirements

### Requirement: Embedded stream player
The player view at `/watch/[id]` SHALL embed the video using a YouTube iframe. All videos are YouTube videos in this change.

#### Scenario: YouTube video
- **WHEN** the route is hit with a `[id]` that exists in the `videos` table
- **THEN** the page SHALL render an iframe with `src="https://www.youtube.com/embed/{id}?autoplay=1"` filling the main content area

### Requirement: Video metadata display
The player view SHALL display video metadata alongside the stream.

#### Scenario: Full metadata available
- **WHEN** the video has title, description, channel name, duration, and published_at
- **THEN** the page SHALL display all fields; `published_at` formatted in America/New_York timezone, `duration` formatted as `H:MM:SS` or `M:SS`, and an "LIVE" badge if `is_live_now = 1`

### Requirement: Video not found handling
The player view SHALL handle missing or invalid video IDs gracefully.

#### Scenario: Invalid video ID
- **WHEN** the user navigates to `/watch/[id]` with an ID that does not exist in the `videos` table
- **THEN** the page SHALL display a "Video not found" message with a link back to the home page

## REMOVED Requirements

### Requirement: Other live events sidebar
**Reason**: Live is now a facet of a video rather than a lifecycle state populating a dedicated list. A sidebar of "other live things" no longer matches the product shape, which is now a personal library not a live-TV-style channel surfer.
**Migration**: Delete the sidebar from `src/app/watch/[id]/page.tsx`. A later change may add a contextual "related from this channel" surface, but that is out of scope here.

### Requirement: Stream not yet available
**Reason**: With the stream-kind space narrowed to `youtube` only, a YouTube embed can always be rendered — there is no "not yet available" branch that is distinguishable from a normal embed.
**Migration**: Delete the empty-stream fallback branch. If the iframe fails to load for a given ID, that is a YouTube-side concern, not an app state.
