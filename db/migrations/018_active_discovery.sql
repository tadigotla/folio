-- active-discovery (2026-04-26)
--
-- Relaxes discovery_candidates.source_video_id from NOT NULL to nullable so
-- candidates born from the agent's user-initiated `search_youtube` (which has
-- no saved-video source) can persist via the same mutation path used by the
-- nightly description-graph scan. Description-graph rows continue to carry a
-- non-NULL source_video_id; active-search rows pass NULL.
--
-- Safety: additive nullability change. Existing rows are preserved verbatim.
-- Operator MUST run `just backup-db` before applying.
--
-- SQLite cannot ALTER COLUMN nullability in place, so we rebuild the table:
--   1. Create discovery_candidates_new with the relaxed FK.
--   2. Copy every row.
--   3. Drop the old table; rename _new into place.
--   4. Re-create both indexes against the renamed table.
--
-- Rollback: tighten the column with another rebuild migration. Existing rows
-- survive in either direction so long as no NULL values exist yet.

BEGIN;

CREATE TABLE discovery_candidates_new (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  kind               TEXT NOT NULL CHECK (kind IN ('video', 'channel')),
  target_id          TEXT NOT NULL,
  source_video_id    TEXT REFERENCES videos(id) ON DELETE CASCADE,
  source_kind        TEXT NOT NULL CHECK (source_kind IN ('description_link', 'description_handle', 'transcript_link')),
  title              TEXT,
  channel_name       TEXT,
  score              REAL NOT NULL,
  score_breakdown    TEXT,
  proposed_at        TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'dismissed')),
  status_changed_at  TEXT NOT NULL
);

INSERT INTO discovery_candidates_new (
  id, kind, target_id, source_video_id, source_kind,
  title, channel_name, score, score_breakdown,
  proposed_at, status, status_changed_at
)
SELECT
  id, kind, target_id, source_video_id, source_kind,
  title, channel_name, score, score_breakdown,
  proposed_at, status, status_changed_at
FROM discovery_candidates;

DROP TABLE discovery_candidates;
ALTER TABLE discovery_candidates_new RENAME TO discovery_candidates;

CREATE INDEX idx_discovery_candidates_status ON discovery_candidates(status, proposed_at DESC);
CREATE INDEX idx_discovery_candidates_target ON discovery_candidates(target_id);

COMMIT;
