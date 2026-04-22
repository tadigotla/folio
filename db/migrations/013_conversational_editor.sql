-- Conversational editor: per-draft conversation + turn log.
-- Additive only. No changes to existing tables.

BEGIN;

CREATE TABLE conversations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id   INTEGER NOT NULL UNIQUE
               REFERENCES issues(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

CREATE TABLE conversation_turns (
  id                           INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id              INTEGER NOT NULL
                                  REFERENCES conversations(id) ON DELETE CASCADE,
  role                         TEXT NOT NULL
                                  CHECK (role IN ('user', 'assistant', 'tool')),
  content                      TEXT NOT NULL,
  tokens_input                 INTEGER,
  tokens_output                INTEGER,
  cache_read_input_tokens      INTEGER,
  cache_creation_input_tokens  INTEGER,
  created_at                   TEXT NOT NULL
);

CREATE INDEX idx_conv_turns_conv ON conversation_turns(conversation_id, id);

COMMIT;
