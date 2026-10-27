-- Developer collaboration and scoped access: temporary/shared access grants,
-- help requests, handoff notes, review requests, developer profiles (skills,
-- capacity, guest/freelance flag), out-of-office dates, weekly triage rotation.
--
-- access_grants is the one place extra access lives. Project visibility
-- (lib/projects/core), tickets, files, saved views and the vault all read it;
-- a grant stops working the moment it expires or is revoked.
--
-- Additive and idempotent.

BEGIN;

-- ---------------------------------------------------------------- developer profiles
CREATE TABLE IF NOT EXISTS developer_profiles (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  skills TEXT[] NOT NULL DEFAULT '{}',
  timezone VARCHAR(50) NOT NULL DEFAULT 'Asia/Karachi',
  weekly_capacity_hours SMALLINT CHECK (weekly_capacity_hours BETWEEN 0 AND 80),
  is_guest BOOLEAN NOT NULL DEFAULT false,      -- external/freelance: explicit projects only, never auto-picked
  guest_expires_at TIMESTAMPTZ,                 -- after this a guest can't sign in to anything
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_dev_profiles_skills ON developer_profiles USING GIN (skills);

-- Out of office (inclusive dates, PKT calendar days).
CREATE TABLE IF NOT EXISTS user_availability (
  id SERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  note VARCHAR(200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (ends_on >= starts_on)
);
CREATE INDEX IF NOT EXISTS idx_user_availability_user ON user_availability(user_id, ends_on);

-- ---------------------------------------------------------------- access grants
CREATE TABLE IF NOT EXISTS access_grants (
  id SERIAL PRIMARY KEY,
  grantee_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource_type VARCHAR(20) NOT NULL
    CHECK (resource_type IN ('project', 'ticket', 'doc', 'snippet', 'file', 'saved_view', 'vault_item')),
  resource_id VARCHAR(40) NOT NULL,             -- project/ticket/secret id, media uuid, …
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  level VARCHAR(10) NOT NULL DEFAULT 'view' CHECK (level IN ('view', 'comment', 'edit')),
  -- {"vault_envs":["development"], "hr_approved":true, "pending_approval":true}
  scope JSONB NOT NULL DEFAULT '{}',
  reason TEXT,
  granted_by BIGINT,
  source VARCHAR(20) NOT NULL DEFAULT 'share' CHECK (source IN ('help_request', 'share', 'guest')),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ,                        -- NULL = until revoked
  revoked_at TIMESTAMPTZ,
  revoked_by BIGINT,
  expired_notified_at TIMESTAMPTZ,               -- set by the hourly expiry job
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_access_grants_grantee ON access_grants(grantee_id, revoked_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_access_grants_resource ON access_grants(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_access_grants_project ON access_grants(project_id);

-- ---------------------------------------------------------------- help requests
CREATE TABLE IF NOT EXISTS help_requests (
  id SERIAL PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  requested_by BIGINT NOT NULL,
  skills TEXT[] NOT NULL DEFAULT '{}',
  target_user_ids BIGINT[] NOT NULL DEFAULT '{}',
  message TEXT NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'declined', 'cancelled', 'expired')),
  accepted_by BIGINT,
  accepted_at TIMESTAMPTZ,
  grant_id INTEGER REFERENCES access_grants(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ,                        -- end of the helper's temporary access
  extended_by BIGINT,
  declined_by BIGINT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_help_requests_ticket ON help_requests(ticket_id);
CREATE INDEX IF NOT EXISTS idx_help_requests_open ON help_requests(status) WHERE status = 'open';

-- ---------------------------------------------------------------- handoff notes
CREATE TABLE IF NOT EXISTS handoff_notes (
  id SERIAL PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  from_user_ids BIGINT[] NOT NULL DEFAULT '{}',
  to_user_ids BIGINT[] NOT NULL DEFAULT '{}',
  done TEXT NOT NULL,
  left_todo TEXT NOT NULL,
  branch VARCHAR(255),
  gotchas TEXT,
  created_by BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_handoff_notes_ticket ON handoff_notes(ticket_id, id DESC);

-- ---------------------------------------------------------------- review requests
CREATE TABLE IF NOT EXISTS review_requests (
  id SERIAL PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  requested_by BIGINT NOT NULL,
  reviewer_id BIGINT NOT NULL,
  pr_url TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'approved', 'changes_requested', 'cancelled')),
  checklist JSONB NOT NULL DEFAULT '[]',          -- [{"item":"Tests pass","done":true}]
  comments TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_review_requests_ticket ON review_requests(ticket_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_review_requests_reviewer ON review_requests(reviewer_id, status);

-- Round-robin pointer per project.
CREATE TABLE IF NOT EXISTS project_review_rotation (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  last_reviewer_id BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Weekly triage rotation among the project's lead + developers (skips OOO and guests).
ALTER TABLE projects ADD COLUMN IF NOT EXISTS triage_rotation BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------- vault: shares show in the audit
ALTER TABLE vault_audit ADD COLUMN IF NOT EXISTS grant_id INTEGER;
ALTER TABLE vault_audit DROP CONSTRAINT IF EXISTS vault_audit_action_check;
ALTER TABLE vault_audit ADD CONSTRAINT vault_audit_action_check
  CHECK (action IN ('create', 'update', 'delete', 'reveal', 'copy', 'download', 'import', 'break_glass', 'share', 'share_revoked', 'share_approved'));

COMMIT;
