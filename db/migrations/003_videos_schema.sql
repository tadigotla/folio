-- Pivot from events to videos. Creates new tables alongside existing ones.
-- Data is migrated in 004; old tables are dropped in 005.

CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,               -- YouTube channel ID, e.g. UCxxx
  name TEXT NOT NULL,
  handle TEXT,                       -- nullable, e.g. @foo
  subscribed INTEGER NOT NULL DEFAULT 0,
  first_seen_at TEXT NOT NULL,
  last_checked_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,               -- YouTube video ID (raw, no source prefix)
  title TEXT NOT NULL,
  description TEXT,
  channel_id TEXT NOT NULL REFERENCES channels(id),
  duration_seconds INTEGER,
  published_at TEXT,                 -- UTC ISO
  thumbnail_url TEXT,
  source_url TEXT NOT NULL,
  is_live_now INTEGER NOT NULL DEFAULT 0,
  scheduled_start TEXT,              -- nullable, set only for announced future live streams
  discovered_at TEXT NOT NULL,
  last_checked_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  raw TEXT
);

CREATE INDEX IF NOT EXISTS idx_videos_channel ON videos(channel_id);
CREATE INDEX IF NOT EXISTS idx_videos_live_now ON videos(is_live_now) WHERE is_live_now = 1;

CREATE TABLE IF NOT EXISTS consumption (
  video_id TEXT PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'inbox'
    CHECK (status IN ('inbox', 'saved', 'in_progress', 'archived', 'dismissed')),
  last_viewed_at TEXT,
  status_changed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_consumption_status_changed
  ON consumption(status, status_changed_at DESC);

-- Stub: populated by a later change (oauth-youtube-import).
CREATE TABLE IF NOT EXISTS oauth_tokens (
  provider TEXT PRIMARY KEY,
  access_token TEXT,
  refresh_token TEXT,
  expires_at TEXT,
  scope TEXT,
  updated_at TEXT
);

-- Stub: populated by a later change (incremental-consumption).
CREATE TABLE IF NOT EXISTS highlights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  timestamp_seconds INTEGER NOT NULL,
  text TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_highlights_video ON highlights(video_id);
