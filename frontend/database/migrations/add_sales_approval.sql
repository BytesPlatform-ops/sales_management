-- Add approval workflow columns to sales table
ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE;

-- For legacy compatibility, set approval_status to 'approved' for all existing rows with status = 'completed'
UPDATE sales SET approval_status = 'approved', approved_at = NOW() WHERE approval_status IS NULL AND status = 'completed';

-- Add index for approval_status
CREATE INDEX IF NOT EXISTS idx_sales_approval_status ON sales(approval_status);
