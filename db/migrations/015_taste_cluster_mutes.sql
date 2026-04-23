-- Taste cluster "mute today" overrides: per-day ephemeral mute without
-- editing taste_clusters.weight. Queries filter by today's local date
-- (America/New_York) so stale rows auto-decay without a sweeper job.
-- See openspec/changes/taste-ranking-loop/design.md § decision 3.

BEGIN;

CREATE TABLE taste_cluster_mutes (
  cluster_id INTEGER NOT NULL REFERENCES taste_clusters(id) ON DELETE CASCADE,
  muted_on   TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (cluster_id, muted_on)
);

CREATE INDEX idx_taste_cluster_mutes_on ON taste_cluster_mutes(muted_on);

COMMIT;
