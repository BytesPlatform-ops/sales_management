-- Create agent_leads table for Lead Verification System
-- Leads are submitted by agents and require HR approval before counting

-- Drop existing table if needed (for development only)
-- DROP TABLE IF EXISTS agent_leads;

CREATE TABLE IF NOT EXISTS agent_leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    customer_name VARCHAR(255) NOT NULL,
    customer_email VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    reviewed_by INTEGER REFERENCES users(id),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_agent_leads_agent_id ON agent_leads(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_leads_status ON agent_leads(status);
CREATE INDEX IF NOT EXISTS idx_agent_leads_created_at ON agent_leads(created_at);

-- Enable realtime for this table (Supabase)
ALTER PUBLICATION supabase_realtime ADD TABLE agent_leads;

-- Add comments for documentation
COMMENT ON TABLE agent_leads IS 'Leads submitted by agents that require HR verification before counting toward stats';
COMMENT ON COLUMN agent_leads.status IS 'pending = awaiting review, approved = counted toward stats, rejected = not counted';
COMMENT ON COLUMN agent_leads.reviewed_by IS 'HR user who approved/rejected the lead';
COMMENT ON COLUMN agent_leads.reviewed_at IS 'Timestamp when the lead was reviewed';
