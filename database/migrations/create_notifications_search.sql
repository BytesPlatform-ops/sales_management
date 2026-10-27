-- Phase 1: notification inbox (with per-type preferences, email and a daily digest)
-- and full-text search columns for global search / Ctrl+K.
--
-- training_notifications stays as it is; the inbox API shows both side by side,
-- and everything new writes to notifications_inbox (lib/notifications.ts).
--
-- Additive and idempotent. Existing tables only gain generated search columns.

BEGIN;

-- ---------------------------------------------------------------- inbox
CREATE TABLE IF NOT EXISTS notifications_inbox (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  type VARCHAR(40) NOT NULL,                 -- ticket_assigned, mention, cr_pending, …
  title VARCHAR(200),
  body TEXT NOT NULL,
  link TEXT,
  entity_type VARCHAR(30),                   -- ticket, project, comment, …
  entity_id VARCHAR(40),
  project_id INTEGER,
  actor_id BIGINT,
  read_at TIMESTAMPTZ,
  snoozed_until TIMESTAMPTZ,                 -- hidden until then, then back as unread
  emailed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_inbox_user ON notifications_inbox(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inbox_unread ON notifications_inbox(user_id) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_inbox_project ON notifications_inbox(project_id);

-- Per user, per type: in_app (default when no row), email (in-app + email), off.
CREATE TABLE IF NOT EXISTS notification_prefs (
  user_id BIGINT NOT NULL,
  type VARCHAR(40) NOT NULL,
  channel VARCHAR(10) NOT NULL CHECK (channel IN ('in_app', 'email', 'off')),
  PRIMARY KEY (user_id, type)
);

-- Per-user settings that aren't per type.
CREATE TABLE IF NOT EXISTS notification_settings (
  user_id BIGINT PRIMARY KEY,
  digest_enabled BOOLEAN NOT NULL DEFAULT false,   -- daily 09:00 PKT email of unread items
  last_digest_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- "Send this only once" keys for scheduled notifications (e.g. due:<ticket>:<date>).
CREATE TABLE IF NOT EXISTS notification_once (
  key VARCHAR(120) PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------- search columns
ALTER TABLE projects ADD COLUMN IF NOT EXISTS search tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('simple', coalesce(ticket_no, '') || ' ' || coalesce(title, '') || ' ' || coalesce(client_name, '') || ' ' || coalesce(client_company, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(description, '')), 'B')
) STORED;
CREATE INDEX IF NOT EXISTS idx_projects_search ON projects USING GIN (search);

ALTER TABLE project_messages ADD COLUMN IF NOT EXISTS search tsvector GENERATED ALWAYS AS (
  to_tsvector('english', coalesce(body, ''))
) STORED;
CREATE INDEX IF NOT EXISTS idx_project_messages_search ON project_messages USING GIN (search);

COMMIT;
