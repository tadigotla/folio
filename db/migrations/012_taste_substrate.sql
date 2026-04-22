-- Taste substrate: per-video embeddings, enrichment summaries, transcripts,
-- and a user-specific taste cluster map derived from the like-set.
-- Additive: no changes to existing tables.

BEGIN;

CREATE TABLE video_embeddings (
  video_id   TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  provider   TEXT NOT NULL,
  model      TEXT NOT NULL,
  dim        INTEGER NOT NULL,
  vec        BLOB NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (video_id, provider, model)
);

CREATE INDEX idx_video_embeddings_provider_model
  ON video_embeddings(provider, model);

CREATE TABLE video_enrichment (
  video_id    TEXT PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
  model       TEXT NOT NULL,
  summary     TEXT NOT NULL,
  topic_tags  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  run_at      TEXT NOT NULL
);

CREATE TABLE video_transcripts (
  video_id    TEXT PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
  source      TEXT NOT NULL,
  language    TEXT NOT NULL,
  text        TEXT NOT NULL,
  fetched_at  TEXT NOT NULL
);

CREATE TABLE taste_clusters (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  label      TEXT,
  weight     REAL NOT NULL DEFAULT 1.0,
  centroid   BLOB NOT NULL,
  dim        INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  retired_at TEXT
);

CREATE INDEX idx_taste_clusters_active
  ON taste_clusters(retired_at) WHERE retired_at IS NULL;

CREATE TABLE video_cluster_assignments (
  video_id    TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  cluster_id  INTEGER NOT NULL REFERENCES taste_clusters(id) ON DELETE CASCADE,
  similarity  REAL NOT NULL,
  is_fuzzy    INTEGER NOT NULL DEFAULT 0,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (video_id)
);

CREATE INDEX idx_video_cluster_cluster
  ON video_cluster_assignments(cluster_id);

COMMIT;
