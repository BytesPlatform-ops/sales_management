-- Add meeting_seconds column to daily_stats table
-- This tracks manually added meeting time (e.g., Zoom demos)
-- talk_time_seconds = system_talk_time + meeting_seconds (Grand Total)

ALTER TABLE daily_stats
ADD COLUMN IF NOT EXISTS meeting_seconds BIGINT DEFAULT 0 CHECK (meeting_seconds >= 0);

-- Add comment for documentation
COMMENT ON COLUMN daily_stats.meeting_seconds IS 'Manually added meeting time in seconds for offline activities (Zoom, Google Meet demos, etc.)';

-- Create index for meeting time queries (optional but useful for reports)
CREATE INDEX IF NOT EXISTS idx_daily_stats_meeting_seconds ON daily_stats(meeting_seconds);

-- Verify the column was added
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'daily_stats' 
ORDER BY ordinal_position;
