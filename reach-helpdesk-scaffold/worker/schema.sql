CREATE TABLE IF NOT EXISTS conversations (
  id                 TEXT PRIMARY KEY,
  site               TEXT NOT NULL,
  church             TEXT,
  user_name          TEXT,
  user_email         TEXT,
  status             TEXT NOT NULL DEFAULT 'open',  -- open | escalated | resolved
  handled_by         TEXT NOT NULL DEFAULT 'leo',   -- leo | team (once a human replies, Leo stands down)
  agent_last_read_id INTEGER NOT NULL DEFAULT 0,    -- unread tracking for the inbox
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role            TEXT NOT NULL, -- user | assistant (Leo) | agent (human team)
  content         TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS escalations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  reason          TEXT,
  ghl_status      INTEGER, -- HTTP status returned by the GHL webhook (0 = webhook not configured)
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Single-row agent presence: the team is "online" while online_until is in the future.
CREATE TABLE IF NOT EXISTS presence (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  online_until TEXT
);
INSERT OR IGNORE INTO presence (id, online_until) VALUES (1, NULL);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversations_site ON conversations(site);
