-- =============================================
-- LEADS TABLE SCHEMA FOR POWER DIALER
-- =============================================

-- Create status enum type
DO $$ BEGIN
    CREATE TYPE lead_status AS ENUM ('pending', 'called', 'busy', 'bad_number');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create leads table
CREATE TABLE IF NOT EXISTS leads (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    phone_number VARCHAR(50) NOT NULL,
    status lead_status DEFAULT 'pending',
    assigned_agent_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    last_called_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create index on phone_number for fast lookups
CREATE INDEX IF NOT EXISTS idx_leads_phone_number ON leads(phone_number);

-- Create index on status for filtering pending leads
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);

-- Create index on assigned_agent_id for agent-specific queries
CREATE INDEX IF NOT EXISTS idx_leads_assigned_agent ON leads(assigned_agent_id);

-- Composite index for power dialer query (pending leads for an agent)
CREATE INDEX IF NOT EXISTS idx_leads_agent_status ON leads(assigned_agent_id, status);

-- =============================================
-- INSERT 10 DUMMY LEADS (Assigned to User ID 1)
-- =============================================

INSERT INTO leads (name, phone_number, status, assigned_agent_id) VALUES
    ('Ahmed Khan', '+923001234501', 'pending', 1),
    ('Sara Ali', '+923001234502', 'pending', 1),
    ('Bilal Hassan', '+923001234503', 'pending', 1),
    ('Fatima Zahra', '+923001234504', 'pending', 1),
    ('Omar Farooq', '+923001234505', 'pending', 1),
    ('Ayesha Malik', '+923001234506', 'pending', 1),
    ('Zain Abbas', '+923001234507', 'pending', 1),
    ('Hira Noor', '+923001234508', 'pending', 1),
    ('Usman Ghani', '+923001234509', 'pending', 1),
    ('Maryam Sheikh', '+923001234510', 'pending', 1);

-- Verify insertion
SELECT * FROM leads WHERE assigned_agent_id = 1;
