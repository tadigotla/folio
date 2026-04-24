## ADDED Requirements

### Requirement: Discovery candidate substrate

The system SHALL persist proposed-but-not-yet-imported videos and channels in `discovery_candidates(id, kind, target_id, source_video_id, source_kind, title, channel_name, score, score_breakdown, proposed_at, status, status_changed_at)`. `kind` SHALL be one of `'video' | 'channel'` (CHECK-enforced). `source_kind` SHALL be one of `'description_link' | 'description_handle' | 'transcript_link'` (CHECK-enforced). `status` SHALL be one of `'proposed' | 'approved' | 'dismissed'` (CHECK-enforced); `status_changed_at` SHALL update with `status`. `score` SHALL be a non-negative real. `score_breakdown` SHALL be a JSON blob containing at minimum the keys `clusterCosine`, `clusterId`, `clusterWeight`, `sourceFreshness`. `target_id` SHALL be the canonical YouTube identifier (video id like `dQw4w9WgXcQ` for `kind='video'`, channel id like `UCxxx` for `kind='channel'`). The system SHALL NOT enforce uniqueness of `target_id` in this table — the same target may be proposed multiple times by different source videos.

The system SHALL persist permanent rejections in `discovery_rejections(target_id PRIMARY KEY, kind, dismissed_at)`. The PRIMARY KEY SHALL prevent duplicate rejections of the same target.

#### Scenario: Schema enforces enums

- **WHEN** an attempt is made to insert into `discovery_candidates` with `kind = 'playlist'`
- **THEN** the insert SHALL fail with a CHECK constraint violation

#### Scenario: Rejection list is append-only de-duped

- **GIVEN** `discovery_rejections` already contains a row for `target_id = 'abc123'`
- **WHEN** an attempt is made to insert a second row for `target_id = 'abc123'`
- **THEN** the insert SHALL fail with a UNIQUE constraint violation

### Requirement: Description-graph scan over saved + in-progress sources

Step 7 of the nightly pipeline SHALL scan the descriptions and stored transcripts of every video where `consumption.status IN ('saved', 'in_progress')` for YouTube identifiers in the following forms:

- `youtu.be/<videoId>` — video link, `source_kind = 'description_link'` or `'transcript_link'` depending on origin.
- `youtube.com/watch?v=<videoId>` — video link.
- `youtube.com/channel/<UCxxx>` — channel link.
- `youtube.com/@<handle>` — channel handle, `source_kind = 'description_handle'` (also matches bare `@handle` mentions in description text where the surrounding context contains the substring `youtube`).

For each parsed identifier, the system SHALL skip it if any of the following are true:

- A `videos.id` row already exists for `kind = 'video'`.
- A `channels.id` row already exists for `kind = 'channel'`.
- A `discovery_rejections.target_id` row exists.
- A `discovery_candidates` row already exists with `(target_id, status = 'proposed')`.

For each surviving identifier, the system SHALL score it (see "Candidate scoring" requirement) and, if the score is at or above `DISCOVERY_FUZZY_FLOOR` (default `0.55`), insert a row into `discovery_candidates` with `status = 'proposed'` and `proposed_at = NOW()`.

#### Scenario: Inbox + archived sources are excluded

- **GIVEN** a video with `consumption.status = 'inbox'` whose description contains a YouTube link `youtu.be/abc123`
- **WHEN** the description-graph scan runs
- **THEN** no `discovery_candidates` row SHALL be inserted for `target_id = 'abc123'`

#### Scenario: Already-imported targets are skipped

- **GIVEN** a saved video links to `youtu.be/abc123` AND a `videos` row already exists with `id = 'abc123'`
- **WHEN** the scan runs
- **THEN** no `discovery_candidates` row SHALL be inserted for `target_id = 'abc123'`

#### Scenario: Rejected targets are never re-proposed

- **GIVEN** a saved video links to `youtu.be/abc123` AND `discovery_rejections` contains a row for `target_id = 'abc123'`
- **WHEN** the scan runs (this nightly or any future nightly)
- **THEN** no `discovery_candidates` row SHALL be inserted for `target_id = 'abc123'`

#### Scenario: Below-floor candidates are dropped pre-insert

- **GIVEN** a saved video links to `youtu.be/abc123` AND the candidate's score is `0.41` (below the default floor of `0.55`)
- **WHEN** the scan runs
- **THEN** no `discovery_candidates` row SHALL be inserted

### Requirement: Candidate scoring uses the source video as taste stand-in

For each surviving candidate, the system SHALL compute `score` as `clusterCosine × clusterWeight × sourceFreshness`, where:

- `clusterCosine` is the maximum cosine similarity between the source video's stored embedding and the centroid of any active (`retired_at IS NULL`) cluster.
- `clusterId` and `clusterWeight` come from that maximizing cluster (`taste_clusters.weight` clamped to `[0, 2]`, same as `rankForHome`).
- `sourceFreshness` is `exp(-ageDays / 14)` over the source video's `published_at`, clamped to `>= 0`; `0.5` if `published_at IS NULL`.

The full inputs (numeric values, chosen cluster id, source video id) SHALL be persisted to `score_breakdown` JSON for auditability.

#### Scenario: Source-stand-in is documented in score_breakdown

- **WHEN** a candidate is inserted
- **THEN** `score_breakdown` SHALL parse to an object containing `clusterCosine`, `clusterId`, `clusterWeight`, `sourceFreshness`, `sourceVideoId`

#### Scenario: Score is zero when source is unembedded

- **GIVEN** the source video has no `video_embeddings` row under the active provider/model
- **WHEN** the scan tries to score a candidate from that source
- **THEN** the candidate SHALL be skipped (no insert) — the score cannot be computed and we'd otherwise fall through the floor anyway

### Requirement: V1 has no active discovery surface

This change SHALL NOT introduce:

- An `/inbox` "Proposed" rail or any other UI surface that reads `discovery_candidates`.
- API routes for approving or dismissing candidates (no `POST /api/discovery/candidates/[id]/approve`, no `POST /api/discovery/candidates/[id]/dismiss`).
- An agent tool named `search_youtube` or any other tool that queries the YouTube Data API.
- A `YOUTUBE_API_KEY` environment variable.

The candidate substrate SHALL accumulate rows that no UI reads in v1; phase 6 owns the active discovery surfaces.

#### Scenario: Active discovery is deferred

- **WHEN** the operator inspects `/inbox` after a nightly run that staged candidates
- **THEN** no rail or section SHALL render rows from `discovery_candidates`
- **AND** no API route under `/api/discovery/**` SHALL exist
