-- Migration: Add recording_url column to call_logs table
-- This column stores the URL to the call recording provided by 3CX
-- Required for the QA & Auditing module to allow HR to review call recordings

-- Add recording_url column to call_logs table
ALTER TABLE call_logs 
ADD COLUMN IF NOT EXISTS recording_url TEXT;

-- Add index for efficient querying of calls with recordings
CREATE INDEX IF NOT EXISTS idx_call_logs_recording_url 
ON call_logs(recording_url) 
WHERE recording_url IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN call_logs.recording_url IS 'URL to the call recording from 3CX, used for QA auditing';
