-- Create sales table for detailed sales logging with commission tracking
-- This table tracks individual sales deals with partial payment support

CREATE TABLE IF NOT EXISTS sales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    customer_name VARCHAR(255) NOT NULL,
    total_deal_value DECIMAL(12, 2) NOT NULL CHECK (total_deal_value > 0),
    amount_collected DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK (amount_collected >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'partial' CHECK (status IN ('partial', 'completed')),
    commission_paid BOOLEAN NOT NULL DEFAULT FALSE,
    commission_amount DECIMAL(12, 2) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster agent lookups
CREATE INDEX IF NOT EXISTS idx_sales_agent_id ON sales(agent_id);
CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status);
CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at);

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_sales_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sales_updated_at ON sales;
CREATE TRIGGER trigger_sales_updated_at
    BEFORE UPDATE ON sales
    FOR EACH ROW
    EXECUTE FUNCTION update_sales_updated_at();

-- Add comment for documentation
COMMENT ON TABLE sales IS 'Tracks individual sales deals with partial payment support and commission tracking';
COMMENT ON COLUMN sales.total_deal_value IS 'Full price agreed for the deal - counts toward Golden Ticket target immediately';
COMMENT ON COLUMN sales.amount_collected IS 'Total amount received so far from customer';
COMMENT ON COLUMN sales.status IS 'partial = not fully paid, completed = fully paid';
COMMENT ON COLUMN sales.commission_paid IS 'Whether 5% commission has been added to agent earnings';
COMMENT ON COLUMN sales.commission_amount IS 'The 5% commission amount (calculated when completed)';
