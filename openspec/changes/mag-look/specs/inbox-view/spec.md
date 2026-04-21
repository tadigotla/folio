## MODIFIED Requirements

### Requirement: Inbox route
The system SHALL expose a route at `/inbox` listing all videos whose `consumption.status = 'inbox'`, sorted by `videos.discovered_at` descending (newest first). The inbox SHALL be positioned as a *power-user escape hatch* — a raw firehose view of everything unread — and NOT the primary triage surface (the magazine issue at `/` is now the primary surface).

#### Scenario: Inbox contains videos
- **WHEN** the user navigates to `/inbox` and at least one video has `consumption.status = 'inbox'`
- **THEN** each such video SHALL be rendered as a card showing title, channel name with its section chip (sage small-caps Inter, or `+ ASSIGN` if Unsorted), duration (Plex Mono), thumbnail (duotone-treated via `<DuotoneThumbnail>`), and published_at relative time label

#### Scenario: Inbox accessed via raw-inbox link
- **WHEN** the user clicks "raw inbox" in the top-nav (or footer) of any page
- **THEN** the browser SHALL navigate to `/inbox`; this link SHALL be rendered in smaller weight than the other top-nav items to signal secondary status

## ADDED Requirements

### Requirement: Inline section chip on inbox cards
Each inbox card SHALL display the channel's section chip per the `section-taxonomy` capability: an Inter small-caps sage label for assigned channels, or a muted-oxblood `+ ASSIGN` chip for `section_id = NULL` channels, which opens an assignment popover when clicked.

#### Scenario: Section chip rendered
- **WHEN** an inbox card renders for a video whose channel has a non-null `section_id`
- **THEN** the chip SHALL display the section's name in sage small-caps Inter adjacent to the channel name

#### Scenario: Assign from inbox
- **WHEN** the user clicks `+ ASSIGN` on an inbox card
- **THEN** the assignment popover SHALL open and a successful assignment SHALL replace the chip text in place without navigating away from `/inbox`

### Requirement: Editorial chrome on inbox cards
Inbox cards SHALL adopt the editorial design system: no borders, separated by sage hairline rules; title in Fraunces, channel/duration/relative-time in Source-Serif italic sage; the oxblood accent reserved for the `+ ASSIGN` chip and any `LIVE` badge.

#### Scenario: Inbox uses editorial chrome
- **WHEN** the `/inbox` route renders
- **THEN** cards SHALL NOT display bordered card boxes; items SHALL be separated by 1px `#D9CDB8` horizontal rules and use the Fraunces / Source Serif / Inter type system
