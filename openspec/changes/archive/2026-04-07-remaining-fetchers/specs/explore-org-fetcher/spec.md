## ADDED Requirements

### Requirement: Livecam page scraping
The Explore.org fetcher SHALL fetch the HTML page at `source.config.url` and extract live camera entries using cheerio.

#### Scenario: Successful page scrape
- **WHEN** the Explore.org livecams page returns valid HTML with camera listings
- **THEN** each camera SHALL be mapped to a `NormalizedEvent`

### Requirement: Always-on event status
All Explore.org camera events SHALL have `status: 'always_on'` and `starts_at: null` since they are ambient, not scheduled.

#### Scenario: Camera normalized as always-on
- **WHEN** a camera entry is extracted
- **THEN** the `NormalizedEvent` SHALL have `status` set to `always_on` and `startsAt` set to undefined

### Requirement: Stream reference extraction
The fetcher SHALL extract the camera's embed URL or page URL. Cameras with detectable iframe embed URLs SHALL use `stream_kind: 'generic_iframe'`. Others SHALL use `stream_kind: 'external_link'`.

#### Scenario: Camera with embed URL
- **WHEN** a camera entry has a detectable iframe embed URL
- **THEN** `streamKind` SHALL be `generic_iframe` and `streamRef` SHALL be the embed URL

#### Scenario: Camera with page link only
- **WHEN** a camera entry only has a page link
- **THEN** `streamKind` SHALL be `external_link` and `streamRef` SHALL be the page URL

### Requirement: Thumbnail extraction
If a camera listing includes a thumbnail image, it SHALL be used as `thumbnailUrl`.

#### Scenario: Camera with thumbnail
- **WHEN** a camera listing has an image element
- **THEN** `thumbnailUrl` SHALL be set to the image source URL

### Requirement: Stable source event ID from camera name
Each camera SHALL use a slug derived from the camera name or URL as `sourceEventId` for idempotent upserts.

#### Scenario: Camera identification
- **WHEN** a camera is named "Brown Bear Salmon Cam - Brooks Falls"
- **THEN** `sourceEventId` SHALL be a deterministic slug derived from that identifier
