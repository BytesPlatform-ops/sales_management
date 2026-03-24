-- =============================================
-- TIMEZONE-BASED LEAD ROUTING
-- Adds state column for time-based lead serving
-- =============================================

-- Add state to dialer_leads (FL, TX, CA)
ALTER TABLE dialer_leads ADD COLUMN IF NOT EXISTS state VARCHAR(2);

-- Add state to batches (entire batch tagged with one state)
ALTER TABLE lead_upload_batches ADD COLUMN IF NOT EXISTS state VARCHAR(2);

-- Index for fast state-based lookups during routing
CREATE INDEX IF NOT EXISTS idx_dl_state ON dialer_leads(state);
CREATE INDEX IF NOT EXISTS idx_dl_state_pool ON dialer_leads(state, pool, call_outcome);
CREATE INDEX IF NOT EXISTS idx_dl_agent_state ON dialer_leads(assigned_agent_id, state, call_outcome);

COMMENT ON COLUMN dialer_leads.state IS 'US state code (FL, TX, CA) for timezone-based routing';
COMMENT ON COLUMN lead_upload_batches.state IS 'US state code for all leads in this batch';
