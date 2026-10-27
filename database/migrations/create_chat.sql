-- Addendum 5: one chat engine for direct messages, groups, channels and
-- (later) project threads. Sales channels are created and kept in sync by the
-- app (lib/chat/core.ts → syncSalesChannels).
--
-- Additive and idempotent. project_messages is left as it is for now; it moves
-- into these tables in a later step.

BEGIN;

CREATE TABLE IF NOT EXISTS conversations (
  id BIGSERIAL PRIMARY KEY,
  type VARCHAR(10) NOT NULL CHECK (type IN ('dm', 'group', 'channel', 'project')),
  name VARCHAR(80),                          -- NULL for DMs (shown as the other person)
  topic TEXT,
  system_key VARCHAR(40),                    -- auto-managed channels: sales-all, help, wins, leads, team-<id>
  dm_key VARCHAR(40),                        -- "<low user id>:<high user id>", one DM per pair
  team_id INTEGER,
  project_id INTEGER,
  is_private BOOLEAN NOT NULL DEFAULT false,
  is_announcement_only BOOLEAN NOT NULL DEFAULT false,
  retention_days INTEGER,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_message_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_conversations_system_key ON conversations (system_key) WHERE system_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_conversations_dm_key ON conversations (dm_key) WHERE dm_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations (project_id) WHERE project_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id),
  role VARCHAR(10) NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  muted_until TIMESTAMPTZ,                   -- 'infinity' = until I unmute
  pinned BOOLEAN NOT NULL DEFAULT false,
  last_read_message_id BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_conversation_members_user ON conversation_members (user_id);

CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id BIGINT REFERENCES users(id),     -- NULL for system messages
  parent_id BIGINT REFERENCES messages(id),  -- thread root
  reply_to_id BIGINT REFERENCES messages(id),
  kind VARCHAR(10) NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'media', 'voice', 'system', 'card', 'poll')),
  body TEXT NOT NULL DEFAULT '',
  card JSONB,
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  deleted_by BIGINT REFERENCES users(id),
  scheduled_for TIMESTAMPTZ,
  legacy_project_message_id INTEGER UNIQUE,  -- set when project_messages are moved in
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages (conversation_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_messages_parent ON messages (parent_id) WHERE parent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS message_reactions (
  message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id),
  emoji VARCHAR(16) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (message_id, user_id, emoji)
);

COMMIT;
