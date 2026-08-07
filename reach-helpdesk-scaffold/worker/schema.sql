CREATE TABLE IF NOT EXISTS conversations (
  id         TEXT PRIMARY KEY,
  site       TEXT NOT NULL,
  church     TEXT,
  user_name  TEXT,
  user_email TEXT,
  status     TEXT NOT NULL DEFAULT 'open', -- open | escalated | resolved
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role            TEXT NOT NULL, -- user | assistant
  content         TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS escalations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  reason          TEXT,
  ghl_status      INTEGER, -- HTTP status returned by the GHL webhook
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversations_site ON conversations(site);
