-- Initial schema: sources, events, picks

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('space', 'nature', 'sports', 'news', 'culture', 'philosophy')),
  kind TEXT NOT NULL CHECK (kind IN ('api', 'rss', 'ical', 'scrape', 'youtube_channel')),
  config TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  min_interval_minutes INTEGER NOT NULL DEFAULT 60,
  last_fetched_at TEXT,
  next_fetch_after TEXT,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  starts_at TEXT,
  ends_at TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'live', 'delayed', 'ended', 'cancelled', 'unknown', 'always_on')),
  stream_kind TEXT NOT NULL
    CHECK (stream_kind IN ('youtube', 'twitch', 'nasa', 'explore_org', 'generic_iframe', 'external_link')),
  stream_ref TEXT NOT NULL,
  thumbnail_url TEXT,
  source_url TEXT NOT NULL,
  last_checked_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  raw TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_starts_at ON events(starts_at);
CREATE INDEX IF NOT EXISTS idx_events_category_starts ON events(category, starts_at);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_source ON events(source_id);

CREATE TABLE IF NOT EXISTS picks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  timeslot_start TEXT,
  picked_at TEXT NOT NULL,
  note TEXT
);

CREATE INDEX IF NOT EXISTS idx_picks_event ON picks(event_id);

-- Track which migrations have run
CREATE TABLE IF NOT EXISTS _migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
