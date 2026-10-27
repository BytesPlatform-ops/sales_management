-- Phase 3: brief timeline (with attachments) and a WhatsApp-style project thread
-- (media, voice notes, edit/delete windows, pins, forwards, read receipts).
--
-- Additive and idempotent. Existing tables only gain columns; the project_messages
-- kind check is widened ('message' stays the plain-text kind).

BEGIN;

-- ---------------------------------------------------------------- activity
ALTER TABLE projects ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;

-- ---------------------------------------------------------------- brief timeline
CREATE TABLE IF NOT EXISTS brief_entries (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL DEFAULT 'requirement'
    CHECK (type IN ('requirement', 'content', 'change', 'feedback', 'clarification')),
  body TEXT NOT NULL DEFAULT '',
  tags TEXT[] NOT NULL DEFAULT '{}',                 -- e.g. waiting_on_client
  is_original BOOLEAN NOT NULL DEFAULT false,        -- the project's starting brief (version 1)
  version INTEGER NOT NULL DEFAULT 1,
  created_by BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  edited_at TIMESTAMPTZ,
  edited_by BIGINT,
  deleted_at TIMESTAMPTZ,
  deleted_by BIGINT,
  source_message_id INTEGER,                         -- added from a thread message
  search tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(body, ''))) STORED
);
CREATE INDEX IF NOT EXISTS idx_brief_project ON brief_entries(project_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_brief_original ON brief_entries(project_id) WHERE is_original;
CREATE INDEX IF NOT EXISTS idx_brief_search ON brief_entries USING GIN (search);

-- Every earlier text of an entry (edits within 24h keep the version number; later edits bump it).
CREATE TABLE IF NOT EXISTS brief_entry_versions (
  id SERIAL PRIMARY KEY,
  entry_id INTEGER NOT NULL REFERENCES brief_entries(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  type VARCHAR(20) NOT NULL,
  body TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  edited_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_brief_versions ON brief_entry_versions(entry_id, id DESC);

-- Developers mark entries "seen" or ask for clarification.
CREATE TABLE IF NOT EXISTS brief_entry_marks (
  id SERIAL PRIMARY KEY,
  entry_id INTEGER NOT NULL REFERENCES brief_entries(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL,
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('seen', 'need_clarification')),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMPTZ,
  resolved_by BIGINT,
  resolution TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_brief_seen ON brief_entry_marks(entry_id, user_id) WHERE kind = 'seen';
CREATE INDEX IF NOT EXISTS idx_brief_marks_open ON brief_entry_marks(entry_id) WHERE kind = 'need_clarification' AND resolved_at IS NULL;

-- Tickets made from a brief update ("Convert to change request").
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS source_brief_entry_id INTEGER REFERENCES brief_entries(id) ON DELETE SET NULL;

-- Every existing project's description becomes its original brief entry (version 1).
INSERT INTO brief_entries (project_id, type, body, is_original, created_by, created_at)
SELECT p.id, 'requirement', p.description, true, p.created_by, p.created_at
  FROM projects p
 WHERE NOT EXISTS (SELECT 1 FROM brief_entries b WHERE b.project_id = p.id AND b.is_original);

-- ---------------------------------------------------------------- thread
ALTER TABLE project_messages DROP CONSTRAINT IF EXISTS project_messages_kind_check;
ALTER TABLE project_messages ADD CONSTRAINT project_messages_kind_check
  CHECK (kind IN ('message', 'media', 'voice', 'system'));
ALTER TABLE project_messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE project_messages ADD COLUMN IF NOT EXISTS deleted_by BIGINT;
ALTER TABLE project_messages ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;
ALTER TABLE project_messages ADD COLUMN IF NOT EXISTS pinned_by BIGINT;
ALTER TABLE project_messages ADD COLUMN IF NOT EXISTS forwarded_from JSONB;      -- {project_id, ticket_no, author, message_id}
ALTER TABLE project_messages ADD COLUMN IF NOT EXISTS meta JSONB;                -- voice: {duration, peaks[]}
-- A draft holds a message's attachments while they upload; only its author sees it.
-- Publishing re-inserts it with a fresh id so everyone else's "after=<id>" polling picks it up.
ALTER TABLE project_messages ADD COLUMN IF NOT EXISTS is_draft BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE project_messages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_pmsg_updated ON project_messages(project_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_pmsg_pinned ON project_messages(project_id) WHERE pinned_at IS NOT NULL AND deleted_at IS NULL;

COMMIT;
