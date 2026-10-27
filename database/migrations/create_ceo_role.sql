-- CEO / Executive role: sessions for every login, TOTP 2FA, admin mode audit,
-- sensitive-read log, invites, vault access revocations, privacy settings and
-- one-time staff notices.
--
-- Additive and idempotent. The only change to an existing object is widening
-- users_role_check to allow 'ceo' (no existing row changes).

BEGIN;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK ((role)::text = ANY ((ARRAY['hr'::character varying, 'agent'::character varying, 'developer'::character varying, 'ceo'::character varying])::text[]));

-- ---------------------------------------------------------------- sessions
-- One row per login. The token carries its id (sid); HR and CEO tokens are
-- checked against this table on every request so "sign out everywhere" works.
CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY,
  user_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL,
  ip VARCHAR(64),
  user_agent TEXT,
  device_hash CHAR(64),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id, created_at DESC);

-- ---------------------------------------------------------------- TOTP 2FA
CREATE TABLE IF NOT EXISTS user_totp (
  user_id BIGINT PRIMARY KEY,
  secret_enc BYTEA NOT NULL,              -- AES-256-GCM with VAULT_MASTER_KEY, aad 'totp:<user_id>'
  iv BYTEA NOT NULL,
  tag BYTEA NOT NULL,
  enabled_at TIMESTAMPTZ,                 -- NULL = enrolment started, not confirmed
  last_used_step BIGINT,                  -- a code can never be used twice
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Password OK, waiting for the TOTP code. Single use, 5 attempts, 10 minutes.
CREATE TABLE IF NOT EXISTS auth_challenges (
  id UUID PRIMARY KEY,
  user_id BIGINT NOT NULL,
  remember BOOLEAN NOT NULL DEFAULT false,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------- invites
CREATE TABLE IF NOT EXISTS user_invites (
  id SERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,    -- sha256 of the link token; the token itself is never stored
  created_by BIGINT,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_user_invites_user ON user_invites(user_id);

-- ---------------------------------------------------------------- CEO logs
-- Every write a CEO makes in Admin mode.
CREATE TABLE IF NOT EXISTS ceo_audit_log (
  id BIGSERIAL PRIMARY KEY,
  ceo_id BIGINT NOT NULL,
  method VARCHAR(10) NOT NULL,
  path TEXT NOT NULL,
  target TEXT,
  ip VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ceo_audit_ceo ON ceo_audit_log(ceo_id, created_at DESC);

-- Sensitive things a CEO looked at (vault values, one person's pay, 1:1 notes, DMs, view-as).
CREATE TABLE IF NOT EXISTS ceo_access_log (
  id BIGSERIAL PRIMARY KEY,
  ceo_id BIGINT NOT NULL,
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('vault_reveal', 'payroll_person', 'one_on_one', 'dm', 'view_as')),
  target TEXT NOT NULL,
  reason TEXT,
  ip VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ceo_access_ceo ON ceo_access_log(ceo_id, created_at DESC);

-- ---------------------------------------------------------------- vault
-- Instantly cut someone's Env access (project_id NULL = every project).
CREATE TABLE IF NOT EXISTS vault_access_revocations (
  id SERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  project_id INTEGER,
  reason TEXT,
  revoked_by BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_vault_revocation ON vault_access_revocations(user_id, COALESCE(project_id, 0));

ALTER TABLE vault_audit DROP CONSTRAINT IF EXISTS vault_audit_action_check;
ALTER TABLE vault_audit ADD CONSTRAINT vault_audit_action_check
  CHECK (action IN ('create', 'update', 'delete', 'reveal', 'copy', 'download', 'import', 'break_glass'));
ALTER TABLE vault_audit ADD COLUMN IF NOT EXISTS reason TEXT;

-- ---------------------------------------------------------------- privacy + staff notices
CREATE TABLE IF NOT EXISTS org_settings (
  key VARCHAR(80) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_by BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO org_settings (key, value) VALUES ('workplace_chat_visibility', '{"enabled": false, "effective_at": null}')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS staff_notices (
  id SERIAL PRIMARY KEY,
  kind VARCHAR(40) NOT NULL,
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  published_by BIGINT,
  published_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  effective_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS staff_notice_acks (
  notice_id INTEGER NOT NULL REFERENCES staff_notices(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL,
  acked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (notice_id, user_id)
);

COMMIT;
