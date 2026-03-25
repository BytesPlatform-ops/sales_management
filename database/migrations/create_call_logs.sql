-- Dialer call logs: preserves full call history per lead (1-to-many)
-- dialer_leads still holds current state; this table holds every call attempt
-- Named dialer_call_logs to avoid conflict with existing 3CX call_logs table

CREATE TABLE IF NOT EXISTS dialer_call_logs (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES dialer_leads(id) ON DELETE CASCADE,
  agent_id INTEGER NOT NULL REFERENCES users(id),
  call_outcome VARCHAR(50) NOT NULL,
  call_outcomes JSONB,
  notes TEXT,
  pool_after VARCHAR(20),
  call_number INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_dcl_lead ON dialer_call_logs(lead_id);
CREATE INDEX idx_dcl_agent ON dialer_call_logs(agent_id);
CREATE INDEX idx_dcl_created ON dialer_call_logs(created_at);
