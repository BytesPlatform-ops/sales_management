-- Create payments table for payment verification system
-- Payments are submitted by agents and require HR approval before updating commission

CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    agent_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount DECIMAL(12, 2) NOT NULL CHECK (amount > 0),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    reviewed_by INTEGER REFERENCES users(id),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_payments_sale_id ON payments(sale_id);
CREATE INDEX IF NOT EXISTS idx_payments_agent_id ON payments(agent_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at);

-- Enable realtime for this table (Supabase)
ALTER PUBLICATION supabase_realtime ADD TABLE payments;

-- Add comments for documentation
COMMENT ON TABLE payments IS 'Payments submitted by agents that require HR verification before updating commission';
COMMENT ON COLUMN payments.status IS 'pending = awaiting review, approved = commission updated, rejected = not counted';
COMMENT ON COLUMN payments.reviewed_by IS 'HR user who approved/rejected the payment';
COMMENT ON COLUMN payments.reviewed_at IS 'Timestamp when the payment was reviewed';
