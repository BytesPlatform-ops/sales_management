-- =============================================
-- DIALER LEADS SYSTEM
-- Does NOT touch existing 'leads' table
-- =============================================

-- Call outcome enum
DO $$ BEGIN
    CREATE TYPE call_outcome AS ENUM (
        'pending',
        'interested',
        'not_interested',
        'voicemail',
        'busy',
        'gatekeeper',
        'owner_picked',
        'callback',
        'bad_number',
        'dnc'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Tracks each CSV upload batch
CREATE TABLE IF NOT EXISTS lead_upload_batches (
    id SERIAL PRIMARY KEY,
    file_name VARCHAR(255) NOT NULL,
    total_leads INTEGER NOT NULL DEFAULT 0,
    uploaded_by INTEGER REFERENCES users(id),
    leads_per_agent INTEGER DEFAULT 200,
    distributed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Main dialer leads table
CREATE TABLE IF NOT EXISTS dialer_leads (
    id SERIAL PRIMARY KEY,

    -- Core fields (present in every CSV)
    firm_name VARCHAR(500),
    contact_person VARCHAR(255),
    phone_number VARCHAR(50) NOT NULL,

    -- All CSV columns stored as JSON (flexible for any CSV format)
    raw_data JSONB NOT NULL DEFAULT '{}',

    -- AI Generated (GPT) - the card agents see
    what_to_offer JSONB,            -- ["Website", "Local SEO", "Google Business"]
    talking_points JSONB,           -- ["No website found...", "47 reviews but..."]
    ai_generated BOOLEAN DEFAULT FALSE,

    -- Assignment & Status
    assigned_agent_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    batch_id INTEGER REFERENCES lead_upload_batches(id) ON DELETE SET NULL,
    call_outcome call_outcome DEFAULT 'pending',
    call_notes TEXT,

    -- Call tracking
    last_called_at TIMESTAMP WITH TIME ZONE,
    call_count INTEGER DEFAULT 0,
    next_callback_at TIMESTAMP WITH TIME ZONE,

    -- Daily distribution
    assigned_date DATE,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_dl_agent ON dialer_leads(assigned_agent_id);
CREATE INDEX IF NOT EXISTS idx_dl_outcome ON dialer_leads(call_outcome);
CREATE INDEX IF NOT EXISTS idx_dl_agent_outcome ON dialer_leads(assigned_agent_id, call_outcome);
CREATE INDEX IF NOT EXISTS idx_dl_agent_date ON dialer_leads(assigned_agent_id, assigned_date);
CREATE INDEX IF NOT EXISTS idx_dl_batch ON dialer_leads(batch_id);
CREATE INDEX IF NOT EXISTS idx_dl_phone ON dialer_leads(phone_number);
CREATE INDEX IF NOT EXISTS idx_dl_raw_data ON dialer_leads USING GIN(raw_data);

-- =============================================
-- POOL & PIPELINE COLUMNS (added post-launch)
-- =============================================
ALTER TABLE dialer_leads ADD COLUMN IF NOT EXISTS pool VARCHAR(50) DEFAULT 'fresh';
ALTER TABLE dialer_leads ADD COLUMN IF NOT EXISTS max_attempts INTEGER DEFAULT 3;
ALTER TABLE dialer_leads ADD COLUMN IF NOT EXISTS recycle_after_days INTEGER DEFAULT 15;
ALTER TABLE dialer_leads ADD COLUMN IF NOT EXISTS last_outcome_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE dialer_leads ADD COLUMN IF NOT EXISTS previous_agents JSONB DEFAULT '[]';
ALTER TABLE dialer_leads ADD COLUMN IF NOT EXISTS call_outcomes JSONB;
ALTER TABLE dialer_leads ADD COLUMN IF NOT EXISTS pipeline_stage VARCHAR(50);
ALTER TABLE dialer_leads ADD COLUMN IF NOT EXISTS follow_up_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE dialer_leads ADD COLUMN IF NOT EXISTS deal_value DECIMAL(12, 2);
ALTER TABLE dialer_leads ADD COLUMN IF NOT EXISTS pipeline_notes TEXT;

-- Pipeline indexes
CREATE INDEX IF NOT EXISTS idx_dl_pool ON dialer_leads(pool);
CREATE INDEX IF NOT EXISTS idx_dl_pipeline ON dialer_leads(pool, pipeline_stage);
CREATE INDEX IF NOT EXISTS idx_dl_follow_up ON dialer_leads(follow_up_at) WHERE follow_up_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dl_agent_pipeline ON dialer_leads(assigned_agent_id, pool, pipeline_stage);

-- =============================================
-- DISTRIBUTION SETTINGS (auto-distribution config)
-- =============================================
CREATE TABLE IF NOT EXISTS distribution_settings (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- single row only
    leads_per_agent INTEGER DEFAULT 200,
    auto_distribute_enabled BOOLEAN DEFAULT FALSE,
    auto_distribute_time VARCHAR(5) DEFAULT '19:00',   -- PKT time (24h format)
    cron_secret VARCHAR(255),                          -- secret key for cron endpoint
    last_auto_distributed_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Insert default settings row if not exists
INSERT INTO distribution_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
