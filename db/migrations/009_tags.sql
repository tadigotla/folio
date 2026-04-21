-- Additive many-to-many tagging layer, alongside the 1:1 channel→section backbone.

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS channel_tags (
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (channel_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_tags_tag ON channel_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_channel_tags_channel ON channel_tags(channel_id);
