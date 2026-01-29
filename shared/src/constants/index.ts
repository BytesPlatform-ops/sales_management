// API Response Status
export const API_STATUS = {
  SUCCESS: 'success',
  ERROR: 'error',
} as const;

// Default working days assumption (fallback)
export const DEFAULT_WORKING_DAYS = 22;

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
