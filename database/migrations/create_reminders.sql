-- Reminders: manual ("Remind me about this") and automatic (client content pending,
-- unanswered clarification, meeting without notes, recurring cycle renewing).
-- Delivered by the in-app runner (lib/reminders/runner.ts) under a job lock; a
-- reminder fires exactly once per occurrence (fired_for = the due time it fired for).
--
-- Additive and idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS reminders (
  id SERIAL PRIMARY KEY,
  entity_type VARCHAR(20) NOT NULL DEFAULT 'none'
    CHECK (entity_type IN ('none', 'project', 'brief_entry', 'ticket', 'meeting', 'message')),
  entity_id VARCHAR(40),
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  note TEXT,
  due_at TIMESTAMPTZ NOT NULL,
  repeat_rule VARCHAR(10) NOT NULL DEFAULT 'none' CHECK (repeat_rule IN ('none', 'daily', 'weekly', 'monthly')),
  -- monthly repeats keep this day of month (clamped to short months)
  repeat_day SMALLINT,
  assigned_to BIGINT NOT NULL,
  created_by BIGINT,                                    -- NULL = automatic
  status VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'cancelled')),
  snoozed_until TIMESTAMPTZ,
  -- the occurrence that already fired (due_at or snoozed_until at the time); never fires twice for it
  fired_for TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  last_fired_at TIMESTAMPTZ,
  fire_count INTEGER NOT NULL DEFAULT 0,
  auto_kind VARCHAR(40)
    CHECK (auto_kind IS NULL OR auto_kind IN ('client_content_pending', 'clarification_unanswered', 'meeting_notes_missing', 'cycle_renewal')),
  auto_key VARCHAR(120) UNIQUE,
  email BOOLEAN NOT NULL DEFAULT false,
  done_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  search tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(note, ''))) STORED
);
-- The runner's scan: open reminders by their effective due time.
CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders ((COALESCE(snoozed_until, due_at))) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_reminders_assignee ON reminders (assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_reminders_entity ON reminders (entity_type, entity_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_reminders_search ON reminders USING GIN (search);

-- Automatic reminders per project (defaults apply when there is no row).
CREATE TABLE IF NOT EXISTS project_reminder_settings (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  client_content_enabled BOOLEAN NOT NULL DEFAULT true,
  client_content_days INTEGER NOT NULL DEFAULT 3 CHECK (client_content_days BETWEEN 1 AND 60),
  clarification_enabled BOOLEAN NOT NULL DEFAULT true,
  clarification_hours INTEGER NOT NULL DEFAULT 24 CHECK (clarification_hours BETWEEN 1 AND 720),
  meeting_notes_enabled BOOLEAN NOT NULL DEFAULT true,
  meeting_notes_hours INTEGER NOT NULL DEFAULT 2 CHECK (meeting_notes_hours BETWEEN 1 AND 168),
  cycle_renewal_enabled BOOLEAN NOT NULL DEFAULT true,
  cycle_renewal_days INTEGER NOT NULL DEFAULT 7 CHECK (cycle_renewal_days BETWEEN 1 AND 60),
  updated_by BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMIT;
