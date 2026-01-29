-- ============================================================================
-- SALARY GAMIFICATION SYSTEM - DATABASE SCHEMA
-- Supabase PostgreSQL (aws-1-ap-southeast-2.pooler.supabase.com:6543)
-- ============================================================================

-- ============================================================================
-- 1. SYSTEM_SETTINGS TABLE (Global Configuration)
-- ============================================================================
CREATE TABLE IF NOT EXISTS system_settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Insert system launch date
INSERT INTO system_settings (key, value, description)
VALUES ('system_launch_date', '2024-02-04', 'Date when the gamification system was launched')
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- 2. USERS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    extension_number VARCHAR(20) UNIQUE NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('hr', 'agent')),
    base_salary BIGINT NOT NULL CHECK (base_salary > 0),
    shift_start TIME NOT NULL DEFAULT '09:00:00',
    shift_end TIME NOT NULL DEFAULT '18:00:00',
    employment_type VARCHAR(20) NOT NULL DEFAULT 'full_time' CHECK (employment_type IN ('full_time', 'part_time')),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create index for faster lookups
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_extension ON users(extension_number);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_employment_type ON users(employment_type);

-- ============================================================================
-- 3. ATTENDANCE TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS attendance (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    check_in_time TIMESTAMP WITH TIME ZONE,
    check_out_time TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) NOT NULL CHECK (status IN ('on_time', 'late', 'half_day', 'absent')),
    hr_approved BOOLEAN DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, date)
);

-- Create indexes for performance
CREATE INDEX idx_attendance_user_date ON attendance(user_id, date);
CREATE INDEX idx_attendance_date ON attendance(date);
CREATE INDEX idx_attendance_status ON attendance(status);
CREATE INDEX idx_attendance_hr_approved ON attendance(hr_approved);

-- ============================================================================
-- 4. DAILY_STATS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS daily_stats (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    calls_count BIGINT DEFAULT 0 CHECK (calls_count >= 0),
    talk_time_seconds BIGINT DEFAULT 0 CHECK (talk_time_seconds >= 0),
    leads_count BIGINT DEFAULT 0 CHECK (leads_count >= 0),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, date)
);

-- Create indexes for performance
CREATE INDEX idx_daily_stats_user_date ON daily_stats(user_id, date);
CREATE INDEX idx_daily_stats_date ON daily_stats(date);

-- ============================================================================
-- SAMPLE DATA INSERTION
-- ============================================================================

-- Insert HR User
INSERT INTO users (username, password, full_name, extension_number, role, base_salary, shift_start, shift_end, employment_type)
VALUES (
    'hr_admin',
    '$2a$10$CSO62OuE7HbVcvLkr6107.yv6/1L/1xWLpM5lCsOPFxNs/EjWbwWO',
    'HR Manager',
    '999',
    'hr',
    70000,
    '09:00:00',
    '18:00:00',
    'full_time'
)
ON CONFLICT (username) DO NOTHING;

-- Insert Agent User (ali) - Night Shift
INSERT INTO users (username, password, full_name, extension_number, role, base_salary, shift_start, shift_end, employment_type)
VALUES (
    'ali',
    '$2a$10$CSO62OuE7HbVcvLkr6107.yv6/1L/1xWLpM5lCsOPFxNs/EjWbwWO',
    'Ali Khan',
    '101',
    'agent',
    50000,
    '20:00:00',
    '04:00:00',
    'full_time'
)
ON CONFLICT (username) DO NOTHING;
