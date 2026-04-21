## REMOVED Requirements

### Requirement: Livecam page scraping
**Reason**: Explore.org fetcher is being dropped as part of the pivot to a YouTube-primary content library. Explore.org's livecams are not YouTube-hosted.
**Migration**: Delete `src/fetchers/explore-org.ts`, remove the `explore_org` row from `sources` via migration, remove the `cheerio` dependency if no other code uses it, and remove the registry entry.

### Requirement: Always-on event status
**Reason**: Explore.org fetcher removed; the `always_on` status and `status` column itself are removed in this change.
**Migration**: No replacement.

### Requirement: Stream reference extraction
**Reason**: Explore.org fetcher removed; `generic_iframe` and `external_link` stream kinds are also removed.
**Migration**: No replacement.

### Requirement: Thumbnail extraction
**Reason**: Explore.org fetcher removed.
**Migration**: No replacement.

### Requirement: Stable source event ID from camera name
**Reason**: Explore.org fetcher removed.
**Migration**: No replacement.
