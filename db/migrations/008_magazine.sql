-- Magazine-shaped reading experience: sections (departments) + issues composition.

CREATE TABLE IF NOT EXISTS sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

ALTER TABLE channels ADD COLUMN section_id INTEGER REFERENCES sections(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_channels_section ON channels(section_id);

CREATE TABLE IF NOT EXISTS issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  cover_video_id TEXT REFERENCES videos(id) ON DELETE SET NULL,
  featured_video_ids TEXT NOT NULL,
  pinned_cover_video_id TEXT REFERENCES videos(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_issues_created ON issues(created_at DESC);
