-- overnight-maintenance (2026-04-23)
--
-- Adds three net-new tables for the nightly pipeline + discovery substrate:
--   nightly_runs          — one row per nightly invocation (digest)
--   discovery_candidates  — proposed-but-not-yet-imported videos/channels
--   discovery_rejections  — permanent dismiss list, keyed on target_id
--
-- No existing tables are touched; the migration is net-additive. The
-- operational invariant still applies — the operator MUST run
-- `just backup-db` before applying.
--
-- Rollback: DROP TABLE the three and remove the matching _migrations row.

BEGIN;

CREATE TABLE nightly_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_at      TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('ok', 'failed', 'skipped')),
  counts      TEXT,
  notes       TEXT,
  last_error  TEXT
);

CREATE INDEX idx_nightly_runs_run_at ON nightly_runs(run_at DESC);

CREATE TABLE discovery_candidates (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  kind               TEXT NOT NULL CHECK (kind IN ('video', 'channel')),
  target_id          TEXT NOT NULL,
  source_video_id    TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  source_kind        TEXT NOT NULL CHECK (source_kind IN ('description_link', 'description_handle', 'transcript_link')),
  title              TEXT,
  channel_name       TEXT,
  score              REAL NOT NULL,
  score_breakdown    TEXT,
  proposed_at        TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'dismissed')),
  status_changed_at  TEXT NOT NULL
);

CREATE INDEX idx_discovery_candidates_status ON discovery_candidates(status, proposed_at DESC);
CREATE INDEX idx_discovery_candidates_target ON discovery_candidates(target_id);

CREATE TABLE discovery_rejections (
  target_id      TEXT PRIMARY KEY,
  kind           TEXT NOT NULL,
  dismissed_at   TEXT NOT NULL
);

COMMIT;
