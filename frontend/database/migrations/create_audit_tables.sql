-- =====================================================
-- CALL AUDITING (QA) MODULE - PERSISTENT AUDIT TABLES
-- =====================================================
-- This migration creates tables to persist the 15% random
-- sample for each shift day and track verification status.
-- =====================================================

-- Table: daily_audits
-- Tracks the overall audit status for a specific shift day
CREATE TABLE IF NOT EXISTS daily_audits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_date DATE NOT NULL UNIQUE,  -- e.g., '2026-03-02' (the shift START date)
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
    total_calls INTEGER NOT NULL DEFAULT 0,  -- Total valid calls for the shift
    sample_size INTEGER NOT NULL DEFAULT 0,  -- Number of calls in the sample (15%)
    audited_by INTEGER REFERENCES users(id),  -- HR user who completed the audit
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    
    CONSTRAINT valid_completed CHECK (
        (status = 'completed' AND completed_at IS NOT NULL AND audited_by IS NOT NULL)
        OR (status = 'pending')
    )
);

-- Table: audit_items
-- Tracks individual calls selected for each day's audit
CREATE TABLE IF NOT EXISTS audit_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    daily_audit_id UUID NOT NULL REFERENCES daily_audits(id) ON DELETE CASCADE,
    call_log_id INTEGER NOT NULL REFERENCES call_logs(id) ON DELETE CASCADE,
    sample_index INTEGER NOT NULL,  -- Position in the sample (1, 2, 3, etc.)
    rec_id VARCHAR(50),  -- 3CX recording ID (cached for quick access)
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    verified_at TIMESTAMP WITH TIME ZONE,
    verified_by INTEGER REFERENCES users(id),
    notes TEXT,  -- Optional HR notes about the call
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    CONSTRAINT unique_call_per_audit UNIQUE (daily_audit_id, call_log_id),
    CONSTRAINT valid_verified CHECK (
        (is_verified = TRUE AND verified_at IS NOT NULL)
        OR (is_verified = FALSE AND verified_at IS NULL)
    )
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_daily_audits_shift_date ON daily_audits(shift_date);
CREATE INDEX IF NOT EXISTS idx_daily_audits_status ON daily_audits(status);
CREATE INDEX IF NOT EXISTS idx_audit_items_daily_audit_id ON audit_items(daily_audit_id);
CREATE INDEX IF NOT EXISTS idx_audit_items_call_log_id ON audit_items(call_log_id);
CREATE INDEX IF NOT EXISTS idx_audit_items_is_verified ON audit_items(is_verified);

-- =====================================================
-- SAMPLE QUERIES
-- =====================================================

-- Check if audit exists for a shift date:
-- SELECT * FROM daily_audits WHERE shift_date = '2026-03-02';

-- Get all audit items with call details for a shift:
-- SELECT 
--     ai.id as audit_item_id,
--     ai.sample_index,
--     ai.is_verified,
--     ai.verified_at,
--     ai.rec_id,
--     c.id as call_id,
--     c.agent_extension,
--     c.phone_number,
--     c.call_time,
--     c.call_duration,
--     u.full_name as agent_name
-- FROM audit_items ai
-- JOIN call_logs c ON c.id = ai.call_log_id
-- LEFT JOIN users u ON u.extension_number = c.agent_extension
-- WHERE ai.daily_audit_id = 'uuid-here'
-- ORDER BY ai.sample_index;

-- Check if all items are verified:
-- SELECT 
--     COUNT(*) as total,
--     COUNT(*) FILTER (WHERE is_verified = TRUE) as verified
-- FROM audit_items
-- WHERE daily_audit_id = 'uuid-here';
