-- Phase 1 of the library-import pivot.
-- Destructive: drops RSS ingestion + algorithmic-issue tables, truncates the
-- content corpus, and adds provenance + import-log + app_secrets.
-- Runs in a single implicit transaction (SQLite exec wraps multi-statement DDL).

BEGIN;

DROP TABLE IF EXISTS sources;
DROP TABLE IF EXISTS issues;

DELETE FROM consumption;
DELETE FROM channel_tags;
DELETE FROM videos;
DELETE FROM channels;
DELETE FROM tags;
DELETE FROM sections;

CREATE TABLE video_provenance (
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('like', 'subscription_upload', 'playlist')),
  source_ref TEXT NOT NULL DEFAULT '',
  imported_at TEXT NOT NULL,
  signal_weight REAL NOT NULL,
  PRIMARY KEY (video_id, source_kind, source_ref)
);

CREATE INDEX idx_provenance_video ON video_provenance(video_id);
CREATE INDEX idx_provenance_kind ON video_provenance(source_kind);

CREATE TABLE import_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  source_ref TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  videos_new INTEGER NOT NULL DEFAULT 0,
  videos_updated INTEGER NOT NULL DEFAULT 0,
  channels_new INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

CREATE INDEX idx_import_log_kind_finished
  ON import_log(kind, finished_at DESC);

CREATE TABLE app_secrets (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL
);

COMMIT;
