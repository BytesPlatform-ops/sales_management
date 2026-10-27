-- Project Env: encrypted .env values per project, shared with the project's
-- developers, plus job_locks so 2+ web instances never run a background job twice.
--
-- Values are AES-256-GCM encrypted in the app (lib/vault). Each project has its
-- own data key, itself encrypted with VAULT_MASTER_KEY, which lives only in the
-- Render environment. The database never sees a plain value or the master key.
--
-- Additive and idempotent. No existing table changes.

BEGIN;

-- ---------------------------------------------------------------- job leases
CREATE TABLE IF NOT EXISTS job_locks (
  name VARCHAR(100) PRIMARY KEY,
  locked_until TIMESTAMPTZ NOT NULL DEFAULT 'epoch',
  locked_by VARCHAR(100),                 -- hostname:pid of the holder
  last_run_at TIMESTAMPTZ
);

-- ---------------------------------------------------------------- vault
-- One data key per project, wrapped (encrypted) with the master key.
CREATE TABLE IF NOT EXISTS vault_project_keys (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  enc_key BYTEA NOT NULL,
  iv BYTEA NOT NULL,
  tag BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vault_secrets (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  environment VARCHAR(20) NOT NULL CHECK (environment IN ('development', 'staging', 'production')),
  key_name VARCHAR(200) NOT NULL,
  ciphertext BYTEA NOT NULL,
  iv BYTEA NOT NULL,
  tag BYTEA NOT NULL,
  note TEXT,                              -- not encrypted: a hint, never the value
  created_by BIGINT NOT NULL,
  updated_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (project_id, environment, key_name)
);

-- Who touched which secret. Never holds a value.
CREATE TABLE IF NOT EXISTS vault_audit (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  project_id INTEGER NOT NULL,
  secret_id INTEGER,                      -- NULL for whole-file download/import
  key_name VARCHAR(200),                  -- kept so the log still reads after a delete
  environment VARCHAR(20),
  action VARCHAR(20) NOT NULL CHECK (action IN ('create', 'update', 'delete', 'reveal', 'copy', 'download', 'import')),
  ip VARCHAR(64),
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_vault_audit_project ON vault_audit(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vault_audit_user ON vault_audit(user_id, created_at DESC);

COMMIT;
