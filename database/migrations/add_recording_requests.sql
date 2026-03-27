-- Recording Requests: Agents request call recordings, HR approves, system fetches from 3CX
CREATE TABLE IF NOT EXISTS recording_requests (
  id BIGSERIAL PRIMARY KEY,
  agent_id BIGINT NOT NULL REFERENCES users(id),
  phone_number VARCHAR(20) NOT NULL,
  call_log_id BIGINT REFERENCES call_logs(id),
  rec_id VARCHAR(50),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending, approved, rejected
  recording_url TEXT,
  notes TEXT,           -- Agent's reason for requesting
  hr_notes TEXT,        -- HR's notes on approval/rejection
  approved_by BIGINT REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rr_agent ON recording_requests(agent_id);
CREATE INDEX IF NOT EXISTS idx_rr_status ON recording_requests(status);
