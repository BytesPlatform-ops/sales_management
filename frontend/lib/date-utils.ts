/**
 * Date Utility Functions for Salary Gamification System
 * Handles working days calculations and prorated backfill for mid-month starts
 * Uses Asia/Karachi timezone
 */

/**
 * Get current date in Asia/Karachi timezone
 */
export function getCurrentDateKarachi(): Date {
  return new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Karachi' })
  );
}

/**
 * Check if a given date is a working day (Monday - Friday)
 */
export function isWorkingDay(date: Date): boolean {
  const day = date.getDay();
  return day !== 0 && day !== 6; // 0 = Sunday, 6 = Saturday
}

/**
 * Check if a given date is a weekend (Saturday or Sunday)
 * For overnight shifts, we determine "work day" based on shift START date, not end date.
 * - Friday night shift (starts Fri 9 PM) = Working Day
 * - Saturday night shift (starts Sat 9 PM) = Weekend (System Paused)
 * - Sunday night shift (starts Sun 9 PM) = Weekend (System Paused)
 * - Monday night shift (starts Mon 9 PM) = Working Day
 */
export function isWeekendDate(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6; // 0 = Sunday, 6 = Saturday
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
 * Calculate prorated backfill days (Ghost Days) for mid-month starts
 * Returns working days that passed BEFORE the system launch date
 * These days are assumed to have 100% performance
 */
export function getGhostDays(
  systemLaunchDate: Date,
  referenceDate: Date = getCurrentDateKarachi()
): number {
  const monthStart = getMonthStart(referenceDate);
  const launchDate = new Date(systemLaunchDate);

  monthStart.setHours(0, 0, 0, 0);
  launchDate.setHours(0, 0, 0, 0);

  // If system was launched before this month started, no ghost days
  if (launchDate <= monthStart) {
    return 0;
  }

  // If system launches in a future month, all days so far are ghost days
  const monthEnd = getMonthEnd(referenceDate);
  if (launchDate > monthEnd) {
    return getWorkingDaysElapsed(referenceDate);
  }

  // System was launched mid-month
  // Ghost days = working days from month start to day before launch
  const dayBeforeLaunch = new Date(launchDate);
  dayBeforeLaunch.setDate(dayBeforeLaunch.getDate() - 1);

  return getWorkingDaysBetween(monthStart, dayBeforeLaunch);
}

/**
 * Get working days elapsed in current month (up to today)
 */
export function getWorkingDaysElapsed(referenceDate: Date = getCurrentDateKarachi()): number {
  const monthStart = getMonthStart(referenceDate);
  return getWorkingDaysBetween(monthStart, referenceDate);
}

/**
 * Get remaining working days in the month
 */
export function getWorkingDaysRemaining(referenceDate: Date = getCurrentDateKarachi()): number {
  const monthEnd = getMonthEnd(referenceDate);
  const tomorrow = new Date(referenceDate);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  if (tomorrow > monthEnd) {
    return 0;
  }
  
  return getWorkingDaysBetween(tomorrow, monthEnd);
}

/**
 * Format date to YYYY-MM-DD
 */
export function formatDateYMD(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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
 * Format duration in a human-readable way
 */
export function formatDurationHuman(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  
  if (h === 0) {
    return `${m}m`;
  }
  return `${h}h ${m}m`;
}

/**
 * Get month name
 */
export function getMonthName(date: Date): string {
  return date.toLocaleString('en-US', { month: 'long' });
}

/**
 * Get first day of current month in YYYY-MM-DD format
 */
export function getFirstDayOfMonth(date: Date = getCurrentDateKarachi()): string {
  return formatDateYMD(getMonthStart(date));
}

/**
 * Get today's date in YYYY-MM-DD format (Karachi timezone)
 */
export function getTodayDate(): string {
  return formatDateYMD(getCurrentDateKarachi());
}
