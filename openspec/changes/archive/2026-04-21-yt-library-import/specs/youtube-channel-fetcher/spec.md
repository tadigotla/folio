## REMOVED Requirements

### Requirement: YouTube RSS feed parsing
**Reason**: RSS is no longer the app's ingestion mechanism. The YouTube Data API (accessed with the user's OAuth token) replaces it.
**Migration**: `src/fetchers/youtube-channel.ts` is deleted. Channel upload fetching uses `playlistItems.list` against each channel's uploads playlist, as specified in `youtube-library-import`.

### Requirement: Video entry normalization
**Reason**: No RSS entries to normalize. API responses are decoded directly into the `videos` row shape by the import modules.
**Migration**: Normalization logic moves into `src/lib/youtube-import.ts` keyed on `snippet.resourceId.videoId` from `playlistItems` responses rather than `<yt:videoId>` from RSS.

### Requirement: Source URL construction
**Reason**: `sourceUrl` (`https://www.youtube.com/watch?v=<id>`) is still constructed the same way, but by the import module rather than the fetcher. Retaining the requirement under this (deleted) capability would create a dangling reference.
**Migration**: `videos.source_url` is still populated on insert; construction moves to `src/lib/youtube-import.ts`.

### Requirement: Shared implementation across sources
**Reason**: There are no sources. The notion of a `Fetcher` shared across multiple `youtube_channel`-kind source rows is gone.
**Migration**: None. The code path collapses into the subscription-import endpoint, which handles all channels uniformly.

### Requirement: Graceful per-channel failure
**Reason**: Per-channel failure isolation is preserved but restated in the context of subscription imports: if fetching one channel's uploads throws, the import continues with the next channel.
**Migration**: The subscription-import endpoint catches per-channel errors and records them in `import_log.error` with channel context. Implementation detail; not a distinct spec-level requirement.
