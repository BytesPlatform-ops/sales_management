/**
 * Salary Calculation Utilities
 * Handles dynamic salary calculations based on attendance, performance, and ghost earnings
 */

import {
  getWorkingDaysInMonth,
  getWorkingDaysElapsed,
  getGhostDays,
  getCurrentDateKarachi,
  formatDateYMD,
  getMonthStart,
} from './date-utils';

// Attendance multipliers for salary calculation
export const ATTENDANCE_MULTIPLIERS = {
  on_time: 1.0,   // 100% salary
  late: 1.0,      // 100% salary (first 3 lates are FREE, 4th+ counts as half day)
  half_day: 0.5,  // 50% salary
  absent: 0,      // 0% salary
};

// "3 Lates Free" Policy Constants
export const LATE_POLICY = {
  FREE_LATES: 3,           // First 3 lates in a month are FREE
  EXCESS_LATE_PENALTY: 0.5, // 4th+ late counts as 0.5 day deduction
};

// Performance scoring weights (Step 5 Formula)
export const PERFORMANCE_WEIGHTS = {
  calls: 0.40,     // 40% weight for calls (max 0.40)
  talk_time: 0.30, // 30% weight for talk time (max 0.30)
  leads: 0.30,     // 30% weight for leads (max 0.30)
};

// Target values for 100% performance (Step 5 Formula)
// CallScore = (calls / 250) * 0.40, TalkScore = (seconds / 3600) * 0.30, LeadScore = (leads / 3) * 0.30
export const DAILY_TARGETS = {
  calls: 250,               // 250 calls for max call score
  talk_time_seconds: 3600,  // 1 hour (3600 seconds) for max talk score
  leads: 3,                 // 3 leads for max lead score
};

export interface DailyStats {
  date: string;
  calls_count: number;
  talk_time_seconds: number;
  leads_count: number;
}

export interface AttendanceRecord {
  date: string;
  status: 'on_time' | 'late' | 'half_day' | 'absent';
  hr_approved?: boolean;
}

export interface SalaryBreakdown {
  // Base values
  baseSalary: number;
  workingDaysInMonth: number;
  dailyPotential: number;
  
  // Ghost earnings (days before system launch)
  ghostDays: number;
  ghostEarnings: number;
  
  // Live performance earnings
  activeDays: number;
  activeEarnings: number;
  
  // Today's earnings
  todayEarnings: number;
  todayPerformanceScore: number;
  todayAttendanceMultiplier: number;
  
  // "3 Lates Free" Policy Deduction
  latePolicy: {
    totalLates: number;
    totalHalfDays: number;
    freeLatesUsed: number;
    freeLatesRemaining: number;
    excessLates: number;
    deductionDays: number;
    deductionAmount: number;
  };
  
  // Totals
  totalEarned: number;
  totalEarnedBeforeDeduction: number;
  projectedSalary: number;
  
  // Breakdown by attendance status
  attendanceBreakdown: {
    onTime: { days: number; earnings: number };
    late: { days: number; earnings: number };
    halfDay: { days: number; earnings: number };
    absent: { days: number; earnings: number };
  };
  
  // Performance summary
  performanceSummary: {
    totalCalls: number;
    totalTalkTime: number;
    totalLeads: number;
    avgPerformanceScore: number;
  };
}

/**
 * Calculate performance score (0-1.0) based on daily stats
 * Step 5 Formula:
 * - CallScore = (calls / 250) * 0.40 (Cap at 0.4)
 * - TalkScore = (seconds / 3600) * 0.30 (Cap at 0.3)
 * - LeadScore = (leads / 3) * 0.30 (Cap at 0.3)
 * - TotalMultiplier = CallScore + TalkScore + LeadScore (Max 1.0)
 */
