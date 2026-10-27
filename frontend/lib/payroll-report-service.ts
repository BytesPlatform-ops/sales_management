/**
 * Month-End Payroll Report Service
 * ---------------------------------
 * Single source of truth for the month-end Call Agent Salary & Performance
 * reports. Reuses the OFFICIAL payroll primitives from salary-utils.ts:
 *
 *   - calculatePerformanceScore   (Calls 60% + Talk Time 40%; leads = 0%)
 *   - calculateDailyEarnings      (dailyPotential × performance × attendanceMultiplier)
 *   - calculateLatePolicyDeduction(first 3 lates free; excess late = 0.5 day)
 *
 * It does NOT re-implement salary math and it does NOT use the Daily Stats
 * "estimated earnings" formula (40/30/30, 2-of-3) anywhere.
 *
 * DOUBLE-DEDUCTION SAFETY (see spec §3):
 *   A half-day already loses 50% of the day via the daily attendance
 *   multiplier inside calculateDailyEarnings(). salary-utils'
 *   calculateLatePolicyDeduction() ALSO subtracts (halfDays × 0.5 × potential)
 *   at month end — which double-counts half-days. This report therefore
 *   applies ONLY the excess-late portion of the month-end deduction to the
 *   final payable amount, and surfaces the half-day policy figure as an
 *   informational reconciliation line (already applied daily, not subtracted
 *   again). See PAYROLL_POLICY_NOTES below.
 *
 * The frontend preview and the PDF both consume the DTO produced here, so
 * displayed values and downloaded values can never disagree.
 */

import { query } from './db';
import {
  calculatePerformanceScore,
  calculateDailyEarnings,
  calculateLatePolicyDeduction,
  ATTENDANCE_MULTIPLIERS,
  LATE_POLICY,
  DailyTargets,
} from './salary-utils';
import { getAllTargets, AllTargets } from './targets';
import { mergeDay, shiftCallTotalsSql } from './call-stats';

export const PAYROLL_POLICY_NOTES = {
  source: 'lib/salary-utils.ts (official payroll primitives)',
  performance: 'Calls 60% + Talk Time 40%. Leads and sales never affect salary.',
  talkTimeRule:
    'Talk time counts ONLY calls with duration >= 30 seconds. 0-second and short ' +
    'calls still count toward the CALL COUNT, but not toward talk time (matches ' +
    'the official /api/hr/payroll methodology).',
  noCheckInRule:
    'If a working day has NO attendance record but the agent made calls, the day ' +
    'is paid as PRESENT (on_time ×1.0) based on performance — not zeroed as absent. ' +
    'The missing record is still surfaced (missing-data + issue reason) so HR can fix it.',
  doubleDeductionPrevention:
    'Half-days lose 50% via the daily attendance multiplier only. The month-end ' +
    'late-policy deduction applied to Final Payable is the EXCESS-LATE portion ' +
    'exclusively (excessLates × 0.5 × dailyPotential). The half-day policy amount ' +
    'is shown for reconciliation but is NOT subtracted a second time.',
  knownInconsistencies: [
    'salary-utils.calculateSalaryBreakdown() subtracts BOTH the daily half-day ' +
      'multiplier AND (halfDays × 0.5 × potential) at month end — double counting ' +
      'half-days. This report deliberately avoids that.',
    'app/api/hr/payroll/route.ts omits the excess-late month-end deduction ' +
      'entirely, so its finalPayout equals this report BEFORE the excess-late line.',
  ],
} as const;

export type EmploymentType = 'full_time' | 'part_time';
export type AttendanceStatus = 'on_time' | 'late' | 'half_day' | 'absent';

// ---------------------------------------------------------------------------
// Types — pure compute inputs (no DB) so the calculation is unit-testable.
// ---------------------------------------------------------------------------

export interface AgentInput {
  id: number;
  employeeCode: string; // extension number (falls back to id)
  name: string;
  employmentType: EmploymentType;
  baseSalary: number;
  joiningDate: string | null;
  isActive: boolean;
}

export interface DayInput {
  date: string; // YYYY-MM-DD (Asia/Karachi)
  hasAttendance: boolean;
  status: AttendanceStatus; // 'absent' when no record on a working day
  hrApproved: boolean;
  hasStats: boolean;
  calls: number;
  talkTimeSeconds: number;
  leads: number;
}

// ---------------------------------------------------------------------------
// Types — output DTO (consumed identically by preview and PDF).
// ---------------------------------------------------------------------------

