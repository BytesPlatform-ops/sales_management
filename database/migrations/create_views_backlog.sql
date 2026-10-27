-- Phase 2: board settings (WIP limits) and saved views.
-- Additive and idempotent. No existing table changes.

BEGIN;

-- Per-project board settings. wip_limits = {"in_progress": 5, "in_review": 3}; missing = no limit.
-- Limits only warn (column header turns amber/red); they never block a move.
CREATE TABLE IF NOT EXISTS project_board_settings (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  wip_limits JSONB NOT NULL DEFAULT '{}',
  updated_by BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- A filter/group/sort/columns combination someone saved.
--   personal: only the owner sees it.
--   shared:   everyone who can see the project (or, with no project, developers + HR).
-- pinned = listed in the sidebar of everyone who can see the view (owner/HR decide).
CREATE TABLE IF NOT EXISTS saved_views (
  id SERIAL PRIMARY KEY,
  owner_id BIGINT NOT NULL,
  scope VARCHAR(10) NOT NULL DEFAULT 'personal' CHECK (scope IN ('personal', 'shared')),
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  view_type VARCHAR(20) NOT NULL CHECK (view_type IN ('board', 'list', 'backlog', 'calendar', 'my_work')),
  config JSONB NOT NULL DEFAULT '{}',
  pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  search tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(name, ''))) STORED
);
CREATE INDEX IF NOT EXISTS idx_saved_views_owner ON saved_views(owner_id);
CREATE INDEX IF NOT EXISTS idx_saved_views_project ON saved_views(project_id) WHERE scope = 'shared';
CREATE INDEX IF NOT EXISTS idx_saved_views_pinned ON saved_views(pinned) WHERE pinned;
CREATE INDEX IF NOT EXISTS idx_saved_views_search ON saved_views USING GIN (search);

COMMIT;
