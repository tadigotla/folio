## MODIFIED Requirements

### Requirement: Discovery candidate substrate

The system SHALL persist proposed-but-not-yet-imported videos and channels in `discovery_candidates(id, kind, target_id, source_video_id, source_kind, title, channel_name, score, score_breakdown, proposed_at, status, status_changed_at)`. `kind` SHALL be one of `'video' | 'channel'` (CHECK-enforced). `source_kind` SHALL be one of `'description_link' | 'description_handle' | 'transcript_link'` (CHECK-enforced). `status` SHALL be one of `'proposed' | 'approved' | 'dismissed'` (CHECK-enforced); `status_changed_at` SHALL update with `status`. `score` SHALL be a non-negative real. `score_breakdown` SHALL be a JSON blob containing at minimum the keys `clusterCosine`, `clusterId`, `clusterWeight`, `sourceFreshness`. `target_id` SHALL be the canonical YouTube identifier (video id like `dQw4w9WgXcQ` for `kind='video'`, channel id like `UCxxx` for `kind='channel'`; the `@handle` form is accepted only transiently by `propose_import` and resolved to a `UCxxx` at approve time). The system SHALL NOT enforce uniqueness of `target_id` in this table — the same target may be proposed multiple times by different source videos or by repeated active searches.

`source_video_id` SHALL be `NULL`-able. A row SHALL have a non-NULL `source_video_id` (with `REFERENCES videos(id) ON DELETE CASCADE`) when the candidate originates from the description-graph scan of a saved/in-progress video. A row SHALL have `NULL` `source_video_id` when the candidate originates from an active `search_youtube` call (which has no saved-video source). Phase 5's migration created `source_video_id` as `NOT NULL`; phase 6's migration relaxes this constraint.

The system SHALL persist permanent rejections in `discovery_rejections(target_id PRIMARY KEY, kind, dismissed_at)`. The PRIMARY KEY SHALL prevent duplicate rejections of the same target.

#### Scenario: Schema enforces enums

- **WHEN** an attempt is made to insert into `discovery_candidates` with `kind = 'playlist'`
- **THEN** the insert SHALL fail with a CHECK constraint violation

#### Scenario: Rejection list is append-only de-duped

- **GIVEN** `discovery_rejections` already contains a row for `target_id = 'abc123'`
- **WHEN** an attempt is made to insert a second row for `target_id = 'abc123'`
- **THEN** the insert SHALL fail with a UNIQUE constraint violation

#### Scenario: Active-search candidate has NULL source_video_id

- **GIVEN** the curation agent calls `propose_import({ kind: 'video', targetId: 'abc123', sourceKind: 'description_link' })` from a `search_youtube` result
- **WHEN** the candidate row is inserted
- **THEN** `source_video_id` SHALL be `NULL`
- **AND** no foreign-key violation SHALL occur

#### Scenario: Description-graph candidate keeps source_video_id

- **GIVEN** the nightly description-graph scan extracts a link from a saved video with id `src_vid`
- **WHEN** the candidate row is inserted via `proposeCandidate`
- **THEN** `source_video_id` SHALL equal `'src_vid'`

## REMOVED Requirements

### Requirement: V1 has no active discovery surface

**Reason:** Phase 6 (this change, `active-discovery`) introduces the active discovery surfaces that phase 5 (`overnight-maintenance`) explicitly deferred. The phase-5 requirement was a boundary marker; phase 6 replaces it with the ADDED requirements below.

**Migration:** No data migration. The substrate tables created in phase 5 are consumed directly by the new UI + API routes + agent tools. No phase-5 readers existed that need updating.

## ADDED Requirements

### Requirement: Active search via YouTube Data API

The system SHALL expose an agent tool `search_youtube({ query: string, channel_id?: string, max_results?: number })` that wraps YouTube Data API v3 `search.list`. The tool SHALL be invoked only when the user explicitly asks the agent to find new content; the agent SHALL NOT call it to verify metadata, enrich a reply, or satisfy a question about existing corpus content. The tool SHALL require `YOUTUBE_API_KEY` in process env; when unset, the tool SHALL return a tool-error `{ error: 'youtube_api_key_missing', message: 'YOUTUBE_API_KEY not set. See RUNBOOK "Discovery (active)" for setup.' }` without making any outbound call.

The tool's default `max_results` SHALL be 10; the hard cap SHALL be 25 (one `search.list` call). Results SHALL be normalized to `{ kind: 'video'|'channel', target_id: string, title: string, channel_name: string|null }`. The tool SHALL NOT persist rows — persistence happens when the agent calls `propose_import` on individual results.

#### Scenario: Missing API key returns tool-error without outbound call

- **GIVEN** `YOUTUBE_API_KEY` is unset
- **WHEN** the agent calls `search_youtube({ query: 'cast iron metallurgy' })`
- **THEN** the tool SHALL return `{ error: 'youtube_api_key_missing', ... }`
- **AND** no `fetch` to `googleapis.com` SHALL be issued

#### Scenario: Successful search returns normalized results

