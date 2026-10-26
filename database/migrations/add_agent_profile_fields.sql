-- ============================================================================
-- MIGRATION: Add joining date and personal info columns to users table
-- Purpose: HR-managed agent profile (date of joining, contact, ID, bank details)
-- All columns are nullable so existing agents are unaffected.
-- ============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_joining DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(30);
ALTER TABLE users ADD COLUMN IF NOT EXISTS personal_email VARCHAR(150);
ALTER TABLE users ADD COLUMN IF NOT EXISTS cnic VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS emergency_contact_name VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS emergency_contact_phone VARCHAR(30);
ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_name VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_account_title VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_account_number VARCHAR(50);

COMMENT ON COLUMN users.date_of_joining IS 'Date the agent joined the company (set by HR).';
COMMENT ON COLUMN users.cnic IS 'National ID (CNIC) number.';
COMMENT ON COLUMN users.bank_account_number IS 'Account number or IBAN for salary transfer.';
