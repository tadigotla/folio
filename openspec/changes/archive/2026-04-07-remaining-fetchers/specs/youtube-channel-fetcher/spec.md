## ADDED Requirements

### Requirement: YouTube RSS feed parsing
The YouTube channel fetcher SHALL fetch the RSS feed for each channel listed in the source's `config.channels` array using the URL template `{config.rss_base}{channel.id}`.

#### Scenario: Successful fetch of channel feed
- **WHEN** the fetcher processes a source with 3 channels in its config
- **THEN** it SHALL fetch 3 RSS feeds and return a combined array of `NormalizedEvent` objects from all feeds

### Requirement: Video entry normalization
Each RSS feed entry SHALL be mapped to a `NormalizedEvent` with `stream_kind: 'youtube'` and the YouTube video ID extracted from the feed entry as `stream_ref`.

#### Scenario: Standard video entry
- **WHEN** an RSS entry contains a video ID, title, and published date
- **THEN** the fetcher SHALL produce a `NormalizedEvent` with `sourceEventId` set to the video ID, `title` from the entry title, `startsAt` from the published date, `streamKind` as `youtube`, and `streamRef` as the video ID

### Requirement: Source URL construction
Each event's `sourceUrl` SHALL point to the YouTube watch page for that video.

#### Scenario: Source URL format
- **WHEN** a video has ID `dQw4w9WgXcQ`
- **THEN** the `sourceUrl` SHALL be `https://www.youtube.com/watch?v=dQw4w9WgXcQ`

### Requirement: Shared implementation across sources
The same fetcher code SHALL be used for both `youtube_culture` and `youtube_philosophy` source IDs, differentiated only by the channel list in their config.

#### Scenario: Culture source uses culture channels
- **WHEN** the orchestrator runs the fetcher for `youtube_culture`
- **THEN** it SHALL fetch feeds for the channels listed in the `youtube_culture` source config (NPR Tiny Desk, KEXP)

#### Scenario: Philosophy source uses philosophy channels
- **WHEN** the orchestrator runs the fetcher for `youtube_philosophy`
- **THEN** it SHALL fetch feeds for the channels listed in the `youtube_philosophy` source config (10 philosophy channels)

### Requirement: Graceful per-channel failure
If one channel's RSS feed fails to load, the fetcher SHALL skip that channel and continue with the remaining channels.

#### Scenario: One channel feed fails
- **WHEN** 1 of 3 channel feeds returns an HTTP error
- **THEN** the fetcher SHALL log the failure, skip that channel, and return events from the other 2 channels
