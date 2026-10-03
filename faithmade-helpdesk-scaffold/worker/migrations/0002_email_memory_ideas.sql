-- v2: email loop, Leo's memory, and the Ideas board.

-- Lets us tell whether the church is still watching the widget (→ live) or
-- has left (→ the reply goes out by email instead).
ALTER TABLE conversations ADD COLUMN client_last_seen TEXT;

-- New message roles alongside user | assistant | agent:
--   coach — the team telling Leo what to say (team-only)
--   note  — internal notes, including Leo's notes back to the team (team-only)
-- via:    how it came in — widget | email | inbox | link
-- author: which team member (email address) wrote or coached it; 'leo' for Leo's notes
ALTER TABLE messages ADD COLUMN via TEXT;
ALTER TABLE messages ADD COLUMN author TEXT;

-- Answers the team has taught Leo — by replying to Leo's email, coaching in
-- the inbox or the reply page, or adding one by hand. Fed into future chats.
CREATE TABLE IF NOT EXISTS memories (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  question               TEXT NOT NULL,
  answer                 TEXT NOT NULL,
  enabled                INTEGER NOT NULL DEFAULT 1,
  source_conversation_id TEXT,
  created_via            TEXT,                  -- email | inbox | link | manual
  match_count            INTEGER NOT NULL DEFAULT 0,
  last_matched_at        TEXT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Every email in and out: the audit trail behind the inbox's Email log.
CREATE TABLE IF NOT EXISTS email_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  direction       TEXT NOT NULL,                 -- out | in
  kind            TEXT NOT NULL,
  conversation_id TEXT,
  idea_id         INTEGER,
  to_addr         TEXT,
  from_addr       TEXT,
  reply_to        TEXT,
  subject         TEXT,
  html            TEXT,
  text            TEXT,
  status          TEXT NOT NULL,                 -- sent | logged | failed | processed | ignored | rejected
  provider_id     TEXT,
  error           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Ideas board (feature requests), shared across every Faithmade church.
CREATE TABLE IF NOT EXISTS ideas (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  title             TEXT NOT NULL,
  body              TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'under_review', -- under_review | planned | in_progress | shipped | declined
  author_email      TEXT,
  author_name       TEXT,
  church            TEXT,
  site              TEXT,
  vote_count        INTEGER NOT NULL DEFAULT 0,
  comment_count     INTEGER NOT NULL DEFAULT 0,
  merged_into       INTEGER,
  status_changed_at TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS idea_votes (
  idea_id     INTEGER NOT NULL REFERENCES ideas(id),
  voter_email TEXT NOT NULL,
  voter_name  TEXT,
  church      TEXT,
  site        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (idea_id, voter_email)
);

CREATE TABLE IF NOT EXISTS idea_comments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  idea_id      INTEGER NOT NULL REFERENCES ideas(id),
  author_email TEXT,
  author_name  TEXT,
  church       TEXT,
  is_team      INTEGER NOT NULL DEFAULT 0,
  body         TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ideas_status ON ideas(status);
CREATE INDEX IF NOT EXISTS idx_idea_comments_idea ON idea_comments(idea_id);
CREATE INDEX IF NOT EXISTS idx_email_log_conversation ON email_log(conversation_id);
