-- Projects & ticketing: an agent's converted client becomes a ticket/project
-- with a chat thread, assigned developers, a supervisor (HR), deadlines, a
-- milestone timeline, client meetings, and one-time or recurring delivery.
--
-- Additive and idempotent. The only change to an existing object is widening
-- users_role_check to allow the new 'developer' role (no existing row changes).

BEGIN;

-- ---------------------------------------------------------------- roles
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK ((role)::text = ANY ((ARRAY['hr'::character varying, 'agent'::character varying, 'developer'::character varying])::text[]));

-- ---------------------------------------------------------------- projects
CREATE SEQUENCE IF NOT EXISTS project_ticket_seq START 1;

CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  ticket_no VARCHAR(20) NOT NULL UNIQUE DEFAULT ('PRJ-' || LPAD(nextval('project_ticket_seq')::text, 4, '0')),
  title VARCHAR(200) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  service_type VARCHAR(30) NOT NULL DEFAULT 'other'
    CHECK (service_type IN ('website_new', 'revamp', 'seo', 'smm', 'automation', 'contract_mgmt', 'other')),
  priority VARCHAR(10) NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  -- new → in_progress → review → delivered → closed; on_hold / cancelled at any point
  status VARCHAR(20) NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'in_progress', 'review', 'delivered', 'on_hold', 'closed', 'cancelled')),
  project_type VARCHAR(20) NOT NULL DEFAULT 'one_time' CHECK (project_type IN ('one_time', 'recurring')),
  recurrence VARCHAR(20) CHECK (recurrence IN ('weekly', 'monthly', 'quarterly')),
  recurrence_end DATE,

  -- client
  client_name VARCHAR(200) NOT NULL,
  client_company VARCHAR(200),
  client_email VARCHAR(200),
  client_phone VARCHAR(50),
  client_timezone VARCHAR(50) DEFAULT 'America/New_York',

  -- money
  deal_value NUMERIC(12,2),

  -- where it came from
  source VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'lead', 'sale')),
  lead_id INTEGER,                        -- dialer_leads.id
  sale_id INTEGER,                        -- sales.id

  -- people
  created_by BIGINT NOT NULL,             -- agent (or HR) who opened the ticket
  supervisor_id BIGINT,                   -- HR user responsible

  -- dates (the "calendar path")
  start_date DATE,                        -- work starts
  deadline DATE,                          -- internal deadline for the team
  expected_delivery DATE,                 -- promised to the client
  delivered_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_created_by ON projects(created_by);
CREATE INDEX IF NOT EXISTS idx_projects_deadline ON projects(deadline);

-- Developers (and anyone else) working on the project
CREATE TABLE IF NOT EXISTS project_members (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL,
  member_role VARCHAR(20) NOT NULL DEFAULT 'developer' CHECK (member_role IN ('developer', 'lead_developer', 'watcher')),
  added_by BIGINT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_pm_user ON project_members(user_id);

-- Timeline: milestones between start and deadline
CREATE TABLE IF NOT EXISTS project_milestones (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  cycle_id INTEGER,                       -- recurring projects: which cycle
  title VARCHAR(200) NOT NULL,
  description TEXT,
  start_date DATE,
  due_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'done')),
  assignee_id BIGINT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_pms_project ON project_milestones(project_id, due_date);

-- Meetings with the client (or internal)
CREATE TABLE IF NOT EXISTS project_meetings (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  kind VARCHAR(20) NOT NULL DEFAULT 'client' CHECK (kind IN ('client', 'internal')),
  starts_at TIMESTAMPTZ NOT NULL,
  duration_min INTEGER NOT NULL DEFAULT 30,
  location TEXT,                          -- Zoom/Meet link or phone
  agenda TEXT,
  outcome TEXT,                           -- notes after the meeting
  status VARCHAR(20) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'done', 'cancelled')),
  created_by BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_pmt_project ON project_meetings(project_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_pmt_starts ON project_meetings(starts_at);

-- Recurring projects: one row per delivery period
CREATE TABLE IF NOT EXISTS project_cycles (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  cycle_no INTEGER NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  deadline DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'delivered', 'skipped')),
  delivered_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (project_id, cycle_no)
);

-- The ticket thread (chat). kind 'system' = automatic entries (status changes etc.)
CREATE TABLE IF NOT EXISTS project_messages (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id BIGINT,
  kind VARCHAR(10) NOT NULL DEFAULT 'message' CHECK (kind IN ('message', 'system')),
  body TEXT NOT NULL,
  reply_to INTEGER REFERENCES project_messages(id) ON DELETE SET NULL,
  edited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_pmsg_project ON project_messages(project_id, id);

-- Unread tracking per user
CREATE TABLE IF NOT EXISTS project_reads (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL,
  last_read_message_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, user_id)
);

COMMIT;