- **GIVEN** `YOUTUBE_API_KEY` is set and the query returns 5 results from the Data API
- **WHEN** the agent calls `search_youtube({ query: 'slow cinema essays', max_results: 5 })`
- **THEN** the tool SHALL return an array of 5 `{ kind, target_id, title, channel_name }` objects
- **AND** no row SHALL be inserted into `discovery_candidates`

#### Scenario: max_results clamped to hard cap

- **WHEN** the agent calls `search_youtube({ query: 'x', max_results: 50 })`
- **THEN** the underlying `search.list` call SHALL be issued with at most 25 results
- **AND** the tool return SHALL contain at most 25 items

### Requirement: Agent tool `propose_import` wraps `proposeCandidate`

The system SHALL expose an agent tool `propose_import({ kind: 'video'|'channel', target_id: string, title?: string, channel_name?: string, source_kind: 'description_link'|'description_handle'|'transcript_link' })`. The tool SHALL delegate to `src/lib/discovery/candidates.ts#proposeCandidate` with `source_video_id = NULL` and `score = 0, breakdown = { source: 'active_search' }` (candidates from active search bypass the cluster-cosine scoring; sort order on the Proposed rail is unchanged because rows are timestamped and the rail ranks by score desc with ties broken by `proposed_at` desc). The tool SHALL call `isAlreadyKnown(target_id, kind)` before inserting; when the target is already in `videos`/`channels`/`discovery_rejections`/an existing `proposed` candidate, the tool SHALL return `{ proposed: false, reason: 'already_known' }` without inserting.

The tool SHALL NOT bypass `proposeCandidate`. No raw SQL insert into `discovery_candidates` SHALL originate from the agent code path.

#### Scenario: Duplicate target is silently dropped

- **GIVEN** `discovery_rejections` contains a row for `target_id = 'abc123'`
- **WHEN** the agent calls `propose_import({ kind: 'video', target_id: 'abc123', source_kind: 'description_link' })`
- **THEN** the tool SHALL return `{ proposed: false, reason: 'already_known' }`
- **AND** no row SHALL be inserted into `discovery_candidates`

#### Scenario: Fresh target is proposed

- **GIVEN** no row for `target_id = 'xyz999'` exists in `videos`, `channels`, `discovery_rejections`, or as a `proposed` `discovery_candidates` row
- **WHEN** the agent calls `propose_import({ kind: 'video', target_id: 'xyz999', title: 'Example', source_kind: 'description_link' })`
- **THEN** exactly one row SHALL be inserted into `discovery_candidates` with `status = 'proposed'`, `source_video_id = NULL`, and `score = 0`
- **AND** the tool SHALL return `{ proposed: true, candidate_id: <new id> }`

### Requirement: Proposed-rail read surface on `/inbox`

The system SHALL render a `ProposedRail` server component at the top of `/inbox` that reads `discovery_candidates WHERE status = 'proposed'` ordered by `score DESC, proposed_at DESC` with a cap of 20 rows. Each card SHALL render: `target_id`, `title` (falling back to `target_id` if null), `channel_name` (falling back to `''`), `score` (formatted to 2 decimal places), the `source_video_id` as a click-through link to `/watch/<sourceVideoId>` when present, plus an **Approve** button and a **Dismiss** button. When the query returns zero rows, the rail SHALL render no DOM (no heading, no empty-state placeholder — same posture as `SinceLastVisit` on `/`).

The rail SHALL NOT paginate in v1. Existing `/inbox` triage UI (for `consumption.status = 'inbox'` videos) SHALL render unchanged below the rail, separated by a horizontal rule.

#### Scenario: Empty substrate renders no DOM

- **GIVEN** no rows exist in `discovery_candidates` with `status = 'proposed'`
- **WHEN** `/inbox` is rendered
- **THEN** no Proposed-rail heading or container SHALL appear in the HTML
- **AND** existing inbox triage UI SHALL render as the topmost content

#### Scenario: Populated rail renders above triage

- **GIVEN** three rows exist with `status = 'proposed'`
- **WHEN** `/inbox` is rendered
- **THEN** the Proposed rail SHALL render three cards ordered by `score DESC`
- **AND** a horizontal rule SHALL separate the rail from the inbox triage UI

### Requirement: Approve endpoint imports the target and drains the candidate row

The system SHALL expose `POST /api/discovery/candidates/[id]/approve` that:

1. Loads the candidate row (404 if not found).
2. For `kind = 'video'`: calls YouTube Data API `videos.list` to fetch the video's normalized metadata (title, description, channel id + name, duration, published_at, thumbnail); rolls back and returns HTTP 502 if the call fails.
3. For `kind = 'channel'`: calls YouTube Data API `channels.list` (with `forHandle` when `target_id` starts with `@`) to resolve to the canonical `UCxxx` + channel name + thumbnail; rolls back and returns 502 on failure.
4. In one SQLite transaction: upserts `channels` + (for video kind) `videos` + `consumption (status = 'saved')`, writes `video_provenance (source_kind = 'like')`, updates the candidate row to `status = 'approved', status_changed_at = NOW()`, then deletes the candidate row.

