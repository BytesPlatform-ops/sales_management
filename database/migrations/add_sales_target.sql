-- ============================================================================
-- MIGRATION: Add sales_target column to users table
-- Purpose: Store the "Golden Ticket" sales target in USD
-- If agent's achieved_sales >= sales_target, they get 100% base salary
-- (ignoring all lates, call counts, and talk time penalties)
-- ============================================================================

-- Add sales_target column (default 0 means no target set)
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS sales_target INTEGER DEFAULT 0;

-- Add comment for documentation
COMMENT ON COLUMN users.sales_target IS 'Golden Ticket: USD sales target. If achieved, agent gets 100% base salary ignoring penalties.';

-- Create index for faster queries when filtering by sales_target
CREATE INDEX IF NOT EXISTS idx_users_sales_target ON users(sales_target);
