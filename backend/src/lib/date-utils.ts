/**
 * Date Utility Functions for Salary Gamification System
 * Handles working days calculations and prorated backfill for mid-month starts
 */

/**
 * Check if a given date is a working day (Monday - Friday)
 */
export function isWorkingDay(date: Date): boolean {
  const day = date.getDay();
  return day !== 0 && day !== 6; // 0 = Sunday, 6 = Saturday
}

/**
 * Get the start of a month for a given date
 */
export function getMonthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/**
 * Get the end of a month for a given date
 */
export function getMonthEnd(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

/**
 * Calculate total working days (Mon-Fri) in a given month
 * NOT hardcoded - dynamically calculates based on calendar
 */
export function getWorkingDaysInMonth(date: Date): number {
  const year = date.getFullYear();
  const month = date.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  let workingDays = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const currentDate = new Date(year, month, day);
    if (isWorkingDay(currentDate)) {
      workingDays++;
    }
  }

  return workingDays;
}

/**
 * Calculate working days between two dates (inclusive)
 */
export function getWorkingDaysBetween(startDate: Date, endDate: Date): number {
  let workingDays = 0;
  const current = new Date(startDate);
  current.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);

  while (current <= end) {
    if (isWorkingDay(current)) {
      workingDays++;
    }
    current.setDate(current.getDate() + 1);
  }

  return workingDays;
}

/**
 * Calculate prorated backfill days for mid-month starts
 * Returns working days that passed BEFORE the user/system was active
 */
export function getProratedBackfillDays(
  userCreationDate: Date,
  referenceDate: Date = new Date()
): number {
  const monthStart = getMonthStart(referenceDate);
  const userStart = new Date(userCreationDate);

  monthStart.setHours(0, 0, 0, 0);
  userStart.setHours(0, 0, 0, 0);

  // If user was created before this month started, no backfill needed
  if (userStart <= monthStart) {
    return 0;
  }

  // If user was created in a future month, backfill entire current month
  const monthEnd = getMonthEnd(referenceDate);
  if (userStart > monthEnd) {
    return getWorkingDaysInMonth(referenceDate);
  }

  // User was created mid-month
  const dayBeforeUserStart = new Date(userStart);
  dayBeforeUserStart.setDate(dayBeforeUserStart.getDate() - 1);

  return getWorkingDaysBetween(monthStart, dayBeforeUserStart);
}

/**
 * Get the effective start date for calculations
 */
export function getEffectiveStartDate(
  userCreationDate: Date,
  systemLaunchDate: Date
): Date {
  return userCreationDate > systemLaunchDate ? userCreationDate : systemLaunchDate;
}

/**
 * Calculate ghost earnings for backfill days
 */
export function calculateGhostEarnings(
  backfillDays: number,
  dailyPotential: number
): number {
  return backfillDays * dailyPotential;
}

/**
 * Get working days elapsed in current month (up to today)
 */
export function getWorkingDaysElapsed(referenceDate: Date = new Date()): number {
  const monthStart = getMonthStart(referenceDate);
  return getWorkingDaysBetween(monthStart, referenceDate);
}

/**
 * Get remaining working days in the month
 */
export function getWorkingDaysRemaining(referenceDate: Date = new Date()): number {
  const monthEnd = getMonthEnd(referenceDate);
  const tomorrow = new Date(referenceDate);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return getWorkingDaysBetween(tomorrow, monthEnd);
}

/**
 * Format seconds to HH:MM:SS
 */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * Parse HH:MM:SS to seconds
 */
export function parseDuration(duration: string): number {
  if (!duration) return 0;
  const parts = duration.split(':').map(Number);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return parts[0] || 0;
}