The endpoint SHALL reuse the existing import helpers (`importVideos`, `upsertChannel`) and SHALL NOT introduce a new mutation path for `videos` or `channels`. On success it SHALL return HTTP 200 with the new `video_id` or `channel_id`.

#### Scenario: Approve video creates all rows atomically

- **GIVEN** a `discovery_candidates` row `{ id: 7, kind: 'video', target_id: 'abc123', status: 'proposed' }`
- **WHEN** `POST /api/discovery/candidates/7/approve` is called and the Data API returns successfully
- **THEN** a `videos` row with `id = 'abc123'` SHALL exist
- **AND** a `consumption` row with `video_id = 'abc123'` and `status = 'saved'` SHALL exist
- **AND** the `discovery_candidates` row SHALL be gone

#### Scenario: Data API failure preserves the candidate

- **GIVEN** a `discovery_candidates` row exists and the Data API returns 500
- **WHEN** `POST /api/discovery/candidates/[id]/approve` is called
- **THEN** the endpoint SHALL return HTTP 502
- **AND** the candidate row SHALL still exist with `status = 'proposed'`
- **AND** no `videos`/`channels`/`consumption` rows SHALL have been created

### Requirement: Dismiss endpoint appends to rejections and drains the candidate

The system SHALL expose `POST /api/discovery/candidates/[id]/dismiss` that, in one SQLite transaction:

1. Loads the candidate row (404 if not found).
2. Inserts a `discovery_rejections` row with `target_id = <candidate.target_id>, kind = <candidate.kind>, dismissed_at = NOW()`. If the row already exists, the transaction SHALL use `INSERT OR IGNORE` semantics.
3. Updates the candidate row to `status = 'dismissed', status_changed_at = NOW()`, then deletes it.

Subsequent description-graph scans and `propose_import` calls SHALL skip this `target_id` forever (enforced by `isAlreadyKnown`).

#### Scenario: Dismiss records rejection and deletes candidate

- **GIVEN** a candidate row `{ id: 8, target_id: 'xyz', status: 'proposed' }`
- **WHEN** `POST /api/discovery/candidates/8/dismiss` is called
- **THEN** `discovery_rejections` SHALL gain a row with `target_id = 'xyz'`
- **AND** the candidate row SHALL be gone

#### Scenario: Dismissing a target that was already rejected is idempotent

- **GIVEN** `discovery_rejections` already has `target_id = 'xyz'` and a fresh `proposed` candidate with the same target
- **WHEN** the fresh candidate is dismissed
- **THEN** no UNIQUE violation SHALL occur
- **AND** the candidate row SHALL be deleted

### Requirement: Candidate + rejection list endpoints

The system SHALL expose the following read + mutation endpoints for the rail and settings page:

- `GET /api/discovery/candidates` — returns `proposed` rows as JSON, ordered by `score DESC, proposed_at DESC`, capped at 50.
- `GET /api/discovery/rejections` — returns all rejection rows as JSON.
- `DELETE /api/discovery/rejections/[id]` — removes a single rejection by `target_id`.
- `DELETE /api/discovery/rejections` — removes all rejection rows; returns `{ deleted: number }`.

All four endpoints SHALL be idempotent on re-invocation (the DELETE endpoints naturally so). The GET endpoints SHALL return HTTP 200 with a stable shape even when the table is empty.

#### Scenario: DELETE /api/discovery/rejections clears the list

- **GIVEN** `discovery_rejections` has 3 rows
- **WHEN** `DELETE /api/discovery/rejections` is called
- **THEN** the response SHALL be `{ deleted: 3 }`
- **AND** the table SHALL be empty

#### Scenario: DELETE /api/discovery/rejections/[id] clears one entry

- **GIVEN** `discovery_rejections` has rows for `'a'`, `'b'`, `'c'`
- **WHEN** `DELETE /api/discovery/rejections/b` is called
- **THEN** the row for `'b'` SHALL be gone
- **AND** `'a'` and `'c'` SHALL remain

### Requirement: `/settings/discovery` surfaces the rejection list

The system SHALL render a server component at `/settings/discovery` that lists every `discovery_rejections` row with `target_id`, `kind`, `dismissed_at` (relative), a **Clear** button per row, and a **Clear all** button at the top. The page SHALL wire the buttons to `DELETE /api/discovery/rejections/[id]` and `DELETE /api/discovery/rejections` respectively. When the list is empty, the page SHALL render a short serif italic "Nothing has been dismissed yet." message and no buttons.

#### Scenario: Empty list renders an empty-state message

- **GIVEN** `discovery_rejections` is empty
- **WHEN** `/settings/discovery` is rendered
- **THEN** the page SHALL render the empty-state message
- **AND** no **Clear all** button SHALL render

#### Scenario: Clear-all removes everything

- **GIVEN** the page shows 4 rejection rows
- **WHEN** the user clicks **Clear all**
- **THEN** a `DELETE /api/discovery/rejections` request SHALL be issued
- **AND** on success the page SHALL re-render with the empty-state message
