-- Playlists: named, ordered, many-to-many collections of videos.
-- Phase 1 of the consumption-first umbrella. Pure addition; no existing
-- tables touched. See openspec/changes/playlists/design.md.

BEGIN;

CREATE TABLE playlists (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  description  TEXT,
  show_on_home INTEGER NOT NULL DEFAULT 0 CHECK (show_on_home IN (0, 1)),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX idx_playlists_updated ON playlists(updated_at DESC);
CREATE INDEX idx_playlists_show_on_home ON playlists(show_on_home)
  WHERE show_on_home = 1;

CREATE TABLE playlist_items (
  playlist_id  INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  video_id     TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL,
  added_at     TEXT NOT NULL,
  PRIMARY KEY (playlist_id, video_id)
);

CREATE INDEX idx_playlist_items_position ON playlist_items(playlist_id, position);
CREATE INDEX idx_playlist_items_video ON playlist_items(video_id);

COMMIT;
