/**
 * Attendance calculation utilities
 * Handles timezone-aware shift comparison and status determination
 */

// Grace periods in minutes
export const ATTENDANCE_RULES = {
  GRACE_PERIOD: 30,      // 0-30 mins = on_time
  LATE_THRESHOLD: 90,    // 31-90 mins = late
  // 91+ mins = half_day
};

/**
 * Get current time in Asia/Karachi timezone
 */
export function getCurrentTimeKarachi(): Date {
  return new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Karachi' })
  );
}

/**
 * Parse TIME string (HH:MM:SS) to today's Date in Karachi timezone
 */
export function parseShiftTimeToday(timeStr: string): Date {
  const now = getCurrentTimeKarachi();
  const [hours, minutes, seconds] = timeStr.split(':').map(Number);
  
  const shiftTime = new Date(now);
  shiftTime.setHours(hours, minutes, seconds || 0, 0);
  
  return shiftTime;
}

/**
 * Calculate minutes difference, handling overnight shifts
 * Positive = late, Negative = early
 */
export function getMinutesDifference(shiftStart: Date, currentTime: Date): number {
  let diffMs = currentTime.getTime() - shiftStart.getTime();
  
  // Handle overnight shifts (e.g., shift starts at 20:00, current time is 01:00)
  // If the difference is very negative (more than 12 hours), add 24 hours
  const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
  
  if (diffMs < -TWELVE_HOURS_MS) {
    // Current time is past midnight, shift was yesterday
    diffMs += TWENTY_FOUR_HOURS_MS;
  } else if (diffMs > TWELVE_HOURS_MS) {
    // Shift is later today but we're checking early
    diffMs -= TWENTY_FOUR_HOURS_MS;
  }
  
  return Math.floor(diffMs / (1000 * 60));
}

/**
 * Determine attendance status based on shift start and current time
 */
export function determineAttendanceStatus(
  shiftStartStr: string
): {
  status: 'on_time' | 'late' | 'half_day';
  minutesLate: number;
  message: string;
} {
  const currentTime = getCurrentTimeKarachi();
  const shiftStart = parseShiftTimeToday(shiftStartStr);
  const minutesLate = getMinutesDifference(shiftStart, currentTime);

  // Early or within grace period
  if (minutesLate <= ATTENDANCE_RULES.GRACE_PERIOD) {
    return {
      status: 'on_time',
      minutesLate: Math.max(0, minutesLate),
      message: minutesLate <= 0 
        ? `You're ${Math.abs(minutesLate)} minutes early! Great job! 🎉`
        : `Checked in within grace period (${minutesLate} mins)`,
    };
  }

  // Late (31-90 minutes)
  if (minutesLate <= ATTENDANCE_RULES.LATE_THRESHOLD) {
    return {
      status: 'late',
      minutesLate,
      message: `You're ${minutesLate} minutes late. 50% salary deduction for today.`,
    };
  }

  // Half day (91+ minutes)
  return {
    status: 'half_day',
    minutesLate,
    message: `You're ${minutesLate} minutes late. Marked as half day.`,
  };
}

/**
 * Get today's date in YYYY-MM-DD format for Karachi timezone
 */