export interface IssueDayRow {
  date: string;
  attendanceLabel: string;
  status: AttendanceStatus | 'missing';
  calls: number;
  callsTarget: number;
  talkTimeSeconds: number;
  talkTimeTargetSeconds: number;
  leads: number;
  leadsTarget: number;
  performancePct: number; // 0..100
  attendanceFactor: number; // 1.0 / 0.5 / 0
  dailyPotential: number;
  earned: number;
  salaryImpact: number; // dailyPotential - earned (day-level)
  lateNumber: number | null; // chronological late # in the month, if late
  reasons: string[];
}

export interface AgentMonthlyReport {
  // Identity
  agentId: number;
  employeeCode: string;
  name: string;
  employmentType: EmploymentType;
  joiningDate: string | null;
  isActive: boolean;
  month: string; // YYYY-MM
  monthName: string; // "August 2026"
  generatedAt: string; // ISO
  referenceId: string;

  // Targets used
  targets: { calls: number; talkTimeSeconds: number; leads: number };
  targetSource: 'hr_configured' | 'default';

  // Base
  baseSalary: number;
  workingDaysInMonth: number;
  processedDays: number; // non-weekend, non-future days considered
  dailyPotential: number;

  // Performance summary
  totalCalls: number;
  totalTalkTimeSeconds: number;
  totalLeads: number;
  callsAchievementPct: number; // avg of daily min(calls/target,1)
  talkAchievementPct: number;
  avgPerformancePct: number;
  fullPerformanceDays: number;
  reducedPerformanceDays: number;

  // Attendance summary
  daysOnTime: number;
  daysLate: number;
  freeLateCount: number;
  excessLateCount: number;
  daysHalfDay: number;
  daysAbsent: number;
  daysApprovedLeave: number; // schema has no leave status -> 0
  daysUnpaidLeave: number; // schema has no leave status -> 0
  missingAttendanceDays: number;
  missingStatsDays: number;

  // Salary reconciliation
  potentialSalary: number; // processedDays × dailyPotential
  performanceAdjustedEarnings: number; // Σ daily earnings (perf × attendance)
  dailyAttendanceImpact: number; // portion of reduction from attendance multipliers
  dailyPerformanceImpact: number; // portion of reduction from performance shortfall
  excessLateDeduction: number; // month-end, subtracted from final
  halfDayPolicyAmountInfo: number; // informational (already applied daily)
  manualAdditions: number; // no adjustments table -> 0
  manualDeductions: number; // no adjustments table -> 0
  finalPayableSalary: number;
  totalSalaryDifference: number; // potential - finalPayable

