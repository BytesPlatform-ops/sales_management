import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import {
  calculateRampedPerformanceScore,
  calculateDailyEarnings,
  ATTENDANCE_MULTIPLIERS,
} from '@/lib/salary-utils';
import { getAllTargets } from '@/lib/targets';
import { loadRampLookup } from '@/lib/training/ramp';
import { getAgentStartDates } from '@/lib/agent-start';
import { mergeDay, shiftCallTotalsSql } from '@/lib/call-stats';
import { legacyAuth, withAuth } from '@/lib/auth/session';

interface JwtPayload {
  userId: number;
  username: string;
  role: string;
}

interface Agent {
  id: number;
  username: string;
  full_name: string;
  extension_number: string;
  base_salary: number;
  shift_start: string;
  shift_end: string;
  employment_type?: 'full_time' | 'part_time';
}

interface DailyStatsRow {
  user_id: number;
  date: string;
  calls_count: string | number;
  talk_time_seconds: string | number;
  leads_count: string | number;
  meeting_seconds: string | number;
}

interface AttendanceRow {
  user_id: number;
  date: string;
  status: 'on_time' | 'late' | 'half_day' | 'absent';
  hr_approved: boolean;
}

interface CallLogStats {
  user_id: number;
  date: string;
  calls_count: string | number;
  talk_time_seconds: string | number;
}

interface AgentPayroll {
  id: number;
  name: string;
  username: string;
  baseSalary: number;
  workingDays: number;
  daysWorked: number;
  daysOnTime: number;
  daysLate: number;
  daysHalfDay: number;
  daysAbsent: number;
  totalCalls: number;
  totalTalkTime: number;
  totalLeads: number;
  avgPerformanceScore: number;
  performanceBonus: number;
  deductions: number;
  finalPayout: number;
  dailyBreakdown: {
    date: string;
    earnings: number;
    performanceScore: number;
    attendanceStatus: string;
    rampPhase: string;
  }[];
  rampPhase: string;
  quotaMultiplier: number;
}