export function getTodayDateKarachi(): string {
  const now = getCurrentTimeKarachi();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get the current shift's start and end timestamps based on agent's shift times
 * 
 * For overnight shifts (e.g., 9 PM - 5 AM / 21:00 - 05:00):
 * - If current time is 10 PM → shift started today at 9 PM, ends tomorrow at 5 AM
 * - If current time is 2 AM → shift started yesterday at 9 PM, ends today at 5 AM
 * 
 * Returns { shiftStart: Date, shiftEnd: Date, shiftDate: string (YYYY-MM-DD) }
 */
export function getCurrentShiftWindow(shiftStartStr: string, shiftEndStr: string): {
  shiftStart: Date;
  shiftEnd: Date;
  shiftDate: string;
} {
  const now = getCurrentTimeKarachi();
  const currentHour = now.getHours();
  const shiftStartHour = parseInt(shiftStartStr.split(':')[0], 10);
  const shiftStartMin = parseInt(shiftStartStr.split(':')[1], 10) || 0;
  const shiftEndHour = parseInt(shiftEndStr.split(':')[0], 10);
  const shiftEndMin = parseInt(shiftEndStr.split(':')[1], 10) || 0;

  let shiftStart: Date;
  let shiftEnd: Date;
  let shiftDate: string;

  // For overnight shifts (start hour > end hour, e.g., 21:00 - 05:00)
  if (shiftStartHour > shiftEndHour) {
    if (currentHour >= shiftStartHour) {
      // We're in the first part of the shift (before midnight)
      // Shift started today, ends tomorrow
      shiftStart = new Date(now);
      shiftStart.setHours(shiftStartHour, shiftStartMin, 0, 0);
      
      shiftEnd = new Date(now);
      shiftEnd.setDate(shiftEnd.getDate() + 1);
      shiftEnd.setHours(shiftEndHour, shiftEndMin, 0, 0);
      
      shiftDate = formatDateStr(shiftStart);
    } else if (currentHour < shiftEndHour) {
      // We're in the second part of the shift (after midnight)
      // Shift started yesterday, ends today
      shiftStart = new Date(now);
      shiftStart.setDate(shiftStart.getDate() - 1);
      shiftStart.setHours(shiftStartHour, shiftStartMin, 0, 0);
      
      shiftEnd = new Date(now);
      shiftEnd.setHours(shiftEndHour, shiftEndMin, 0, 0);
      
      shiftDate = formatDateStr(shiftStart);
    } else {
      // We're outside the shift (after shift end, before next shift start)
      // Show the previous completed shift
      shiftStart = new Date(now);
      shiftStart.setDate(shiftStart.getDate() - 1);
      shiftStart.setHours(shiftStartHour, shiftStartMin, 0, 0);
      
      shiftEnd = new Date(now);
      shiftEnd.setHours(shiftEndHour, shiftEndMin, 0, 0);
      
      shiftDate = formatDateStr(shiftStart);
    }
  } else {
    // Regular day shift (start hour < end hour, e.g., 10:00 - 19:00)
    if (currentHour >= shiftStartHour && currentHour < shiftEndHour) {
      // Currently in shift
      shiftStart = new Date(now);
      shiftStart.setHours(shiftStartHour, shiftStartMin, 0, 0);
      
      shiftEnd = new Date(now);
      shiftEnd.setHours(shiftEndHour, shiftEndMin, 0, 0);
    } else if (currentHour >= shiftEndHour) {
      // After today's shift - show today's completed shift
      shiftStart = new Date(now);
      shiftStart.setHours(shiftStartHour, shiftStartMin, 0, 0);
      
      shiftEnd = new Date(now);
      shiftEnd.setHours(shiftEndHour, shiftEndMin, 0, 0);
    } else {
      // Before today's shift - show yesterday's shift
      shiftStart = new Date(now);
      shiftStart.setDate(shiftStart.getDate() - 1);
      shiftStart.setHours(shiftStartHour, shiftStartMin, 0, 0);
      
      shiftEnd = new Date(now);
      shiftEnd.setDate(shiftEnd.getDate() - 1);
      shiftEnd.setHours(shiftEndHour, shiftEndMin, 0, 0);
    }
    shiftDate = formatDateStr(shiftStart);
  }

  return { shiftStart, shiftEnd, shiftDate };
}

function formatDateStr(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get the shift start and end times in UTC for database queries.
 * 
 * The "new day" for stats resets at the agent's shift start time.
 * - If current PKT time >= shift_start → shift started today
 * - If current PKT time < shift_start → shift started yesterday
 * 
 * Handles both regular shifts (e.g., 10:00 - 19:00) and overnight shifts (e.g., 21:00 - 05:00)
 * 
 * Database stores timestamps in UTC, so we convert:
 * PKT is UTC+5, e.g., 21:00 PKT = 16:00 UTC
 * 
 * @param shiftStartStr - The shift start time in HH:MM or HH:MM:SS format (e.g., "21:00")
 * @param shiftEndStr - The shift end time in HH:MM or HH:MM:SS format (e.g., "05:00")
 * @returns { shiftStartUTC: Date, shiftEndUTC: Date, shiftDatePKT: string, shiftStartFormatted: string }
 */
export function getShiftStartTimeUTC(shiftStartStr: string = '21:00', shiftEndStr: string = '05:00'): {
  shiftStartUTC: Date;
  shiftEndUTC: Date;
  shiftDatePKT: string;
  shiftStartFormatted: string;
} {
  // Get current time in PKT
  const nowPKT = getCurrentTimeKarachi();
  const currentHour = nowPKT.getHours();
  const currentMinute = nowPKT.getMinutes();
  
  // Parse shift start and end times
  const [shiftStartHour, shiftStartMinute] = shiftStartStr.split(':').map(Number);
  const [shiftEndHour, shiftEndMinute] = shiftEndStr.split(':').map(Number);
  
  // Determine if we're before or after today's shift start
  const currentTimeMinutes = currentHour * 60 + currentMinute;
  const shiftStartMinutes = shiftStartHour * 60 + (shiftStartMinute || 0);
  const shiftEndMinutes = shiftEndHour * 60 + (shiftEndMinute || 0);
  
  // Check if this is an overnight shift (start hour > end hour, e.g., 21:00 - 05:00)
  const isOvernightShift = shiftStartMinutes > shiftEndMinutes;
  
  // Create shift start date in PKT
  const shiftStartPKT = new Date(nowPKT);
  const shiftEndPKT = new Date(nowPKT);
  
  if (isOvernightShift) {
    // Overnight shift logic (e.g., 21:00 - 05:00)
    if (currentTimeMinutes >= shiftStartMinutes) {
      // We're in the first part of the shift (after shift start, before midnight)
      // Shift started today, ends tomorrow
      shiftStartPKT.setHours(shiftStartHour, shiftStartMinute || 0, 0, 0);
      shiftEndPKT.setDate(shiftEndPKT.getDate() + 1);
      shiftEndPKT.setHours(shiftEndHour, shiftEndMinute || 0, 0, 0);
    } else if (currentTimeMinutes < shiftEndMinutes) {
      // We're in the second part of the shift (after midnight, before shift end)
      // Shift started yesterday, ends today
      shiftStartPKT.setDate(shiftStartPKT.getDate() - 1);
      shiftStartPKT.setHours(shiftStartHour, shiftStartMinute || 0, 0, 0);
      shiftEndPKT.setHours(shiftEndHour, shiftEndMinute || 0, 0, 0);
    } else {
      // We're outside the shift (after end, before next start)
      // Show the most recent completed shift (yesterday's shift)
      shiftStartPKT.setDate(shiftStartPKT.getDate() - 1);
      shiftStartPKT.setHours(shiftStartHour, shiftStartMinute || 0, 0, 0);
      shiftEndPKT.setHours(shiftEndHour, shiftEndMinute || 0, 0, 0);
    }
  } else {
    // Regular day shift logic (e.g., 10:00 - 19:00)
    if (currentTimeMinutes >= shiftStartMinutes) {
      // We're after shift start time today
      shiftStartPKT.setHours(shiftStartHour, shiftStartMinute || 0, 0, 0);
      shiftEndPKT.setHours(shiftEndHour, shiftEndMinute || 0, 0, 0);
    } else {
      // We're before shift start time → show yesterday's shift
      shiftStartPKT.setDate(shiftStartPKT.getDate() - 1);
      shiftStartPKT.setHours(shiftStartHour, shiftStartMinute || 0, 0, 0);
      shiftEndPKT.setDate(shiftEndPKT.getDate() - 1);
      shiftEndPKT.setHours(shiftEndHour, shiftEndMinute || 0, 0, 0);
    }
  }
  
  // Get the date string for the shift (in PKT) - use the date when shift STARTED
  const shiftDatePKT = formatDateStr(shiftStartPKT);
  
  // Format for display: "Jan 29, 2026 9:00 PM"
  const shiftStartFormatted = shiftStartPKT.toLocaleString('en-US', {
    timeZone: 'Asia/Karachi',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  
  // Convert PKT to UTC for database query
  // PKT offset is +5 hours (no DST in Pakistan)
  const startYear = shiftStartPKT.getFullYear();
  const startMonth = shiftStartPKT.getMonth();
  const startDay = shiftStartPKT.getDate();
  const startHours = shiftStartPKT.getHours();
  const startMinutes = shiftStartPKT.getMinutes();
  
  const endYear = shiftEndPKT.getFullYear();
  const endMonth = shiftEndPKT.getMonth();
  const endDay = shiftEndPKT.getDate();
  const endHours = shiftEndPKT.getHours();
  const endMinutes = shiftEndPKT.getMinutes();
  
  // Subtract 5 hours to convert PKT to UTC
  const shiftStartUTC = new Date(Date.UTC(startYear, startMonth, startDay, startHours - 5, startMinutes, 0, 0));
  const shiftEndUTC = new Date(Date.UTC(endYear, endMonth, endDay, endHours - 5, endMinutes, 0, 0));
  
  return {
    shiftStartUTC,
    shiftEndUTC,
    shiftDatePKT,
    shiftStartFormatted,
  };
}

/**
 * Check if current time is within shift hours (for overnight shifts)
 * This helps determine which "day" the attendance belongs to
 * 
 * For overnight shifts (e.g., 9 PM - 5 AM / 21:00 - 05:00):
 * - Login at 9 PM, 10 PM, 11 PM → Attendance date = today
 * - Login at 12 AM, 1 AM, 2 AM, 3 AM, 4 AM → Attendance date = yesterday (shift started yesterday)
 * - Login at 5 AM onwards → Attendance date = today (new day)
 */
export function getAttendanceDate(shiftStartStr: string, shiftEndStr: string): string {
  const now = getCurrentTimeKarachi();
  const currentHour = now.getHours();
  const shiftStartHour = parseInt(shiftStartStr.split(':')[0], 10);
  const shiftEndHour = parseInt(shiftEndStr.split(':')[0], 10);

  // For overnight shifts (e.g., 21:00 - 05:00, where start > end)
  if (shiftStartHour > shiftEndHour) {
    // If current time is after midnight but before shift end (plus small buffer)
    // e.g., 0:00 - 5:00 for a 21:00 - 05:00 shift
    if (currentHour >= 0 && currentHour < shiftEndHour) {
      // This login belongs to yesterday's shift (shift started previous day at 9 PM)
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const year = yesterday.getFullYear();
      const month = String(yesterday.getMonth() + 1).padStart(2, '0');
      const day = String(yesterday.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  }

  // For normal shifts or after shift ends, use today's date
  return getTodayDateKarachi();
}
