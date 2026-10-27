-- Phase B — tickets (with epics, subtasks, triage, relations,
-- templates) and media uploads. Designed so later phases (brief timeline, chat media,
-- cycles, time tracking, search) add tables without reshaping these.
--
-- Additive and idempotent. Existing tables only gain nullable/defaulted columns.

BEGIN;

-- ---------------------------------------------------------------- projects: ticket counter + triage owner
ALTER TABLE projects ADD COLUMN IF NOT EXISTS next_ticket_no INTEGER NOT NULL DEFAULT 1;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS triage_owner_id BIGINT;          -- default: the project's lead developer
ALTER TABLE projects ADD COLUMN IF NOT EXISTS template_id INTEGER;             -- project template it was created from

-- ---------------------------------------------------------------- epics (phases)
CREATE TABLE IF NOT EXISTS epics (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  color VARCHAR(7) NOT NULL DEFAULT '#6366f1',
  owner_id BIGINT,
  target_date DATE,
  status VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'archived')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_epics_project ON epics(project_id, sort_order);

-- ---------------------------------------------------------------- tickets
-- Flow: triage → open → in_progress → in_review → in_qa (optional) → done → closed;
-- declined from triage. "Blocked" is a badge derived from open 'blocks' relations.
CREATE TABLE IF NOT EXISTS tickets (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,                                   -- T5
  key VARCHAR(30) NOT NULL UNIQUE,                           -- PRJ-0012-T5
  epic_id INTEGER REFERENCES epics(id) ON DELETE SET NULL,
  parent_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE, -- subtasks (one level)
  type VARCHAR(20) NOT NULL DEFAULT 'task'
    CHECK (type IN ('feature', 'bug', 'task', 'change_request', 'content', 'qa', 'spike', 'question')),
  title VARCHAR(300) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  priority VARCHAR(10) NOT NULL DEFAULT 'normal' CHECK (priority IN ('urgent', 'high', 'normal', 'low')),
  status VARCHAR(20) NOT NULL DEFAULT 'triage'
    CHECK (status IN ('triage', 'open', 'in_progress', 'in_review', 'in_qa', 'done', 'closed', 'declined')),

  -- triage
  triage_state VARCHAR(20) CHECK (triage_state IN ('need_info', 'snoozed')),
  triage_due_at TIMESTAMPTZ,                                 -- SLA deadline to leave triage
  snoozed_until TIMESTAMPTZ,
  decline_reason TEXT,
  duplicate_of INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
  accepted_by BIGINT,
  accepted_at TIMESTAMPTZ,

  -- change requests: HR approval gates In progress; approval may move the project deadline
  cr_status VARCHAR(10) CHECK (cr_status IN ('pending', 'approved', 'rejected')),
  cr_decided_by BIGINT,
  cr_decided_at TIMESTAMPTZ,
  cr_new_deadline DATE,

  estimate_hours NUMERIC(6,2),
  start_date DATE,
  due_date DATE,
  rank TEXT NOT NULL DEFAULT 'm' COLLATE "C",               -- backlog order (fractional index, byte order)
  created_by BIGINT NOT NULL,
  created_via VARCHAR(20) NOT NULL DEFAULT 'manual'
    CHECK (created_via IN ('manual', 'brief', 'meeting', 'template', 'client_link', 'import', 'recurring')),
  done_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  search tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(key, '') || ' ' || coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) STORED,
  UNIQUE (project_id, number)
);
CREATE INDEX IF NOT EXISTS idx_tickets_project_status ON tickets(project_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_epic ON tickets(epic_id);
CREATE INDEX IF NOT EXISTS idx_tickets_parent ON tickets(parent_id);
CREATE INDEX IF NOT EXISTS idx_tickets_due ON tickets(due_date) WHERE deleted_at IS NULL AND status NOT IN ('done', 'closed', 'declined');
CREATE INDEX IF NOT EXISTS idx_tickets_triage_due ON tickets(triage_due_at) WHERE status = 'triage';
CREATE INDEX IF NOT EXISTS idx_tickets_search ON tickets USING GIN (search);

CREATE TABLE IF NOT EXISTS ticket_assignees (
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL,
  assigned_by BIGINT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (ticket_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_ticket_assignees_user ON ticket_assignees(user_id);

CREATE TABLE IF NOT EXISTS ticket_watchers (
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL,
  reason VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (reason IN ('manual', 'creator', 'assignee', 'commenter', 'mention')),
  PRIMARY KEY (ticket_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_ticket_watchers_user ON ticket_watchers(user_id);

CREATE TABLE IF NOT EXISTS ticket_checklist_items (
  id SERIAL PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  body VARCHAR(500) NOT NULL,
  done BOOLEAN NOT NULL DEFAULT false,
  done_by BIGINT,
  done_at TIMESTAMPTZ,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_checklist_ticket ON ticket_checklist_items(ticket_id, sort_order);

CREATE TABLE IF NOT EXISTS labels (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,   -- NULL = company-wide
  name VARCHAR(50) NOT NULL,
  color VARCHAR(7) NOT NULL DEFAULT '#64748b'
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_labels_name ON labels(COALESCE(project_id, 0), LOWER(name));

CREATE TABLE IF NOT EXISTS ticket_labels (
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  label_id INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (ticket_id, label_id)
);

-- blocks / relates_to / duplicate_of. Parent/child lives on tickets.parent_id.
-- "A blocks B" is stored once (from=A, to=B); "blocked by" is the reverse read.
CREATE TABLE IF NOT EXISTS ticket_relations (
  id SERIAL PRIMARY KEY,
  from_ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  to_ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('blocks', 'relates_to', 'duplicate_of')),
  created_by BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (from_ticket_id <> to_ticket_id),
  UNIQUE (from_ticket_id, to_ticket_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_relations_to ON ticket_relations(to_ticket_id, kind);

CREATE TABLE IF NOT EXISTS ticket_comments (
  id SERIAL PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL,
  body TEXT NOT NULL,
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  search tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(body, ''))) STORED
);
CREATE INDEX IF NOT EXISTS idx_ticket_comments_ticket ON ticket_comments(ticket_id, id);
CREATE INDEX IF NOT EXISTS idx_ticket_comments_search ON ticket_comments USING GIN (search);

-- Every field change, automatic. Also feeds "undo last action".
CREATE TABLE IF NOT EXISTS ticket_history (
  id BIGSERIAL PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id BIGINT,                                            -- NULL = system (GitHub, automation)
  field VARCHAR(40) NOT NULL,
  old_value JSONB,
  new_value JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ticket_history_ticket ON ticket_history(ticket_id, id DESC);

CREATE TABLE IF NOT EXISTS triage_events (
  id SERIAL PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL,
  action VARCHAR(20) NOT NULL CHECK (action IN ('accept', 'merge', 'need_info', 'info_given', 'decline', 'snooze', 'reopen')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_triage_events_ticket ON triage_events(ticket_id, id);

CREATE TABLE IF NOT EXISTS sla_policies (
  priority VARCHAR(10) PRIMARY KEY CHECK (priority IN ('urgent', 'high', 'normal', 'low')),
  triage_hours INTEGER NOT NULL
);
INSERT INTO sla_policies (priority, triage_hours) VALUES ('urgent', 4), ('high', 24), ('normal', 72), ('low', 168)
ON CONFLICT (priority) DO NOTHING;

-- ---------------------------------------------------------------- templates
CREATE TABLE IF NOT EXISTS ticket_templates (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,   -- NULL = company-wide
  name VARCHAR(100) NOT NULL,
  type VARCHAR(20) NOT NULL,
  title_prefix VARCHAR(100) NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',                       -- prefilled sections
  checklist JSONB NOT NULL DEFAULT '[]',                      -- ["Tested on mobile", …]
  require_attachment BOOLEAN NOT NULL DEFAULT false,          -- bug report: screenshot/recording
  created_by BIGINT,                                          -- NULL = built-in
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS project_templates (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  service_type VARCHAR(30),                                   -- matches projects.service_type
  description TEXT NOT NULL DEFAULT '',
  -- {epics:[{title,color,tickets:[{title,type,checklist}]}], milestones:[{title,offset_days}],
  --  vault_placeholders:[{environment,key,note}]}
  body JSONB NOT NULL DEFAULT '{}',
  created_by BIGINT,                                          -- NULL = built-in
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------- media (polymorphic)
-- Files go browser → private Supabase Storage bucket via a signed upload URL;
-- this row is created 'pending' first and flipped to 'ready' once the object exists.
CREATE TABLE IF NOT EXISTS media_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE, -- access follows the project
  entity_type VARCHAR(20) NOT NULL
    CHECK (entity_type IN ('project', 'ticket', 'ticket_comment', 'work_update', 'meeting', 'brief_entry', 'message', 'channel_message', 'doc', 'asset')),
  entity_id VARCHAR(40) NOT NULL,
  storage_path TEXT NOT NULL UNIQUE,
  file_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(150) NOT NULL,
  size_bytes BIGINT NOT NULL,
  description TEXT,
  kind VARCHAR(10) NOT NULL DEFAULT 'file' CHECK (kind IN ('image', 'video', 'audio', 'pdf', 'file', 'voice', 'screen')),
  status VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready')),
  uploaded_by BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ,                                     -- soft delete, restorable 30 days
  deleted_by BIGINT,
  search tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(file_name, '') || ' ' || coalesce(description, ''))) STORED
);
CREATE INDEX IF NOT EXISTS idx_media_entity ON media_files(entity_type, entity_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_media_project ON media_files(project_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_media_search ON media_files USING GIN (search);

-- ---------------------------------------------------------------- built-in templates
INSERT INTO ticket_templates (name, type, title_prefix, description, checklist, require_attachment)
SELECT * FROM (VALUES
  ('Bug report', 'bug', 'Bug: ',
   E'**Steps to reproduce**\n1. \n2. \n\n**Expected**\n\n**Actual**\n\n**Page / URL**\n\n**Browser / device**\n',
   '["Reproduced on staging", "Fix verified on the same device"]'::jsonb, true),
  ('Feature', 'feature', '',
   E'**User story**\nAs a … I want … so that …\n\n**Design links**\n\n**Notes**\n',
   '["Acceptance criteria agreed with the agent", "Works on mobile", "Works on desktop"]'::jsonb, false),
  ('QA pass', 'qa', 'QA: ',
   E'**Staging URL**\n\n**What to test**\n',
   '["Forms submit and send email", "Mobile layout", "Page speed checked", "No console errors", "Links and buttons work"]'::jsonb, false)
) AS v(name, type, title_prefix, description, checklist, require_attachment)
WHERE NOT EXISTS (SELECT 1 FROM ticket_templates WHERE created_by IS NULL);

INSERT INTO project_templates (name, service_type, description, body)
SELECT * FROM (VALUES
  ('WordPress site', 'website_new', 'Theme, pages, forms, SEO basics, launch.', $j${
    "epics": [
      {"title": "Setup", "color": "#0ea5e9", "tickets": [
        {"title": "Hosting, domain and WordPress install", "type": "task"},
        {"title": "Theme and core plugins", "type": "task"}]},
      {"title": "Build", "color": "#6366f1", "tickets": [
        {"title": "Home page", "type": "feature"},
        {"title": "Inner pages", "type": "feature"},
        {"title": "Contact form and email delivery", "type": "feature"}]},
      {"title": "Launch", "color": "#10b981", "tickets": [
        {"title": "QA pass on staging", "type": "qa"},
        {"title": "Go live and DNS", "type": "task"}]}],
    "milestones": [{"title": "Design approved", "offset_days": 7}, {"title": "Launch", "offset_days": 21}],
    "vault_placeholders": [
      {"environment": "production", "key": "WP_ADMIN_LOGIN", "note": "Waiting on client"},
      {"environment": "production", "key": "HOSTING_LOGIN", "note": "Waiting on client"}]
  }$j$::jsonb),
  ('Shopify store', 'website_new', 'Theme setup, products, payments, launch.', $j${
    "epics": [
      {"title": "Store setup", "color": "#0ea5e9", "tickets": [
        {"title": "Theme install and branding", "type": "task"},
        {"title": "Payments and shipping", "type": "task"}]},
      {"title": "Catalogue", "color": "#6366f1", "tickets": [
        {"title": "Product import", "type": "content"},
        {"title": "Collections and navigation", "type": "feature"}]},
      {"title": "Launch", "color": "#10b981", "tickets": [
        {"title": "Test orders", "type": "qa"},
        {"title": "Go live", "type": "task"}]}],
    "milestones": [{"title": "Store ready for review", "offset_days": 14}],
    "vault_placeholders": [{"environment": "production", "key": "SHOPIFY_STAFF_LOGIN", "note": "Waiting on client"}]
  }$j$::jsonb),
  ('Web app', 'automation', 'Custom build with dev/staging/production.', $j${
    "epics": [
      {"title": "Foundation", "color": "#0ea5e9", "tickets": [
        {"title": "Repo, CI and environments", "type": "task"},
        {"title": "Auth", "type": "feature"}]},
      {"title": "Core features", "color": "#6366f1", "tickets": []},
      {"title": "Release", "color": "#10b981", "tickets": [
        {"title": "QA pass", "type": "qa"},
        {"title": "Production deploy", "type": "task"}]}],
    "milestones": [],
    "vault_placeholders": [
      {"environment": "development", "key": "DATABASE_URL", "note": ""},
      {"environment": "production", "key": "DATABASE_URL", "note": "Lead dev only"}]
  }$j$::jsonb),
  ('SEO', 'seo', 'Audit, on-page, content, reporting.', $j${
    "epics": [
      {"title": "Audit", "color": "#0ea5e9", "tickets": [
        {"title": "Technical SEO audit", "type": "task"},
        {"title": "Keyword research", "type": "task"}]},
      {"title": "On-page", "color": "#6366f1", "tickets": [
        {"title": "Titles and meta descriptions", "type": "task"},
        {"title": "Google Business Profile", "type": "task"}]}],
    "milestones": [{"title": "Audit delivered", "offset_days": 10}],
    "vault_placeholders": [{"environment": "production", "key": "GOOGLE_SEARCH_CONSOLE_ACCESS", "note": "Waiting on client"}]
  }$j$::jsonb),
  ('Monthly maintenance', 'other', 'Updates, backups, uptime, small changes.', $j${
    "epics": [{"title": "This month", "color": "#0ea5e9", "tickets": [
      {"title": "Plugin/theme updates", "type": "task"},
      {"title": "Backup check", "type": "task"},
      {"title": "Uptime and speed check", "type": "qa"}]}],
    "milestones": [],
    "vault_placeholders": []
  }$j$::jsonb)
) AS v(name, service_type, description, body)
WHERE NOT EXISTS (SELECT 1 FROM project_templates WHERE created_by IS NULL);

COMMIT;