  // Explainability
  issueDays: IssueDayRow[];
  issueDayCount: number;
  hasMissingData: boolean;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export function formatPKR(amount: number): string {
  return (
    'Rs ' +
    (Math.round((amount + Number.EPSILON) * 100) / 100).toLocaleString('en-PK', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

export function formatMinutes(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h > 0) return `${h}h ${rem}m`;
  return `${m}m`;
}

export function sanitizeFilename(s: string): string {
  return (s || '')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
    .toLowerCase();
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// ---------------------------------------------------------------------------
// Month / calendar helpers (Asia/Karachi, weekends = Sat/Sun — matches the
// existing /api/hr/payroll engine).
// ---------------------------------------------------------------------------

export function parseMonth(monthParam: string | null): { year: number; month: number; month0: string } {
  if (!monthParam || !/^\d{4}-\d{2}$/.test(monthParam)) {
    throw new Error('Invalid month format. Expected YYYY-MM.');
  }
  const [year, month] = monthParam.split('-').map(Number);
  if (month < 1 || month > 12) throw new Error('Invalid month. Must be 01-12.');
  return { year, month, month0: `${year}-${String(month).padStart(2, '0')}` };
}

function workingDaysInMonth(year: number, month: number): number {
  const daysInMonth = new Date(year, month, 0).getDate();
  let n = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month - 1, d).getDay();
    if (dow !== 0 && dow !== 6) n++;
  }
  return n;
}

/** Today's date in Asia/Karachi as YYYY-MM-DD. */
function todayKarachi(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

// ---------------------------------------------------------------------------
// PURE COMPUTE — no DB. Fully unit-testable.
// ---------------------------------------------------------------------------

export interface ComputeContext {
  year: number;
  month: number;
  monthName: string;
  generatedAt: string; // ISO
  targets: DailyTargets;
  targetSource: 'hr_configured' | 'default';
  workingDays: number;
}

const ATTENDANCE_LABEL: Record<AttendanceStatus, string> = {
  on_time: 'On Time',
  late: 'Late',
  half_day: 'Half Day',
  absent: 'Absent',
};

export function computeAgentMonthlyReport(
  agent: AgentInput,
  days: DayInput[],
  ctx: ComputeContext
): AgentMonthlyReport {
  const monthStr = `${ctx.year}-${String(ctx.month).padStart(2, '0')}`;
  const dailyPotential = ctx.workingDays > 0 ? agent.baseSalary / ctx.workingDays : 0;
  const targets = ctx.targets;

  // First pass: assign chronological late numbers across the month.
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  let lateSeq = 0;
  const lateNumberByDate = new Map<string, number>();
  for (const d of sorted) {
    if (d.status === 'late') {
      lateSeq++;
      lateNumberByDate.set(d.date, lateSeq);
    }
  }

  let totalCalls = 0;
  let totalTalkTimeSeconds = 0;
  let totalLeads = 0;
  let sumPerf = 0;
  let sumCallsAchieve = 0;
  let sumTalkAchieve = 0;
  let performanceAdjustedEarnings = 0;
  let potentialSum = 0;
  let dailyAttendanceImpact = 0;
  let dailyPerformanceImpact = 0;

  let daysOnTime = 0;
  let daysLate = 0;
  let daysHalfDay = 0;
  let daysAbsent = 0;
  let missingAttendanceDays = 0;
  let missingStatsDays = 0;
  let fullPerformanceDays = 0;
  let reducedPerformanceDays = 0;

  const issueDays: IssueDayRow[] = [];

  for (const d of sorted) {
    const stats = { date: d.date, calls_count: d.calls, talk_time_seconds: d.talkTimeSeconds, leads_count: d.leads };
    const performanceScore = calculatePerformanceScore(stats, agent.employmentType, targets); // 0..1

    // Attendance fix: if an agent has NO attendance record on a working day but
    // DID make calls, they clearly worked — do not zero the day as 'absent'.
    // Pay it as present (on_time ×1.0) based on performance. The missing record
    // is still surfaced (missingAttendanceDays + issue reason) so HR can fix it.
    const workedButNoCheckIn = !d.hasAttendance && (d.calls > 0 || d.talkTimeSeconds > 0);
    const effStatus: AttendanceStatus = workedButNoCheckIn ? 'on_time' : d.status;

    const attendanceFactor = ATTENDANCE_MULTIPLIERS[effStatus];
    const earned = calculateDailyEarnings(dailyPotential, performanceScore, effStatus);

    const callsAchieve = targets.calls > 0 ? Math.min(d.calls / targets.calls, 1) : 1;
    const talkAchieve =
      targets.talk_time_seconds > 0 ? Math.min(d.talkTimeSeconds / targets.talk_time_seconds, 1) : 1;

    // Reduction attribution: performance-adjusted-full = potential × perf (attendance=1).
    const performanceAdjustedFull = dailyPotential * performanceScore;
    const perfImpact = dailyPotential - performanceAdjustedFull; // lost to performance
    const attImpact = performanceAdjustedFull - earned; // lost to attendance multiplier

    totalCalls += d.calls;
    totalTalkTimeSeconds += d.talkTimeSeconds;
    totalLeads += d.leads;
    sumPerf += performanceScore;
    sumCallsAchieve += callsAchieve;
    sumTalkAchieve += talkAchieve;
    performanceAdjustedEarnings += earned;
    potentialSum += dailyPotential;
    dailyAttendanceImpact += attImpact;
    dailyPerformanceImpact += perfImpact;

    switch (effStatus) {
      case 'on_time': daysOnTime++; break;
      case 'late': daysLate++; break;
      case 'half_day': daysHalfDay++; break;
      case 'absent': daysAbsent++; break;
    }
    if (!d.hasAttendance) missingAttendanceDays++;
    if (!d.hasStats) missingStatsDays++;

    const isFullPerf = performanceScore >= 1;
    if (isFullPerf) fullPerformanceDays++;
    else reducedPerformanceDays++;

    // ---- Issue-day detection ----
    const callsShort = d.calls < targets.calls;
    const talkShort = d.talkTimeSeconds < targets.talk_time_seconds;
    const attendanceIssue = effStatus === 'late' || effStatus === 'half_day' || effStatus === 'absent';
    const missing = !d.hasAttendance || !d.hasStats;
    const perfBelowFull = performanceScore < 1;
    const earnedBelowPotential = earned < dailyPotential - 0.005;

    const isIssue =
      callsShort || talkShort || attendanceIssue || missing || perfBelowFull || earnedBelowPotential;

    if (!isIssue) continue;

    const lateNumber = lateNumberByDate.get(d.date) ?? null;
    const trueAbsent = effStatus === 'absent';
    const reasons: string[] = [];

    if (workedButNoCheckIn) {
      reasons.push('No check-in recorded but calls present — paid as present (no salary deduction); please verify attendance');
    } else if (d.status === 'absent' && !d.hasAttendance) {
      reasons.push('Attendance record missing (treated as absent)');
    } else if (d.status === 'absent') {
      reasons.push('Absent');
    }
    if (d.status === 'half_day') reasons.push('Half-day attendance (0.5× via daily multiplier)');
    if (d.status === 'late') {
      if (lateNumber !== null && lateNumber <= LATE_POLICY.FREE_LATES) {
        reasons.push(`Late #${lateNumber} — no monthly deduction; within first ${LATE_POLICY.FREE_LATES} free lates`);
      } else if (lateNumber !== null) {
        reasons.push(`Late #${lateNumber} — 0.5-day month-end deduction`);
      } else {
        reasons.push('Late attendance');
      }
    }
    if (!d.hasStats && !trueAbsent) reasons.push('Missing 3CX statistics');
    if (callsShort && talkShort && !trueAbsent) {
      reasons.push(`Calls short by ${targets.calls - d.calls}; talk time short by ${Math.ceil((targets.talk_time_seconds - d.talkTimeSeconds) / 60)} min`);
    } else if (callsShort && !trueAbsent) {
      reasons.push(`Calls short by ${targets.calls - d.calls} (${d.calls}/${targets.calls})`);
    } else if (talkShort && !trueAbsent) {
      reasons.push(`Talk time short by ${Math.ceil((targets.talk_time_seconds - d.talkTimeSeconds) / 60)} min (${formatMinutes(d.talkTimeSeconds)}/${formatMinutes(targets.talk_time_seconds)})`);
    }
    if (reasons.length === 0) reasons.push('Earnings below daily potential');

    issueDays.push({
      date: d.date,
      attendanceLabel: workedButNoCheckIn ? 'No check-in' : d.hasAttendance ? ATTENDANCE_LABEL[d.status] : 'Missing',
      status: d.hasAttendance ? d.status : 'missing',
      calls: d.calls,
      callsTarget: targets.calls,
      talkTimeSeconds: d.talkTimeSeconds,
      talkTimeTargetSeconds: targets.talk_time_seconds,
      leads: d.leads,
      leadsTarget: targets.leads,
      performancePct: Math.round(performanceScore * 100),
      attendanceFactor,
      dailyPotential: round2(dailyPotential),
      earned: round2(earned),
      salaryImpact: round2(dailyPotential - earned),
      lateNumber,
      reasons,
    });
  }

  const processedDays = sorted.length;

  // Month-end late policy (excess-late portion ONLY — half-day already applied daily).
  const excessLateCount = Math.max(0, daysLate - LATE_POLICY.FREE_LATES);
  const freeLateCount = Math.min(daysLate, LATE_POLICY.FREE_LATES);
  const excessLateDeduction = round2(excessLateCount * LATE_POLICY.EXCESS_LATE_PENALTY * dailyPotential);
  const halfDayPolicyAmountInfo = round2(daysHalfDay * 0.5 * dailyPotential);

  const manualAdditions = 0; // no adjustments table in schema
  const manualDeductions = 0;

  const finalPayableSalary = round2(
    performanceAdjustedEarnings - excessLateDeduction + manualAdditions - manualDeductions
  );
  const potentialSalary = round2(potentialSum);
  const totalSalaryDifference = round2(potentialSalary - finalPayableSalary);

  // Add an issue-day marker for excess-late deductions that had a late row.
  // (already reflected in each late issue-day's reason).

  const warnings: string[] = [];
  if (missingAttendanceDays > 0) warnings.push(`${missingAttendanceDays} working day(s) had no attendance record.`);
  if (missingStatsDays > 0) warnings.push(`${missingStatsDays} working day(s) had no 3CX statistics.`);
  if (agent.baseSalary <= 0) warnings.push('Base salary is zero or missing for this employee.');
  if (ctx.workingDays <= 0) warnings.push('Working-day calendar returned zero working days for this month.');

  return {
    agentId: agent.id,
    employeeCode: agent.employeeCode,
    name: agent.name,
    employmentType: agent.employmentType,
    joiningDate: agent.joiningDate,
    isActive: agent.isActive,
    month: monthStr,
    monthName: ctx.monthName,
    generatedAt: ctx.generatedAt,
    referenceId: `PR-${monthStr}-${String(agent.id).padStart(4, '0')}`,

    targets: { calls: targets.calls, talkTimeSeconds: targets.talk_time_seconds, leads: targets.leads },
    targetSource: ctx.targetSource,

    baseSalary: round2(agent.baseSalary),
    workingDaysInMonth: ctx.workingDays,
    processedDays,
    dailyPotential: round2(dailyPotential),

    totalCalls,
    totalTalkTimeSeconds,
    totalLeads,
    callsAchievementPct: processedDays > 0 ? Math.round((sumCallsAchieve / processedDays) * 100) : 0,
    talkAchievementPct: processedDays > 0 ? Math.round((sumTalkAchieve / processedDays) * 100) : 0,
    avgPerformancePct: processedDays > 0 ? Math.round((sumPerf / processedDays) * 100) : 0,
    fullPerformanceDays,
    reducedPerformanceDays,

    daysOnTime,
    daysLate,
    freeLateCount,
    excessLateCount,
    daysHalfDay,
    daysAbsent,
    daysApprovedLeave: 0,
    daysUnpaidLeave: 0,
    missingAttendanceDays,
    missingStatsDays,

    potentialSalary,
    performanceAdjustedEarnings: round2(performanceAdjustedEarnings),
    dailyAttendanceImpact: round2(dailyAttendanceImpact),
    dailyPerformanceImpact: round2(dailyPerformanceImpact),
    excessLateDeduction,
    halfDayPolicyAmountInfo,
    manualAdditions,
    manualDeductions,
    finalPayableSalary,
    totalSalaryDifference,

    issueDays,
    issueDayCount: issueDays.length,
    hasMissingData: missingAttendanceDays > 0 || missingStatsDays > 0,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// DB LOADING — bulk fetch for the whole month (no N+1), then compute per agent.
// ---------------------------------------------------------------------------

interface AgentRow {
  id: number;
  full_name: string;
  extension_number: string;
  base_salary: number;
  employment_type: EmploymentType | null;
  is_active: boolean;
  created_at: string;
}

interface DailyStatsRow {
  user_id: number;
  date: string;
  calls_count: string | number;
  talk_time_seconds: string | number;
  leads_count: string | number;
  meeting_seconds: string | number;
}
interface CallLogRow {
  user_id: number;
  date: string;
  calls_count: string | number;
  talk_time_seconds: string | number;
}
interface AttendanceRow {
  user_id: number;
  date: string;
  status: AttendanceStatus;
  hr_approved: boolean;
}

export interface MonthlyReportBundle {
  month: string;
  monthName: string;
  workingDays: number;
  generatedAt: string;
  reports: AgentMonthlyReport[];
}

/**
 * Build reports for every call agent that was active during the month or had
 * attendance/stats data in it. If agentId is provided, restricts to that agent.
 */
export async function buildMonthlyReports(
  monthParam: string,
  opts?: { agentId?: number }
): Promise<MonthlyReportBundle> {
  const { year, month, month0 } = parseMonth(monthParam);
  const monthStart = `${month0}-01`;
  const monthEnd = `${month0}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;
  const monthName = new Date(year, month - 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const workingDays = workingDaysInMonth(year, month);
  const generatedAt = new Date().toISOString();

  const allTargets: AllTargets = await getAllTargets();
  // targetSource: performance_targets table drives getAllTargets; treat as configured
  // unless it fell back to defaults (best-effort — getAllTargets already merges).
  const targetSource: 'hr_configured' | 'default' = 'hr_configured';

  const agentFilter = opts?.agentId ? 'AND u.id = $3' : '';
  const agentParams: any[] = opts?.agentId ? [monthStart, monthEnd, opts.agentId] : [monthStart, monthEnd];

  // Agents: role='agent', that are active OR had any data during the month.
  const agents = await query<AgentRow>(
    `SELECT DISTINCT u.id, u.full_name, u.extension_number, u.base_salary,
            u.employment_type, u.is_active, u.created_at::text
       FROM users u
       LEFT JOIN attendance a ON a.user_id = u.id AND a.date >= $1 AND a.date <= $2
       LEFT JOIN daily_stats ds ON ds.user_id = u.id AND ds.date >= $1 AND ds.date <= $2
      WHERE u.role = 'agent'
        AND (u.is_active = true OR a.id IS NOT NULL OR ds.id IS NOT NULL)
        ${agentFilter}
      ORDER BY u.full_name`,
    agentParams
  );

  const rangeParams = [monthStart, monthEnd];
  const [dailyStatsRows, callLogRows, attendanceRows] = await Promise.all([
    query<DailyStatsRow>(
      `SELECT user_id, date::text, calls_count, talk_time_seconds, leads_count,
              COALESCE(meeting_seconds, 0) AS meeting_seconds
         FROM daily_stats WHERE date >= $1 AND date <= $2`,
      rangeParams
    ),
    // Calls per agent per shift date (lib/call-stats.ts): every call counts;
    // talk time only from calls >= 30 s; each agent's own shift times.
    query<CallLogRow>(
      `SELECT * FROM ${shiftCallTotalsSql('$1::date', '$2::date')} c`,
      rangeParams
    ),
    query<AttendanceRow>(
      `SELECT user_id, date::text, status, hr_approved
         FROM attendance WHERE date >= $1 AND date <= $2`,
      rangeParams
    ),
  ]);

  // Index the bulk data.
  const statsByUser = new Map<number, Map<string, { calls: number; talk: number; meeting: number; leads: number }>>();
  for (const r of dailyStatsRows) {
    if (!statsByUser.has(r.user_id)) statsByUser.set(r.user_id, new Map());
    statsByUser.get(r.user_id)!.set(r.date, {
      calls: Number(r.calls_count),
      talk: Number(r.talk_time_seconds),
      meeting: Number(r.meeting_seconds),
      leads: Number(r.leads_count),
    });
  }
  const callsByUser = new Map<number, Map<string, { calls: number; talk: number }>>();
  for (const r of callLogRows) {
    const uid = Number(r.user_id);
    if (!callsByUser.has(uid)) callsByUser.set(uid, new Map());
    callsByUser.get(uid)!.set(r.date, {
      calls: Number(r.calls_count),
      talk: Number(r.talk_time_seconds),
    });
  }
  const attByUser = new Map<number, Map<string, AttendanceRow>>();
  for (const r of attendanceRows) {
    if (!attByUser.has(r.user_id)) attByUser.set(r.user_id, new Map());
    attByUser.get(r.user_id)!.set(r.date, r);
  }

  // Enumerate the working days of the month (non-weekend, non-future).
  const today = todayKarachi();
  const daysInMonth = new Date(year, month, 0).getDate();
  const workingDayDates: string[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month - 1, d).getDay();
    if (dow === 0 || dow === 6) continue;
    const dateStr = `${month0}-${String(d).padStart(2, '0')}`;
    if (dateStr > today) continue; // skip future
    workingDayDates.push(dateStr);
  }

  const reports: AgentMonthlyReport[] = [];
  for (const a of agents) {
    const employmentType: EmploymentType = a.employment_type === 'part_time' ? 'part_time' : 'full_time';
    const targets = allTargets[employmentType];
    const statsMap = statsByUser.get(a.id);
    const callsMap = callsByUser.get(Number(a.id));
    const attMap = attByUser.get(a.id);

    const days: DayInput[] = workingDayDates.map((date) => {
      const s = statsMap?.get(date);
      const c = callsMap?.get(date);
      const att = attMap?.get(date);
      // call_logs give calls and call talk time; HR-added meeting time is
      // always added on top; leads come from daily_stats.
      const { calls, talk } = mergeDay(c, s);
      const leads = s ? s.leads : 0;
      const hasStats = Boolean(s) || Boolean(c);
      return {
        date,
        hasAttendance: Boolean(att),
        status: (att?.status as AttendanceStatus) || 'absent',
        hrApproved: att?.hr_approved || false,
        hasStats,
        calls,
        talkTimeSeconds: talk,
        leads,
      };
    });

    reports.push(
      computeAgentMonthlyReport(
        {
          id: a.id,
          employeeCode: a.extension_number || String(a.id),
          name: a.full_name,
          employmentType,
          baseSalary: Number(a.base_salary) || 0,
          joiningDate: a.created_at ? a.created_at.slice(0, 10) : null,
          isActive: a.is_active,
        },
        days,
        { year, month, monthName, generatedAt, targets, targetSource, workingDays }
      )
    );
  }

  reports.sort((x, y) => x.name.localeCompare(y.name));

  return { month: month0, monthName, workingDays, generatedAt, reports };
}
