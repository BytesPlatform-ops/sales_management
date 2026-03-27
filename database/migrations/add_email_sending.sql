-- Add email tracking to dialer_leads
ALTER TABLE dialer_leads ADD COLUMN IF NOT EXISTS email_sent BOOLEAN DEFAULT FALSE;
ALTER TABLE dialer_leads ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMP;

-- Email log table for tracking sent emails
CREATE TABLE IF NOT EXISTS dialer_email_logs (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER REFERENCES dialer_leads(id) ON DELETE CASCADE,
  agent_id INTEGER REFERENCES users(id),
  recipient_email VARCHAR(255) NOT NULL,
  subject VARCHAR(500) NOT NULL,
  body_html TEXT,
  sendgrid_message_id VARCHAR(255),
  status VARCHAR(50) DEFAULT 'sent',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_del_lead ON dialer_email_logs(lead_id);
CREATE INDEX IF NOT EXISTS idx_del_agent ON dialer_email_logs(agent_id);
