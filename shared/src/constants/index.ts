// API Response Status
export const API_STATUS = {
  SUCCESS: 'success',
  ERROR: 'error',
} as const;

// Default working days assumption (fallback)
export const DEFAULT_WORKING_DAYS = 22;

// Daily Performance Targets by Employment Type
export const DAILY_TARGETS = {
  full_time: {
    calls: 150,               // 150 calls for max call score
    talk_time_seconds: 3600,  // 1 hour (3600 seconds) for max talk score
    leads: 3,                 // 3 leads for max lead score
  },
  part_time: {
    calls: 75,                // 75 calls for max call score
    talk_time_seconds: 1800,  // 30 minutes (1800 seconds) for max talk score
    leads: 2,                 // 2 leads for max lead score
  },
} as const;

// Performance scoring weights
export const PERFORMANCE_WEIGHTS = {
  calls: 0.40,     // 40% weight for calls (max 0.40)
  talk_time: 0.30, // 30% weight for talk time (max 0.30)
  leads: 0.30,     // 30% weight for leads (max 0.30)
} as const;

// Attendance status labels
export const ATTENDANCE_STATUS_LABELS = {
  on_time: 'On Time',
  late: 'Late',
  half_day: 'Half Day',
  absent: 'Absent',
} as const;

// Role labels
export const ROLE_LABELS = {
  hr: 'HR Manager',
  agent: 'Sales Agent',
} as const;

// Employment type labels
export const EMPLOYMENT_TYPE_LABELS = {
  full_time: 'Full Time',
  part_time: 'Part Time',
} as const;

// Salary calculation constants
export const SALARY_CONFIG = {
  LATE_PENALTY_PERCENTAGE: 0.5, // 50% of daily salary deducted for late
  HALF_DAY_PERCENTAGE: 0.5, // 50% of daily salary for half day
  ABSENT_PERCENTAGE: 0, // 0% for absent
  ON_TIME_PERCENTAGE: 1, // 100% for on time
} as const;

// Time format
export const TIME_FORMAT = {
  DISPLAY: 'HH:mm',
  DATABASE: 'HH:mm:ss',
} as const;

// Date format
export const DATE_FORMAT = {
  DISPLAY: 'MMM dd, yyyy',
  DATABASE: 'yyyy-MM-dd',
  FULL: 'EEEE, MMMM dd, yyyy',
} as const;
