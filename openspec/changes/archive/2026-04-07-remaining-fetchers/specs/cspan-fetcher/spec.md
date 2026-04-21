## ADDED Requirements

### Requirement: C-SPAN RSS feed parsing
The C-SPAN fetcher SHALL fetch and parse the RSS feed at the URL from `source.config.url` and normalize each `<item>` into a `NormalizedEvent`.

#### Scenario: Successful RSS parse
- **WHEN** the C-SPAN RSS feed returns valid XML with program items
- **THEN** each item SHALL be mapped to a `NormalizedEvent` with `title` from the item title, `sourceUrl` from the item link, and `description` from the item description

### Requirement: Event timing extraction
The fetcher SHALL extract event timing from the RSS `pubDate` field and set it as `startsAt`.

#### Scenario: Item with pubDate
- **WHEN** an RSS item has a `pubDate` field
- **THEN** the `startsAt` SHALL be set to the parsed UTC ISO timestamp

### Requirement: Stream kind
All C-SPAN events SHALL use `stream_kind: 'external_link'` with the item link as `stream_ref`, since C-SPAN streams are best viewed on their own site.

#### Scenario: Event stream reference
- **WHEN** a C-SPAN RSS item is normalized
- **THEN** `streamKind` SHALL be `external_link` and `streamRef` SHALL be the item's link URL
