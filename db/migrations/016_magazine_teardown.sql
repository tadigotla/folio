-- magazine-teardown (2026-04-23)
--
-- Drops the magazine schema and reshapes `conversations` to a per-day scope.
-- Net-deletive change. Before applying, the operator MUST run:
--   1. `just backup-db`                                (timestamped events.db copy)
--   2. `tsx scripts/export-issues.ts`                  (JSON dump of issues + issue_slots)
--
-- The migration is wrapped in a single BEGIN/COMMIT so a partial failure
-- rolls back cleanly. The runtime applies migrations with foreign_keys=ON.
-- Two cascades would otherwise wipe data:
--   - `conversations.issue_id` ON DELETE CASCADE → issues
--   - `conversation_turns.conversation_id` ON DELETE CASCADE → conversations
-- defer_foreign_keys defers constraint checks but NOT cascade actions.
-- We therefore rebuild `conversation_turns` so it references the new
-- `conversations_new` table BEFORE we drop the old `conversations` —
-- nothing then cascades through the old table when we drop it.
-- SQLite >= 3.26 (legacy_alter_table=OFF, the default) updates FK
-- declarations during ALTER TABLE … RENAME, so the final FK still points
-- at "conversations" after the rename.

PRAGMA defer_foreign_keys = ON;

BEGIN;

-- (a) sections → tags backfill: copy each section row into `tags` by name.
INSERT OR IGNORE INTO tags (name, sort_order, created_at)
  SELECT name, sort_order, created_at FROM sections;

-- (b) channel_tags backfill: for every channel with a section, add a tag link.
INSERT OR IGNORE INTO channel_tags (channel_id, tag_id, created_at)
  SELECT c.id, t.id, datetime('now')
  FROM channels c
  JOIN sections s ON c.section_id = s.id
  JOIN tags t ON t.name = s.name
  WHERE c.section_id IS NOT NULL;

-- (c) Build new conversations table with scope_date.
CREATE TABLE conversations_new (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  scope_date TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

INSERT INTO conversations_new (scope_date, created_at)
  SELECT DATE(created_at, 'localtime') AS d, MIN(created_at)
  FROM conversations
  GROUP BY d;

-- (d) Build new turn table whose FK targets `conversations_new`. After we
-- DROP the old `conversations` below, no live FK still points at it, so
-- no cascade fires.
CREATE TABLE conversation_turns_new (
  id                           INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id              INTEGER NOT NULL
                                  REFERENCES conversations_new(id) ON DELETE CASCADE,
  role                         TEXT NOT NULL
                                  CHECK (role IN ('user', 'assistant', 'tool')),
  content                      TEXT NOT NULL,
  tokens_input                 INTEGER,
  tokens_output                INTEGER,
  cache_read_input_tokens      INTEGER,
  cache_creation_input_tokens  INTEGER,
  created_at                   TEXT NOT NULL
);

INSERT INTO conversation_turns_new (
    id, conversation_id, role, content,
    tokens_input, tokens_output,
    cache_read_input_tokens, cache_creation_input_tokens, created_at
  )
  SELECT t.id,
         (SELECT cn.id
            FROM conversations_new cn
            JOIN conversations c ON DATE(c.created_at, 'localtime') = cn.scope_date
           WHERE c.id = t.conversation_id
           LIMIT 1) AS new_conv_id,
         t.role, t.content,
         t.tokens_input, t.tokens_output,
         t.cache_read_input_tokens, t.cache_creation_input_tokens, t.created_at
    FROM conversation_turns t;

DROP INDEX IF EXISTS idx_conv_turns_conv;
DROP TABLE conversation_turns;
DROP TABLE conversations;
ALTER TABLE conversations_new RENAME TO conversations;
ALTER TABLE conversation_turns_new RENAME TO conversation_turns;
CREATE INDEX idx_conv_turns_conv ON conversation_turns(conversation_id, id);

-- (e) drop the section_id column from channels (must drop the supporting
-- index first; SQLite refuses DROP COLUMN otherwise).
DROP INDEX IF EXISTS idx_channels_section;
ALTER TABLE channels DROP COLUMN section_id;

-- (f) drop magazine tables. issue_slots first (FK to issues), then issues,
-- then sections.
DROP TABLE IF EXISTS issue_slots;
DROP TABLE IF EXISTS issues;
DROP TABLE IF EXISTS sections;

COMMIT;
