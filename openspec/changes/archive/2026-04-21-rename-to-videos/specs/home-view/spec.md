## ADDED Requirements

### Requirement: Home becomes a navigation hub
The home page at `/` SHALL render navigation tiles linking to `/inbox`, `/library`, and (for completed archive review in later changes) `/archive` — shown as `Archive` in this change. Each tile SHALL display a count of videos in the corresponding consumption status.

#### Scenario: Inbox tile shows inbox count
- **WHEN** the home page renders and 7 videos have `consumption.status = 'inbox'`
- **THEN** the Inbox tile SHALL display the number 7 and link to `/inbox`

#### Scenario: Library tile shows saved + in_progress count
- **WHEN** the home page renders and the combined count of `consumption.status IN ('saved', 'in_progress')` is 42
- **THEN** the Library tile SHALL display the number 42 and link to `/library`

#### Scenario: Archive tile shows archived count
- **WHEN** the home page renders
- **THEN** the Archive tile SHALL display the count of `consumption.status = 'archived'` and link to `/library#archived` (the archived section of the library route)

### Requirement: Live Now indicator
The home page SHALL render a small "Live Now" indicator listing videos where `is_live_now = 1`. It SHALL be a compact strip, not a primary surface.

#### Scenario: Videos are currently live
- **WHEN** the home page renders and at least one video has `is_live_now = 1`
- **THEN** the page SHALL show a "Live Now" strip with those videos, each linking to `/watch/{id}`

#### Scenario: Nothing is live
- **WHEN** no videos have `is_live_now = 1`
- **THEN** the "Live Now" strip SHALL be hidden

## REMOVED Requirements

### Requirement: Next Up timeline
**Reason**: Hour-by-hour scheduled programming no longer applies. The primary surfaces are Inbox and Library, not time-boxed programming.
**Migration**: No replacement. Delete the timeline rendering from `src/app/page.tsx`. Upcoming scheduled live streams may return as a surface in a later change if useful.

### Requirement: Category filtering
**Reason**: Category is being removed from the data model in this change. Future discovery filtering will be by channel or tag (out of scope here).
**Migration**: Delete `src/components/CategoryFilter.tsx` and remove the `category` column from any new `videos`-based queries.

### Requirement: Event card display
**Reason**: Event cards are replaced by video cards (see `inbox-view` and `library-view` specs) which carry different fields (duration, channel instead of category, no `starts_at` label).
**Migration**: Delete or rewrite `src/components/EventCard.tsx` as `VideoCard.tsx` with the new field set.

### Requirement: Event card links to player
**Reason**: Superseded by per-view card-link requirements in `inbox-view` and `library-view`, which specify the same behavior in the new naming.
**Migration**: No action; the new specs already cover this.

### Requirement: Live Now strip
**Reason**: Replaced by the narrower "Live Now indicator" requirement above, which removes the requirement that cards show category/thumbnail in a specific way and no longer promotes the strip as the top surface.
**Migration**: Adjust the strip to the new, compact form described above.
