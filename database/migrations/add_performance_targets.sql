-- Editable daily performance targets per employment type
-- Replaces the hardcoded DAILY_TARGETS constants so HR can tune them from the portal.

CREATE TABLE IF NOT EXISTS performance_targets (
  employment_type VARCHAR(20) PRIMARY KEY CHECK (employment_type IN ('full_time', 'part_time')),
  calls_target INTEGER NOT NULL CHECK (calls_target > 0),
  talk_time_seconds INTEGER NOT NULL CHECK (talk_time_seconds > 0),
  leads_target INTEGER NOT NULL CHECK (leads_target >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(100)
);

-- Seed with the current hardcoded values
INSERT INTO performance_targets (employment_type, calls_target, talk_time_seconds, leads_target)
VALUES
  ('full_time', 150, 3600, 3),
  ('part_time', 75, 1800, 2)
ON CONFLICT (employment_type) DO NOTHING;
