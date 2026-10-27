-- Addendum 3, step 1: Sales teams, Sales Leads, lead permissions, lead transfers.
--
-- Leads stay role 'agent'; lead status lives in sales_leads and is read from the
-- database on every request, so Make / Remove Lead takes effect immediately.
--
-- Additive and idempotent.

BEGIN;

-- ---------------------------------------------------------------- teams
CREATE TABLE IF NOT EXISTS sales_teams (
  id SERIAL PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  description TEXT,
  shift_start TIME,                          -- informational; agents keep their own shift
  shift_end TIME,
  created_by BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TIMESTAMPTZ                    -- archived teams keep their history
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_teams_name
  ON sales_teams (LOWER(name)) WHERE archived_at IS NULL;

-- ---------------------------------------------------------------- membership (with history)
CREATE TABLE IF NOT EXISTS sales_team_members (
  id BIGSERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES sales_teams(id),
  user_id BIGINT NOT NULL REFERENCES users(id),
  from_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  to_at TIMESTAMPTZ,                         -- NULL = current membership
  added_by BIGINT REFERENCES users(id),
  removed_by BIGINT REFERENCES users(id),
  reason TEXT,
  CHECK (to_at IS NULL OR to_at >= from_at)
);
-- An agent belongs to exactly one team at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_team_member_current
  ON sales_team_members (user_id) WHERE to_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_team_members_team
  ON sales_team_members (team_id) WHERE to_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_team_members_history
  ON sales_team_members (user_id, from_at DESC);

-- ---------------------------------------------------------------- leads (with history)
CREATE TABLE IF NOT EXISTS sales_leads (
  id BIGSERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES sales_teams(id),
  user_id BIGINT NOT NULL REFERENCES users(id),
  is_co_lead BOOLEAN NOT NULL DEFAULT false,
  permissions JSONB NOT NULL DEFAULT '{
    "schedule_meetings": true,
    "view_team_stats": true,
    "view_team_qa": true,
    "post_announcements": true,
    "manage_team_docs": true,
    "approve_team_sales": false,
    "view_team_pipeline": false
  }'::jsonb,
  assigned_by BIGINT NOT NULL REFERENCES users(id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  assign_reason TEXT,
  removed_at TIMESTAMPTZ,                    -- NULL = current lead
  removed_by BIGINT REFERENCES users(id),
  reason TEXT                                -- removal reason (required by the API)
);
-- One Lead and at most one Co-lead per team at a time; a person holds one role per team.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_lead_current
  ON sales_leads (team_id, is_co_lead) WHERE removed_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_lead_person
  ON sales_leads (team_id, user_id) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sales_leads_user
  ON sales_leads (user_id) WHERE removed_at IS NULL;

-- ---------------------------------------------------------------- transfers on lead removal
-- One row per removal. Later steps (meetings, series, docs folders, action
-- items) move their items to to_user_id and record counts in moved.
CREATE TABLE IF NOT EXISTS sales_lead_transfers (
  id BIGSERIAL PRIMARY KEY,
  sales_lead_id BIGINT NOT NULL REFERENCES sales_leads(id),
  team_id INTEGER NOT NULL REFERENCES sales_teams(id),
  from_user_id BIGINT NOT NULL REFERENCES users(id),
  to_user_id BIGINT NOT NULL REFERENCES users(id),   -- new lead, or an HR user
  moved JSONB NOT NULL DEFAULT '{}'::jsonb,           -- e.g. {"meetings": 4, "action_items": 2}
  transferred_by BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_lead_transfers_team ON sales_lead_transfers (team_id, created_at DESC);

-- ---------------------------------------------------------------- audit
CREATE TABLE IF NOT EXISTS sales_audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor_id BIGINT REFERENCES users(id),
  action VARCHAR(40) NOT NULL,               -- team_created, member_moved, lead_assigned, lead_removed, lead_permissions_changed, …
  team_id INTEGER REFERENCES sales_teams(id),
  subject_user_id BIGINT REFERENCES users(id),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sales_audit_team ON sales_audit_log (team_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_audit_subject ON sales_audit_log (subject_user_id, created_at DESC);

COMMIT;