export function calculatePerformanceScore(stats: DailyStats): number {
  // CallScore: (calls / 250) * 0.40, capped at 0.40
  const callsScore = Math.min((stats.calls_count / DAILY_TARGETS.calls) * PERFORMANCE_WEIGHTS.calls, PERFORMANCE_WEIGHTS.calls);
  
  // TalkScore: (seconds / 3600) * 0.30, capped at 0.30
  const talkTimeScore = Math.min((stats.talk_time_seconds / DAILY_TARGETS.talk_time_seconds) * PERFORMANCE_WEIGHTS.talk_time, PERFORMANCE_WEIGHTS.talk_time);
  
  // LeadScore: (leads / 3) * 0.30, capped at 0.30
  const leadsScore = Math.min((stats.leads_count / DAILY_TARGETS.leads) * PERFORMANCE_WEIGHTS.leads, PERFORMANCE_WEIGHTS.leads);
  
  // TotalMultiplier = sum of all scores (max 1.0)
  const totalMultiplier = callsScore + talkTimeScore + leadsScore;
  
  return Math.round(totalMultiplier * 100) / 100; // 0.00 to 1.00
}

/**
 * Calculate the "3 Lates Free" policy deduction
 * 
 * Policy:
 * - First 3 lates in a month are FREE (0 deduction)
 * - Starting from 4th late onwards, each late = 0.5 day deduction
 * - Half days always = 0.5 day deduction
 * 
 * Formula:
 * ExcessLates = Math.max(0, TotalLates - 3)
 * TotalDeductionDays = (CountHalfDays * 0.5) + (ExcessLates * 0.5)
 * DeductionAmount = TotalDeductionDays * DailyPotential
 */
export function calculateLatePolicyDeduction(
  totalLates: number,
  totalHalfDays: number,
  dailyPotential: number
): {
  excessLates: number;
  deductionDays: number;
  deductionAmount: number;
  freeLatesUsed: number;
  freeLatesRemaining: number;
} {
  // First 3 lates are free
  const freeLatesUsed = Math.min(totalLates, LATE_POLICY.FREE_LATES);
  const freeLatesRemaining = LATE_POLICY.FREE_LATES - freeLatesUsed;
  
  // Excess lates beyond the free allowance
  const excessLates = Math.max(0, totalLates - LATE_POLICY.FREE_LATES);
  
  // Total deduction days = (half days * 0.5) + (excess lates * 0.5)
  const deductionDays = (totalHalfDays * 0.5) + (excessLates * LATE_POLICY.EXCESS_LATE_PENALTY);
  
  // Deduction amount
  const deductionAmount = deductionDays * dailyPotential;
  
  return {
    excessLates,
    deductionDays: Math.round(deductionDays * 100) / 100,
    deductionAmount: Math.round(deductionAmount * 100) / 100,
    freeLatesUsed,
    freeLatesRemaining,
  };
}

/**
 * Calculate daily earnings based on performance and attendance
 * 
 * NEW "3 Lates Free" Policy:
 * - on_time: 100% of daily potential * performance
 * - late: 100% of daily potential * performance (deduction handled at month level)
 * - half_day: 50% of daily potential * performance
 * - absent: 0% earnings
 * 
 * Note: Late deductions are now calculated at the month level via calculateLatePolicyDeduction()
 */
export function calculateDailyEarnings(
  dailyPotential: number,
  performanceScore: number,
  attendanceStatus: 'on_time' | 'late' | 'half_day' | 'absent',
  hrApproved: boolean = false
): number {
  const attendanceMultiplier = ATTENDANCE_MULTIPLIERS[attendanceStatus];
  let earnings = dailyPotential * performanceScore * attendanceMultiplier;
  
  // Step 5 Penalty: If half_day AND NOT hr_approved, apply additional 0.5 penalty
  if (attendanceStatus === 'half_day' && !hrApproved) {
    earnings = earnings * 0.5;
  }
  
  return Math.round(earnings * 100) / 100;
}

/**
 * Calculate complete salary breakdown for a user
 */
