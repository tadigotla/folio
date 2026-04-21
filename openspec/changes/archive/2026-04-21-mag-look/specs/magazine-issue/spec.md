## ADDED Requirements

### Requirement: Issue freeze and publish
The current "issue" SHALL be the most-recent row in the `issues` table. On a GET request to `/`, the server SHALL check whether the latest issue's `created_at` (converted to America/New_York) falls on today's date. If yes, the page SHALL render that issue. If no (or `issues` is empty), the server SHALL compose and insert a new issue row, then render it.

#### Scenario: Issue already exists for today
- **WHEN** the user navigates to `/` and the latest `issues.created_at` (in America/New_York) is today
- **THEN** the page SHALL render the stored composition (cover, featured list, any pinned cover override) without inserting a new row

#### Scenario: First visit of a new day
- **WHEN** the user navigates to `/` and the latest `issues.created_at` (in America/New_York) is before today
- **THEN** the server SHALL compose a new issue per the cover and featured selection rules, INSERT the row, and render it

#### Scenario: First ever visit
- **WHEN** the user navigates to `/` and the `issues` table is empty
- **THEN** the server SHALL compose and insert the first issue and render it

### Requirement: Explicit publish-new-issue action
The system SHALL expose `POST /api/issues/publish` that composes and inserts a new issue row and redirects to `/`. The masthead SHALL include a "Publish new issue" form that targets this endpoint.

#### Scenario: User refreshes the issue
- **WHEN** the user submits the publish form
- **THEN** a new `issues` row SHALL be inserted with `created_at = NOW()` and the browser SHALL be redirected to `/` where the new issue renders

### Requirement: Cover selection rule
When composing a new issue, the system SHALL select `cover_video_id` by ranking videos with `consumption.status = 'inbox'` using the following composite score:

- **affinity(channel)** = count of videos from that channel with `consumption.status IN ('saved', 'in_progress', 'archived')` where `status_changed_at >= NOW() - 30 days`
- **recency(video)** = 1 / (hours_since_published + 1), computed from `videos.published_at`
- **depth(video)** = log(duration_seconds + 60) / log(3600) — rewards longer pieces but flattens the curve

The cover SHALL be the video with the highest `(affinity + 1) * recency * depth`. Tie-broken by most recent `published_at`, then by `videos.id` ascending for determinism.

If the inbox is empty, `cover_video_id` SHALL be NULL.

#### Scenario: Cover selected from affinity channel
- **WHEN** composing an issue where the user has watched 12 Fireship videos in the last 30 days, and Fireship published a 6-minute video 2 hours ago, while an unwatched channel published a 6-minute video 1 hour ago
- **THEN** the Fireship video SHALL be selected as the cover (affinity boost outweighs slight recency edge)

#### Scenario: Empty inbox
- **WHEN** no videos have `consumption.status = 'inbox'` at the time of composition
- **THEN** `cover_video_id` SHALL be NULL and the issue page SHALL render a "No new pieces" empty state in place of the cover block

### Requirement: Featured strip selection
The `featured_video_ids` array SHALL contain up to 3 video IDs selected as follows: for each of the top 3 sections by inbox-video count (excluding Unsorted if other sections are populated), pick the highest-scoring inbox video from that section using the same composite score as the cover, excluding the cover video itself. If fewer than 3 sections exist, fall back to picking the next 3 highest-scoring inbox videos globally.

#### Scenario: One-per-section featured
- **WHEN** the user has 5 sections populated and composes an issue
- **THEN** the featured array SHALL contain exactly 3 video IDs, each from a different section (the top 3 sections by inbox-count)

#### Scenario: Insufficient sections
- **WHEN** the user has only 1 section populated (or zero — all Unsorted) and composes an issue
- **THEN** the featured array SHALL contain the next 3 highest-scoring inbox videos globally, without per-section constraint

### Requirement: Manual cover pin
The system SHALL expose `POST /api/issues/cover-pin` with body `{ videoId: string }` that sets `pinned_cover_video_id` on the current (most-recent) `issues` row. A `videoId` of `null` clears the pin.

#### Scenario: Pin a video as cover
- **WHEN** the user clicks "Make cover" on a video card or presses `.` while focused on one
- **THEN** the current issue's `pinned_cover_video_id` SHALL be set to that video ID and subsequent renders SHALL show that video as the cover (provided it is still inbox-valid)

#### Scenario: Unpin
- **WHEN** the user clicks "Unpin" on the cover (or re-pins a different video)
- **THEN** `pinned_cover_video_id` SHALL be cleared (or replaced) and the deterministic cover (`cover_video_id`) SHALL be shown again on the next render

### Requirement: Departments strip composition
The departments strip SHALL render up to 6 sections (ranked by current inbox-video count descending, Unsorted always last if present), each showing: the section name in Inter small-caps, the inbox count in oxblood Plex Mono, and up to 3 most-active channel names in italic sage (based on `channels.last_checked_at`).

#### Scenario: Top 6 sections shown
- **WHEN** the user has 9 sections populated and the departments strip renders
- **THEN** the 6 with the highest current inbox-video counts SHALL appear (plus Unsorted at the bottom if it has any members, even if that pushes the visible count above 6)

#### Scenario: Section row click
- **WHEN** the user clicks a section row (or its name)
- **THEN** the browser SHALL navigate to `/section/[slug]` where `[slug]` is a URL-safe representation of the section name

### Requirement: Briefs list composition
The briefs list SHALL contain up to 10 videos with `consumption.status = 'inbox'`, sorted by `duration_seconds` ascending (shortest first), excluding the cover and featured videos. Each brief SHALL render on a single line: a small oxblood bullet, the channel's section label (sage caps), the channel name (Inter small-caps), the video title (Fraunces body), and the duration (Plex Mono, right-aligned).

#### Scenario: Quick-wins first
- **WHEN** the briefs list renders
- **THEN** the first entry SHALL be the shortest inbox video (not counting cover or featured), and subsequent entries SHALL be in strictly non-decreasing duration order

#### Scenario: Fewer than 10 inbox items
- **WHEN** the total inbox size (after excluding cover and featured) is less than 10
- **THEN** all remaining inbox items SHALL be listed

### Requirement: Section page
The system SHALL expose `/section/[slug]` as a server-rendered page listing every video with `consumption.status = 'inbox'` whose channel belongs to that section, sorted by `published_at` descending. The slug `unsorted` SHALL list videos from channels with `section_id = NULL`.

#### Scenario: Valid section slug
- **WHEN** the user navigates to `/section/philosophy` and a section named "Philosophy" exists
- **THEN** the page SHALL render its inbox videos in a column format using the same editorial chrome as the main issue (kicker, Fraunces titles, rules)

#### Scenario: Unknown slug
- **WHEN** the slug does not map to any existing section (and is not `unsorted`)
- **THEN** the page SHALL respond 404
