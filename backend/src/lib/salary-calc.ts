import {
  getWorkingDaysInMonth,
  getWorkingDaysElapsed,
  getProratedBackfillDays,
  calculateGhostEarnings,
} from './date-utils';

export interface SalaryCalculationInput {
  baseSalary: number;
  userCreatedAt: Date;
  systemLaunchDate: Date;
  attendanceData: {
    onTime: number;
    late: number;
    halfDay: number;
    absent: number;
  };
  referenceDate?: Date;
}

export interface SalaryCalculationResult {
  dailyPotential: number;
  workingDaysInMonth: number;
  workingDaysElapsed: number;
  backfillDays: number;
  ghostEarnings: number;
  earnedFromAttendance: number;
  totalEarnings: number;
  projectedSalary: number;
  attendanceBreakdown: {
    onTimeEarnings: number;
    lateEarnings: number;
    halfDayEarnings: number;
    absentDeduction: number;
  };
}

// Salary multipliers based on attendance status
const ATTENDANCE_MULTIPLIERS = {
  onTime: 1.0, // 100%
  late: 0.5, // 50%
  halfDay: 0.5, // 50%
  absent: 0, // 0%
};

/**
 * Calculate salary based on attendance and performance
 */
export function calculateSalary(input: SalaryCalculationInput): SalaryCalculationResult {
  const referenceDate = input.referenceDate || new Date();

  // Calculate working days
  const workingDaysInMonth = getWorkingDaysInMonth(referenceDate);
  const workingDaysElapsed = getWorkingDaysElapsed(referenceDate);

  // Calculate daily potential (base salary / working days in month)
  const dailyPotential = input.baseSalary / workingDaysInMonth;

  // Calculate backfill for mid-month starts
  const effectiveStartDate =
    input.userCreatedAt > input.systemLaunchDate
      ? input.userCreatedAt
      : input.systemLaunchDate;

  const backfillDays = getProratedBackfillDays(effectiveStartDate, referenceDate);
  const ghostEarnings = calculateGhostEarnings(backfillDays, dailyPotential);

  // Calculate earnings from attendance
  const attendanceBreakdown = {
    onTimeEarnings: input.attendanceData.onTime * dailyPotential * ATTENDANCE_MULTIPLIERS.onTime,
    lateEarnings: input.attendanceData.late * dailyPotential * ATTENDANCE_MULTIPLIERS.late,
    halfDayEarnings: input.attendanceData.halfDay * dailyPotential * ATTENDANCE_MULTIPLIERS.halfDay,
    absentDeduction: input.attendanceData.absent * dailyPotential * ATTENDANCE_MULTIPLIERS.absent,
  };

  const earnedFromAttendance =
    attendanceBreakdown.onTimeEarnings +
    attendanceBreakdown.lateEarnings +
    attendanceBreakdown.halfDayEarnings;

  // Total earnings = ghost + actual attendance
  const totalEarnings = ghostEarnings + earnedFromAttendance;

  // Projected salary (if they continue at current rate)
  const daysWorked =
    input.attendanceData.onTime +
    input.attendanceData.late +
    input.attendanceData.halfDay +
    input.attendanceData.absent;

  const avgDailyEarning = daysWorked > 0 ? earnedFromAttendance / daysWorked : dailyPotential;
  const remainingDays = workingDaysInMonth - workingDaysElapsed;
  const projectedSalary = totalEarnings + avgDailyEarning * remainingDays;

  return {
    dailyPotential: Math.round(dailyPotential * 100) / 100,
    workingDaysInMonth,
    workingDaysElapsed,
    backfillDays,
    ghostEarnings: Math.round(ghostEarnings * 100) / 100,
    earnedFromAttendance: Math.round(earnedFromAttendance * 100) / 100,
    totalEarnings: Math.round(totalEarnings * 100) / 100,
    projectedSalary: Math.round(projectedSalary * 100) / 100,
    attendanceBreakdown: {
      onTimeEarnings: Math.round(attendanceBreakdown.onTimeEarnings * 100) / 100,
      lateEarnings: Math.round(attendanceBreakdown.lateEarnings * 100) / 100,
      halfDayEarnings: Math.round(attendanceBreakdown.halfDayEarnings * 100) / 100,
      absentDeduction: Math.round(attendanceBreakdown.absentDeduction * 100) / 100,
    },
  };
}

/**
 * Calculate daily potential for a user
 */
export function getDailyPotential(baseSalary: number, referenceDate: Date = new Date()): number {
  const workingDays = getWorkingDaysInMonth(referenceDate);
  return Math.round((baseSalary / workingDays) * 100) / 100;
}
