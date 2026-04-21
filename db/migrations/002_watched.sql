CREATE TABLE IF NOT EXISTS watched (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  watched_at TEXT NOT NULL,
  UNIQUE(event_id)
);

CREATE INDEX IF NOT EXISTS idx_watched_event ON watched(event_id);
