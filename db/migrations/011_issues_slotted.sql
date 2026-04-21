-- Reintroduce `issues` with a deliberate slot-based shape, and add
-- `issue_slots` for the 14 addressable slots per issue (1 cover, 3 featured,
-- 10 briefs). Purely additive; no data migration.

BEGIN;

CREATE TABLE issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published')),
  title TEXT,
  created_at TEXT NOT NULL,
  published_at TEXT
);

CREATE UNIQUE INDEX idx_issues_one_draft
  ON issues(status) WHERE status = 'draft';
CREATE INDEX idx_issues_published
  ON issues(published_at DESC) WHERE status = 'published';

CREATE TABLE issue_slots (
  issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  slot_kind TEXT NOT NULL CHECK (slot_kind IN ('cover', 'featured', 'brief')),
  slot_index INTEGER NOT NULL,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (issue_id, slot_kind, slot_index)
);

CREATE UNIQUE INDEX idx_issue_slots_video
  ON issue_slots(issue_id, video_id);
CREATE INDEX idx_issue_slots_issue ON issue_slots(issue_id);

COMMIT;
