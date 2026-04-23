## ADDED Requirements

### Requirement: rankForHome produces deterministic, taste-weighted candidate list
The system SHALL expose a single function `rankForHome({ limit?, now? })` in `src/lib/home-ranking.ts` that returns an ordered list of `RankedCandidate` rows for rendering the home "For right now" rail. The function SHALL be pure relative to its database snapshot: two calls with the same `now` value against the same DB state SHALL return identical results, including order.

The candidate pool SHALL be filtered at the SQL level to `consumption.status IN ('inbox', 'saved', 'in_progress')`. The per-video score SHALL be `clusterWeight × freshness × stateBoost × fuzzyPenalty`. Results SHALL be sorted by score descending with `video_id` ascending as deterministic tie-break. Default `limit` SHALL be 20.

#### Scenario: Inbox, saved, and in-progress videos are eligible
- **WHEN** `rankForHome()` is called with a DB containing inbox, saved, in_progress, archived, and dismissed videos
- **THEN** the returned candidates SHALL include only videos whose current `consumption.status` is one of `inbox`, `saved`, `in_progress`
- **AND** no archived or dismissed video SHALL appear regardless of its score

#### Scenario: Determinism under tie
- **WHEN** two candidate videos compute the same final score
- **THEN** the candidate with the lexicographically smaller `video_id` SHALL appear first

#### Scenario: Pure relative to `now`
- **WHEN** `rankForHome({ now })` is called twice with the same `now` against an unchanged DB
- **THEN** both calls SHALL return identical ordered lists

### Requirement: Scoring formula components are defined and bounded
The scoring function SHALL compute each component as follows:

- `clusterWeight(v)` SHALL be `taste_clusters.weight` for the cluster assigned to `v` in `video_cluster_assignments`, clamped to the range `[0, 2]`. If the video has no row in `video_cluster_assignments` (no embedding or pre-cluster video), `clusterWeight` SHALL be `0.5`. If the assigned cluster's `retired_at` is not NULL, the video SHALL be treated as having no active cluster (`clusterWeight = 0.5`). If the cluster is muted today (see `taste-profile` capability), `clusterWeight` SHALL be `0`.
- `freshness(v)` SHALL be `exp(-ageDays / 14)` where `ageDays` is the number of days between `videos.published_at` and `now`. If `published_at` is NULL, `freshness` SHALL be `0.5`. `ageDays` SHALL be clamped to `>= 0` (future-dated videos treated as brand-new).
- `stateBoost(v)` SHALL be `1.0` for `inbox`, `1.3` for `saved`, `1.5` for `in_progress`.
- `fuzzyPenalty(v)` SHALL be `0.7` when `video_cluster_assignments.is_fuzzy = 1` for the matching row, else `1.0`.

#### Scenario: Zero weight produces zero score
- **WHEN** a video's assigned cluster has `weight = 0`
- **THEN** the video's final score SHALL be `0`
- **AND** the video MAY still be returned if the limit is large enough to include zero-scored rows, but SHALL sort below any video with score `> 0`

#### Scenario: Cluster weight is clamped at read time
- **WHEN** `taste_clusters.weight = 5` for an assigned cluster
- **THEN** `clusterWeight` used in scoring SHALL be `2`

#### Scenario: Retired cluster is treated as no active cluster
- **WHEN** a video's only row in `video_cluster_assignments` points at a cluster whose `retired_at IS NOT NULL`
- **THEN** `clusterWeight` SHALL be `0.5` for that video (neutral-unknown, not muted)

#### Scenario: Unembedded video gets neutral weight
- **WHEN** a video has no row in `video_cluster_assignments`
- **THEN** `clusterWeight` SHALL be `0.5`

#### Scenario: Freshness half-life
- **WHEN** a video's `published_at` is exactly 14 days before `now`
- **THEN** its `freshness` SHALL be approximately `0.5` (within floating-point tolerance)

#### Scenario: Fuzzy assignment is penalized, not excluded
- **WHEN** a video's assignment has `is_fuzzy = 1` but otherwise would rank high
- **THEN** its final score SHALL be multiplied by `0.7`
- **AND** the video SHALL remain eligible to appear in the returned list

### Requirement: API route exposes ranking with optional debug breakdown
The system SHALL expose `GET /api/home/ranking` that returns the ranked candidate list as JSON. Query parameters:

