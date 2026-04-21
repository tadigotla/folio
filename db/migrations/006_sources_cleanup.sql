-- Simplify `sources`: drop the legacy `category` column and the multi-kind
-- CHECK. After the pivot to a YouTube-only fetcher set, only `youtube_channel`
-- sources are valid.

CREATE TABLE sources_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind = 'youtube_channel'),
  config TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  min_interval_minutes INTEGER NOT NULL DEFAULT 30,
  last_fetched_at TEXT,
  next_fetch_after TEXT,
  last_error TEXT
);

INSERT INTO sources_new (id, name, kind, config, enabled, min_interval_minutes, last_fetched_at, next_fetch_after, last_error)
SELECT id, name, kind, config, enabled, min_interval_minutes, last_fetched_at, next_fetch_after, last_error
FROM sources;

DROP TABLE sources;
ALTER TABLE sources_new RENAME TO sources;
