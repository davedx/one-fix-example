CREATE TABLE IF NOT EXISTS conversations (
 request_id TEXT PRIMARY KEY REFERENCES requests(id) ON DELETE CASCADE,
 token_hash TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS messages (
 id TEXT PRIMARY KEY,
 request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 role TEXT NOT NULL CHECK(role IN ('customer','agent')),
 body TEXT NOT NULL,
 reviewed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS messages_request ON messages(request_id,created_at);
