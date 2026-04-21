## REMOVED Requirements

### Requirement: Home becomes a navigation hub
**Reason:** the tile-based navigation hub is replaced by the today's-issue view. Inbox / Library / Archive counts no longer define the home surface; those destinations move to a discreet top-nav.

**Migration:** users who relied on the tile layout will find the same destinations linked from the top-nav on every page. Counts are available inline on those destination pages.

## ADDED Requirements

### Requirement: Home renders today's issue
The home page at `/` SHALL render today's magazine issue. Issue composition follows the rules in the `magazine-issue` capability. The page SHALL display, in vertical order: a masthead, a cover block, a featured strip (3 items), a departments strip, and a briefs list.

#### Scenario: Valid issue with cover
- **WHEN** the user navigates to `/` and today's issue has a non-null `cover_video_id`
- **THEN** the masthead, cover, featured strip, departments strip, and briefs list SHALL all render using the editorial design system

#### Scenario: Empty inbox
- **WHEN** today's issue has `cover_video_id = NULL` (inbox is empty)
- **THEN** the cover block SHALL render an editorial empty state ("Inbox zero. Nothing new today.") and the featured / briefs blocks SHALL be hidden; the departments strip SHALL still render with zeroed counts

### Requirement: Masthead
The top of the home page SHALL render a masthead containing: the issue's volume/issue number, the publication name ("The Wall" placeholder — finalized at implementation), the date in America/New_York (formatted `EEE · MMM d yyyy`), and a small "Publish new issue" button that submits to `POST /api/issues/publish`.

#### Scenario: Masthead fields populated
- **WHEN** the home page renders today's issue `#17`
- **THEN** the masthead SHALL display `VOL I · ISSUE 17`, the publication name centered, and the date on the right

### Requirement: Live-now strip survives as masthead indicator
When any video has `is_live_now = 1`, the masthead SHALL show a compact "LIVE NOW · N" oxblood badge linking to a small popover listing the live videos. The page SHALL NOT promote live videos into the cover slot automatically.

#### Scenario: One live video
- **WHEN** 1 video has `is_live_now = 1` at page-render time
- **THEN** a `LIVE NOW · 1` oxblood badge SHALL appear in the masthead linking to a popover showing that video

#### Scenario: Nothing live
- **WHEN** no video has `is_live_now = 1`
- **THEN** the live-now badge SHALL be hidden entirely

### Requirement: Top-nav for secondary destinations
The home page (and every other page) SHALL include a discreet top-navigation row with links to `/library`, `/library#archived`, `/sections`, `/settings/youtube`, and a footer-style link to `/inbox` (labeled "raw inbox"). The nav SHALL use Inter small-caps at 11px, no backgrounds, no borders — separated by sage hairline dividers.

#### Scenario: Nav rendered consistently
- **WHEN** any top-level page renders (`/`, `/library`, `/sections`, `/watch/[id]`, `/settings/youtube`)
- **THEN** the same top-nav SHALL appear at the top of the viewport with all five links
