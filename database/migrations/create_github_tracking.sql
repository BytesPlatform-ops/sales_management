-- Phase 7: GitHub auto-tracking, manual work updates, project health and activity.
--
--   project_repos     1 project = 1 repo (in our GitHub org)
--   repo_access       who we gave repo access to, so membership changes can be reconciled
--   github_events     raw webhook deliveries (idempotent by delivery id), processed async
--   project_activity  plain-language feed ("Ali merged: Login page"), idempotent by source_id
--   work_updates      manual tracking for projects without GitHub (WordPress, Shopify, design…)
--   developer_github  a developer's linked GitHub account
--
-- Additive and idempotent.

BEGIN;

-- ---------------------------------------------------------------- projects
ALTER TABLE projects ADD COLUMN IF NOT EXISTS tracking_source VARCHAR(10) NOT NULL DEFAULT 'manual';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS health VARCHAR(10) NOT NULL DEFAULT 'green';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS health_changed_at TIMESTAMPTZ;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS production_env_name VARCHAR(60) NOT NULL DEFAULT 'Production';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS staging_url TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS ready_to_deliver_at TIMESTAMPTZ;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_tracking_source_check') THEN
    ALTER TABLE projects ADD CONSTRAINT projects_tracking_source_check CHECK (tracking_source IN ('github', 'manual'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_health_check') THEN
    ALTER TABLE projects ADD CONSTRAINT projects_health_check CHECK (health IN ('green', 'yellow', 'red'));
  END IF;
END
$$;
CREATE INDEX IF NOT EXISTS idx_projects_health ON projects(health);

-- ---------------------------------------------------------------- GitHub identity
CREATE TABLE IF NOT EXISTS developer_github (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  github_user_id BIGINT NOT NULL UNIQUE,         -- stable id; logins can be renamed
  github_login VARCHAR(39) NOT NULL,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_developer_github_login ON developer_github(LOWER(github_login));

-- ---------------------------------------------------------------- repos
CREATE TABLE IF NOT EXISTS project_repos (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  github_repo_id BIGINT NOT NULL UNIQUE,
  full_name VARCHAR(200) NOT NULL,               -- org/PRJ-0012-acme-dental
  html_url TEXT,
  default_branch VARCHAR(100) NOT NULL DEFAULT 'main',
  created_by BIGINT NOT NULL,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS repo_access (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL,
  github_login VARCHAR(39) NOT NULL,
  permission VARCHAR(10) NOT NULL CHECK (permission IN ('push', 'pull')),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, user_id)
);

-- ---------------------------------------------------------------- webhook deliveries
CREATE TABLE IF NOT EXISTS github_events (
  delivery_id VARCHAR(80) PRIMARY KEY,           -- X-GitHub-Delivery
  event VARCHAR(40) NOT NULL,
  action VARCHAR(40),
  repo_id BIGINT,
  payload JSONB NOT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed', 'ignored')),
  attempts SMALLINT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  error TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_github_events_queue ON github_events(next_attempt_at) WHERE status = 'pending';

-- ---------------------------------------------------------------- activity feed
CREATE TABLE IF NOT EXISTS project_activity (
  id BIGSERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  ticket_id INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
  actor_user_id BIGINT,
  github_login VARCHAR(39),
  kind VARCHAR(30) NOT NULL,                     -- push, branch, pr_opened, pr_merged, deploy_staging, deploy_production, work_update, ticket_done…
  summary TEXT NOT NULL,                         -- plain language, no code jargon
  url TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source VARCHAR(20) NOT NULL,                   -- github | manual | app
  source_id VARCHAR(200) UNIQUE                  -- idempotency (delivery id + part)
);
CREATE INDEX IF NOT EXISTS idx_project_activity_project ON project_activity(project_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_activity_ticket ON project_activity(ticket_id, occurred_at DESC) WHERE ticket_id IS NOT NULL;

-- ---------------------------------------------------------------- manual tracking
CREATE TABLE IF NOT EXISTS work_updates (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL,
  body TEXT NOT NULL,
  ticket_ids INTEGER[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_work_updates_project ON work_updates(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_updates_user ON work_updates(user_id, created_at DESC);

-- Ticket history: who/what made a change when no user did (GitHub, automation).
ALTER TABLE ticket_history ADD COLUMN IF NOT EXISTS source VARCHAR(20);

COMMIT;
