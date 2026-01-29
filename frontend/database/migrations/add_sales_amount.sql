-- Add sales_amount column to daily_stats table
-- This tracks the total dollar value of sales made today for the "Golden Ticket" feature

-- Add the column if it doesn't exist
ALTER TABLE daily_stats ADD COLUMN IF NOT EXISTS sales_amount DECIMAL(12, 2) DEFAULT 0;

-- Add a comment for documentation
COMMENT ON COLUMN daily_stats.sales_amount IS 'Total sales amount in dollars for the day (Golden Ticket tracking)';

-- Verify the column was added
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'daily_stats' AND column_name = 'sales_amount';