async function GET__handler(request: NextRequest) {
  try {
    // 1. Verify JWT token and HR role
    const authHeader = request.headers.get('authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { status: 'error', message: 'No token provided' },
        { status: 401 }
      );
    }

    const token = authHeader.split(' ')[1];
    const { payload } = await legacyAuth(request);
    const jwtPayload = payload as unknown as JwtPayload;

    if (jwtPayload.role !== 'hr') {
      return NextResponse.json(
        { status: 'error', message: 'HR access required' },
        { status: 403 }
      );
    }

    // 2. Get month parameter (default to current month)
    const { searchParams } = new URL(request.url);
    const monthParam = searchParams.get('month'); // Format: YYYY-MM
    
    let year: number, month: number;
    if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
      [year, month] = monthParam.split('-').map(Number);
    } else {
      const now = new Date();
      year = now.getFullYear();
      month = now.getMonth() + 1;
    }
    
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const monthEnd = `${year}-${String(month).padStart(2, '0')}-${new Date(year, month, 0).getDate()}`;
    
    // HR-configurable performance targets (DB-backed, falls back to defaults)
    const allTargets = await getAllTargets();

    // 3. Get all agents
    const agents = await query<Agent>(
      `SELECT id, username, full_name, extension_number, base_salary, shift_start, shift_end, employment_type
       FROM users 
       WHERE role = 'agent'
       ORDER BY full_name`
    );

    // Training-module ramp: penalty-free phases + reduced quota per day (B.9)
    const rampFor = await loadRampLookup(agents.map((a) => Number(a.id)));
    const startDates = await getAgentStartDates(agents.map((a) => Number(a.id)));
    const todayYMD = new Date().toISOString().slice(0, 10);

    // 4. Get daily_stats for the month
    const dailyStatsRows = await query<DailyStatsRow>(
      `SELECT user_id, date::text, calls_count, talk_time_seconds, leads_count,
              COALESCE(meeting_seconds, 0) AS meeting_seconds
       FROM daily_stats
       WHERE date >= $1 AND date <= $2
       ORDER BY date`,
      [monthStart, monthEnd]
    );

    // 5. Get call_logs per agent per shift date (lib/call-stats.ts): every call
    // counts; talk time only from calls >= 30 s; each agent's own shift times.
    const callLogStats = await query<CallLogStats>(
      `SELECT * FROM ${shiftCallTotalsSql('$1::date', '$2::date')} c ORDER BY date`,
      [monthStart, monthEnd]
    );

    // 6. Get attendance records for the month
    const attendanceRows = await query<AttendanceRow>(
      `SELECT user_id, date::text, status, hr_approved
       FROM attendance
       WHERE date >= $1 AND date <= $2
       ORDER BY date`,
      [monthStart, monthEnd]
    );

    // 7. Calculate working days in the month (excluding weekends)
    const workingDays = getWorkingDaysInMonth(year, month);

    // 8. Build payroll data for each agent
    const agentPayrolls: AgentPayroll[] = [];
    
    // Create lookup maps
    const dailyStatsMap = new Map<string, DailyStatsRow[]>();
    dailyStatsRows.forEach(row => {
      const key = `${row.user_id}`;
      if (!dailyStatsMap.has(key)) dailyStatsMap.set(key, []);
      dailyStatsMap.get(key)!.push(row);
    });
    
    const callLogsMap = new Map<string, CallLogStats[]>();
    callLogStats.forEach(row => {
      const key = `${row.user_id}`;
      if (!callLogsMap.has(key)) callLogsMap.set(key, []);
      callLogsMap.get(key)!.push(row);
    });
    
    const attendanceMap = new Map<string, AttendanceRow[]>();
    attendanceRows.forEach(row => {
      const key = `${row.user_id}`;
      if (!attendanceMap.has(key)) attendanceMap.set(key, []);
      attendanceMap.get(key)!.push(row);
    });

    for (const agent of agents) {
      // Agents who hadn't started by the end of this month aren't on its payroll.
      const startDate = startDates.get(Number(agent.id));
      if (startDate && startDate > monthEnd) continue;

      const dailyPotential = agent.base_salary / workingDays;
      const agentDailyStats = dailyStatsMap.get(`${agent.id}`) || [];
      const agentCallLogs = callLogsMap.get(`${agent.id}`) || [];
      const agentAttendance = attendanceMap.get(`${agent.id}`) || [];
      
      // Create attendance lookup by date
      const attendanceLookup = new Map<string, AttendanceRow>();
      agentAttendance.forEach(a => attendanceLookup.set(a.date, a));
      
      // Merge daily_stats with call_logs (mergeDay): call_logs give calls and
      // call talk time; HR-added meeting time is always added on top.
      const statsPerDay = new Map<string, { calls: number; talkTime: number; leads: number }>();
      const statsByDate = new Map(agentDailyStats.map(s => [s.date, s]));
      const callsByDate = new Map(agentCallLogs.map(c => [c.date, c]));
      for (const date of Array.from(new Set([...Array.from(statsByDate.keys()), ...Array.from(callsByDate.keys())]))) {
        const s = statsByDate.get(date);
        const c = callsByDate.get(date);
        const merged = mergeDay(
          c ? { calls: Number(c.calls_count), talk: Number(c.talk_time_seconds) } : undefined,
          s ? { calls: Number(s.calls_count), talk: Number(s.talk_time_seconds), meeting: Number(s.meeting_seconds) } : undefined
        );
        statsPerDay.set(date, { calls: merged.calls, talkTime: merged.talk, leads: s ? Number(s.leads_count) : 0 });
      }
      
      // Calculate payroll
      let daysWorked = 0;
      let daysOnTime = 0;
      let daysLate = 0;
      let daysHalfDay = 0;
      let daysAbsent = 0;
      let totalCalls = 0;
      let totalTalkTime = 0;
      let totalLeads = 0;
      let totalPerformanceScore = 0;
      let performanceEarnings = 0;
      let fullPotentialEarnings = 0;
      const dailyBreakdown: AgentPayroll['dailyBreakdown'] = [];
      
      // Process each day in the month
      const daysInMonth = new Date(year, month, 0).getDate();
      for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dayOfWeek = new Date(year, month - 1, day).getDay();
        
        // Skip weekends
        if (dayOfWeek === 0 || dayOfWeek === 6) continue;
        
        // Skip future dates
        const today = new Date();
        const currentDate = new Date(year, month - 1, day);
        if (currentDate > today) continue;

        // Skip days before the agent started: not absences, and any calls on a
        // reused extension belong to its previous owner.
        if (startDate && dateStr < startDate) continue;

        const attendance = attendanceLookup.get(dateStr);
        const stats = statsPerDay.get(dateStr);
        
        const attendanceStatus = attendance?.status || 'absent';
        const hrApproved = attendance?.hr_approved || false;
        
        // Calculate performance
        const dayStats = {
          date: dateStr,
          calls_count: stats?.calls || 0,
          talk_time_seconds: stats?.talkTime || 0,
          leads_count: stats?.leads || 0,
        };
        
        const ramp = rampFor(Number(agent.id), dateStr);
        const performanceScore = calculateRampedPerformanceScore(
          dayStats,
          agent.employment_type || 'full_time',
          allTargets[agent.employment_type || 'full_time'],
          ramp
        );
        const dayEarnings = calculateDailyEarnings(dailyPotential, performanceScore, attendanceStatus);
        
        // Track totals
        daysWorked++;
        totalCalls += dayStats.calls_count;
        totalTalkTime += dayStats.talk_time_seconds;
        totalLeads += dayStats.leads_count;
        totalPerformanceScore += performanceScore;
        performanceEarnings += dayEarnings;
        fullPotentialEarnings += dailyPotential;
        
        // Track attendance
        switch (attendanceStatus) {
          case 'on_time': daysOnTime++; break;
          case 'late': daysLate++; break;
          case 'half_day': daysHalfDay++; break;
          case 'absent': daysAbsent++; break;
        }
        
        dailyBreakdown.push({
          date: dateStr,
          earnings: dayEarnings,
          performanceScore,
          attendanceStatus,
          rampPhase: ramp.phase,
        });
      }
      
      // Calculate final values
      const avgPerformanceScore = daysWorked > 0 ? totalPerformanceScore / daysWorked : 0;
      const deductions = fullPotentialEarnings - performanceEarnings;
      const performanceBonus = performanceEarnings - (daysWorked * dailyPotential * 0.5); // Bonus above 50% base
      
      agentPayrolls.push({
        id: agent.id,
        name: agent.full_name,
        username: agent.username,
        baseSalary: agent.base_salary,
        workingDays,
        daysWorked,
        daysOnTime,
        daysLate,
        daysHalfDay,
        daysAbsent,
        totalCalls,
        totalTalkTime,
        totalLeads,
        avgPerformanceScore: Math.round(avgPerformanceScore * 100),
        performanceBonus: Math.max(0, performanceBonus),
        deductions: Math.max(0, deductions),
        finalPayout: performanceEarnings,
        dailyBreakdown,
        rampPhase: rampFor(Number(agent.id), todayYMD).phase,
        quotaMultiplier: rampFor(Number(agent.id), todayYMD).multiplier,
      });
    }

    // 9. Calculate summary statistics
    const totalPayout = agentPayrolls.reduce((sum, a) => sum + a.finalPayout, 0);
    const totalDeductions = agentPayrolls.reduce((sum, a) => sum + a.deductions, 0);
    const topPerformer = agentPayrolls.length > 0 
      ? agentPayrolls.reduce((top, a) => a.finalPayout > top.finalPayout ? a : top)
      : null;

    // 10. Calculate daily payout trend
    const payoutTrend: { date: string; total: number }[] = [];
    const daysInMonth = new Date(year, month, 0).getDate();
    let runningTotal = 0;
    
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dayOfWeek = new Date(year, month - 1, day).getDay();
      
      // Skip weekends
      if (dayOfWeek === 0 || dayOfWeek === 6) continue;
      
      // Skip future dates
      const today = new Date();
      const currentDate = new Date(year, month - 1, day);
      if (currentDate > today) continue;
      
      // Sum all agent earnings for this day
      const dayTotal = agentPayrolls.reduce((sum, agent) => {
        const dayData = agent.dailyBreakdown.find(d => d.date === dateStr);
        return sum + (dayData?.earnings || 0);
      }, 0);
      
      runningTotal += dayTotal;
      payoutTrend.push({ date: dateStr, total: Math.round(runningTotal) });
    }

    return NextResponse.json({
      status: 'success',
      data: {
        month: `${year}-${String(month).padStart(2, '0')}`,
        monthName: new Date(year, month - 1).toLocaleString('en-US', { month: 'long', year: 'numeric' }),
        workingDays,
        summary: {
          totalPayout: Math.round(totalPayout),
          totalDeductions: Math.round(totalDeductions),
          topPerformer: topPerformer ? {
            name: topPerformer.name,
            earnings: Math.round(topPerformer.finalPayout),
          } : null,
          agentCount: agentPayrolls.length,
        },
        agents: agentPayrolls.map(a => ({
          ...a,
          finalPayout: Math.round(a.finalPayout),
          deductions: Math.round(a.deductions),
          performanceBonus: Math.round(a.performanceBonus),
        })),
        payoutTrend,
      },
    });
  } catch (error) {
    console.error('Payroll API error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Failed to fetch payroll data' },
      { status: 500 }
    );
  }
}

// Helper function to calculate working days in a month
function getWorkingDaysInMonth(year: number, month: number): number {
  const daysInMonth = new Date(year, month, 0).getDate();
  let workingDays = 0;
  
  for (let day = 1; day <= daysInMonth; day++) {
    const dayOfWeek = new Date(year, month - 1, day).getDay();
    // Skip weekends (0 = Sunday, 6 = Saturday)
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      workingDays++;
    }
  }
  
  return workingDays;
}

export const GET = withAuth(GET__handler);