export function calculateSalaryBreakdown(
  baseSalary: number,
  systemLaunchDate: Date,
  dailyStats: DailyStats[],
  attendanceRecords: AttendanceRecord[],
  todayStats?: DailyStats,
  todayAttendance?: AttendanceRecord
): SalaryBreakdown {
  const now = getCurrentDateKarachi();
  const today = formatDateYMD(now);
  
  // Calculate base values
  const workingDaysInMonth = getWorkingDaysInMonth(now);
  const dailyPotential = baseSalary / workingDaysInMonth;
  
  // Calculate ghost days and earnings (pre-launch days assumed 100%)
  const ghostDays = getGhostDays(systemLaunchDate, now);
  const ghostEarnings = ghostDays * dailyPotential; // 100% for ghost days
  
  // Create attendance lookup map (includes hr_approved)
  const attendanceMap = new Map<string, AttendanceRecord>();
  attendanceRecords.forEach(a => attendanceMap.set(a.date, a));
  
  // Calculate earnings for previous active days (excluding today)
  let activeEarnings = 0;
  let activeDays = 0;
  let totalCalls = 0;
  let totalTalkTime = 0;
  let totalLeads = 0;
  let totalPerformanceScore = 0;
  
  const attendanceBreakdown = {
    onTime: { days: 0, earnings: 0 },
    late: { days: 0, earnings: 0 },
    halfDay: { days: 0, earnings: 0 },
    absent: { days: 0, earnings: 0 },
  };
  
  // Process each day's stats (excluding today)
  for (const stats of dailyStats) {
    if (stats.date === today) continue; // Skip today, we'll handle it separately
    
    const attendanceRecord = attendanceMap.get(stats.date);
    const attendance = attendanceRecord?.status || 'absent';
    const hrApproved = attendanceRecord?.hr_approved || false;
    
    const performanceScore = calculatePerformanceScore(stats);
    const dayEarnings = calculateDailyEarnings(dailyPotential, performanceScore, attendance, hrApproved);
    
    activeEarnings += dayEarnings;
    activeDays++;
    totalCalls += stats.calls_count;
    totalTalkTime += stats.talk_time_seconds;
    totalLeads += stats.leads_count;
    totalPerformanceScore += performanceScore;
    
    // Update attendance breakdown
    switch (attendance) {
      case 'on_time':
        attendanceBreakdown.onTime.days++;
        attendanceBreakdown.onTime.earnings += dayEarnings;
        break;
      case 'late':
        attendanceBreakdown.late.days++;
        attendanceBreakdown.late.earnings += dayEarnings;
        break;
      case 'half_day':
        attendanceBreakdown.halfDay.days++;
        attendanceBreakdown.halfDay.earnings += dayEarnings;
        break;
      case 'absent':
        attendanceBreakdown.absent.days++;
        attendanceBreakdown.absent.earnings += dayEarnings;
        break;
    }
  }
  
  // Calculate today's earnings
  let todayEarnings = 0;
  let todayPerformanceScore = 0;
  let todayAttendanceMultiplier = 0;
  
  if (todayStats && todayAttendance) {
    todayPerformanceScore = calculatePerformanceScore(todayStats);
    todayAttendanceMultiplier = ATTENDANCE_MULTIPLIERS[todayAttendance.status];
    const todayHrApproved = todayAttendance.hr_approved || false;
    
    todayEarnings = calculateDailyEarnings(
      dailyPotential,
      todayPerformanceScore,
      todayAttendance.status,
      todayHrApproved
    );
    
    // Add today's stats to totals
    totalCalls += todayStats.calls_count;
    totalTalkTime += todayStats.talk_time_seconds;
    totalLeads += todayStats.leads_count;
    totalPerformanceScore += todayPerformanceScore;
    
    // Update attendance breakdown for today
    switch (todayAttendance.status) {
      case 'on_time':
        attendanceBreakdown.onTime.days++;
        attendanceBreakdown.onTime.earnings += todayEarnings;
        break;
      case 'late':
        attendanceBreakdown.late.days++;
        attendanceBreakdown.late.earnings += todayEarnings;
        break;
      case 'half_day':
        attendanceBreakdown.halfDay.days++;
        attendanceBreakdown.halfDay.earnings += todayEarnings;
        break;
      case 'absent':
        attendanceBreakdown.absent.days++;
        attendanceBreakdown.absent.earnings += todayEarnings;
        break;
    }
  }
  
  // Calculate "3 Lates Free" policy deduction
  // Total lates and half days for the month
  const totalLates = attendanceBreakdown.late.days;
  const totalHalfDays = attendanceBreakdown.halfDay.days;
  
  const latePolicyDeduction = calculateLatePolicyDeduction(
    totalLates,
    totalHalfDays,
    dailyPotential
  );
  
  // Total earned BEFORE late policy deduction = Ghost + Previous Days + Today
  const totalEarnedBeforeDeduction = ghostEarnings + activeEarnings + todayEarnings;
  
  // Total earned AFTER late policy deduction
  const totalEarned = totalEarnedBeforeDeduction - latePolicyDeduction.deductionAmount;
  
  // Calculate projected salary (assuming average performance continues)
  const daysWorkedSoFar = activeDays + (todayStats ? 1 : 0);
  const avgPerformanceScore = daysWorkedSoFar > 0 
    ? totalPerformanceScore / daysWorkedSoFar 
    : 1.0;
  
  const workingDaysElapsed = getWorkingDaysElapsed(now);
  const remainingDays = workingDaysInMonth - workingDaysElapsed;
  const projectedRemainingEarnings = remainingDays * dailyPotential * avgPerformanceScore;
  const projectedSalary = totalEarned + projectedRemainingEarnings;
  
  return {
    baseSalary,
    workingDaysInMonth,
    dailyPotential: Math.round(dailyPotential * 100) / 100,
    
    ghostDays,
    ghostEarnings: Math.round(ghostEarnings * 100) / 100,
    
    activeDays,
    activeEarnings: Math.round(activeEarnings * 100) / 100,
    
    todayEarnings: Math.round(todayEarnings * 100) / 100,
    todayPerformanceScore: Math.round(todayPerformanceScore * 100),
    todayAttendanceMultiplier,
    
    // "3 Lates Free" Policy Info
    latePolicy: {
      totalLates,
      totalHalfDays,
      freeLatesUsed: latePolicyDeduction.freeLatesUsed,
      freeLatesRemaining: latePolicyDeduction.freeLatesRemaining,
      excessLates: latePolicyDeduction.excessLates,
      deductionDays: latePolicyDeduction.deductionDays,
      deductionAmount: latePolicyDeduction.deductionAmount,
    },
    
    totalEarnedBeforeDeduction: Math.round(totalEarnedBeforeDeduction * 100) / 100,
    totalEarned: Math.round(totalEarned * 100) / 100,
    projectedSalary: Math.round(projectedSalary * 100) / 100,
    
    attendanceBreakdown: {
      onTime: {
        days: attendanceBreakdown.onTime.days,
        earnings: Math.round(attendanceBreakdown.onTime.earnings * 100) / 100,
      },
      late: {
        days: attendanceBreakdown.late.days,
        earnings: Math.round(attendanceBreakdown.late.earnings * 100) / 100,
      },
      halfDay: {
        days: attendanceBreakdown.halfDay.days,
        earnings: Math.round(attendanceBreakdown.halfDay.earnings * 100) / 100,
      },
      absent: {
        days: attendanceBreakdown.absent.days,
        earnings: Math.round(attendanceBreakdown.absent.earnings * 100) / 100,
      },
    },
    
    performanceSummary: {
      totalCalls,
      totalTalkTime,
      totalLeads,
      avgPerformanceScore: Math.round(avgPerformanceScore * 100),
    },
  };
}
