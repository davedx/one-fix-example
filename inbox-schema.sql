CREATE TABLE IF NOT EXISTS inbox (
  id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  from_address TEXT NOT NULL,
  envelope_from TEXT NOT NULL,
  to_address TEXT NOT NULL,
  reply_to TEXT NOT NULL,
  subject TEXT NOT NULL,
  message_id TEXT NOT NULL,
  in_reply_to TEXT NOT NULL DEFAULT '',
  references_header TEXT NOT NULL DEFAULT '',
  authentication TEXT NOT NULL DEFAULT '',
  text_body TEXT NOT NULL,
  attachment_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'new'
);
CREATE TABLE IF NOT EXISTS inbox_attachments (
  id TEXT PRIMARY KEY,
  inbox_id TEXT NOT NULL REFERENCES inbox(id),
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  content BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS inbox_status_received ON inbox(status,received_at);