- `limit` (optional integer, default 20, max 100) — number of candidates to return.
- `debug` (optional boolean `1`/`0` or `true`/`false`, default false) — when true, each candidate SHALL include its score breakdown.

Without `debug`, each candidate SHALL include at minimum `{ videoId: string, score: number }`. With `debug`, each candidate SHALL additionally include `{ clusterWeight, freshness, stateBoost, fuzzyPenalty, clusterId, clusterLabel }`. The response SHALL be `200` with `application/json`. Malformed `limit` SHALL return `400`.

The route SHALL NOT require authentication (Folio is single-user, local). The route SHALL be idempotent and safe to call arbitrarily.

#### Scenario: Default call returns 20 candidates with minimal fields
- **WHEN** client calls `GET /api/home/ranking`
- **THEN** the response SHALL be `200` with body `{ candidates: Array<{ videoId, score }> }` of length at most 20

#### Scenario: Debug mode includes breakdown
- **WHEN** client calls `GET /api/home/ranking?debug=1`
- **THEN** each candidate object SHALL include `clusterWeight`, `freshness`, `stateBoost`, `fuzzyPenalty`, `clusterId`, and `clusterLabel` in addition to `videoId` and `score`

#### Scenario: Limit is honored
- **WHEN** client calls `GET /api/home/ranking?limit=5`
- **THEN** the response candidate array SHALL have length at most 5

#### Scenario: Malformed limit rejected
- **WHEN** client calls `GET /api/home/ranking?limit=abc`
- **THEN** the response SHALL be `400` and body SHALL include an `error` field

### Requirement: "For right now" rail renders behind feature flag
The home page `/` SHALL render a "For right now" rail when `process.env.NEXT_PUBLIC_HOME_RANKING === '1'`. When the flag is not `'1'`, the home page SHALL render unchanged from its current state.

When rendered, the rail SHALL appear **above** the existing home-page content (the issue-driven board and related elements) without replacing or hiding it. The rail SHALL render up to 10 candidate cards from `rankForHome({ limit: 10 })`. Each card SHALL link to `/watch/[id]` and SHALL display title, channel name, and published-at relative time via the project's `relativeTime` helper.

If `rankForHome()` returns zero candidates (empty pool), the rail SHALL render an inline "Nothing to show here — try importing videos or adjusting taste weights" message with a link to `/taste` and no cards. The rail SHALL NOT throw an error that breaks the rest of the page.

#### Scenario: Flag off, page unchanged
- **WHEN** the user visits `/` with `NEXT_PUBLIC_HOME_RANKING` unset or not equal to `'1'`
- **THEN** the rail SHALL NOT render
- **AND** the existing home-page content SHALL render exactly as before this change

#### Scenario: Flag on, candidates present
- **WHEN** the user visits `/` with `NEXT_PUBLIC_HOME_RANKING=1` and `rankForHome` returns at least one candidate
- **THEN** the rail SHALL render above the existing content
- **AND** each card SHALL link to `/watch/[videoId]`

#### Scenario: Flag on, empty pool
- **WHEN** the user visits `/` with the flag on and `rankForHome` returns an empty array
- **THEN** the rail SHALL render an inline empty-state message with a link to `/taste`
- **AND** the existing home-page content SHALL still render below

### Requirement: Ranking reads on each call and reflects current DB state
The system SHALL NOT cache or precompute `rankForHome()` output in this phase. Each invocation SHALL read the current state of `videos`, `consumption`, `video_cluster_assignments`, `taste_clusters`, and `taste_cluster_mutes` and compute the result fresh. A change to `taste_clusters.weight` or `taste_cluster_mutes` SHALL be reflected on the next `/` render without any manual rebuild step.

#### Scenario: Weight edit observably shifts the rail
- **WHEN** the user changes a cluster's `weight` from `1.0` to `0` via `/taste`
- **AND** reloads `/` with `NEXT_PUBLIC_HOME_RANKING=1`
- **THEN** videos assigned to that cluster SHALL be absent from the rail (or sorted to the bottom below any candidate with score `> 0`)

#### Scenario: Mute-today observably shifts the rail
- **WHEN** the user mutes a cluster today
- **AND** reloads `/` with the flag on
- **THEN** videos assigned to that cluster SHALL be absent from the rail (score `= 0`)
