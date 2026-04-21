## ADDED Requirements

### Requirement: YouTube RSS feed parsing
The YouTube channel fetcher SHALL fetch the RSS feed for each channel listed in the source's `config.channels` array using the URL template `{config.rss_base}{channel.id}`.

#### Scenario: Successful fetch of channel feed
- **WHEN** the fetcher processes a source with 3 channels in its config
- **THEN** it SHALL fetch 3 RSS feeds and return a combined array of `NormalizedVideo` objects from all feeds

### Requirement: Video entry normalization
Each RSS feed entry SHALL be mapped to a `NormalizedVideo` with `videoId` from the feed entry's `<yt:videoId>`, `channelId` from `<yt:channelId>`, `channelName` from the feed `<title>`, `publishedAt` from `<published>`, and `isLiveNow` defaulting to `false` (RSS does not indicate live state).

#### Scenario: Standard video entry
- **WHEN** an RSS entry contains a video ID, title, channel ID, and published date
- **THEN** the fetcher SHALL produce a `NormalizedVideo` with `videoId` set to the YouTube video ID, `title` from the entry title, `publishedAt` from the published date, `channelId` from the channel ID, `channelName` from the feed title, and `isLiveNow = false`

### Requirement: Source URL construction
Each video's `sourceUrl` SHALL point to the YouTube watch page for that video.

#### Scenario: Source URL format
- **WHEN** a video has ID `dQw4w9WgXcQ`
- **THEN** the `sourceUrl` SHALL be `https://www.youtube.com/watch?v=dQw4w9WgXcQ`

### Requirement: Shared implementation across sources
The same fetcher code SHALL be used for every `youtube_channel`-kind source, differentiated only by the channel list in their config. The fetcher SHALL NOT be specialized per category — categories are removed from the data model.

#### Scenario: Multiple channel sources share code
- **WHEN** the orchestrator runs fetchers for two different YouTube channel sources
- **THEN** both SHALL be served by `createYouTubeChannelFetcher(sourceId)` with behavior differentiated only by each source's `config.channels`

### Requirement: Graceful per-channel failure
If one channel's RSS feed fails to load, the fetcher SHALL skip that channel and continue with the remaining channels.

#### Scenario: One channel feed fails
- **WHEN** 1 of 3 channel feeds returns an HTTP error
- **THEN** the fetcher SHALL log the failure, skip that channel, and return videos from the other 2 channels
