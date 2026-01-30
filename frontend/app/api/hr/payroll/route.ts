import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { query } from '@/lib/db';
import {
  calculatePerformanceScore,
  calculateDailyEarnings,
  ATTENDANCE_MULTIPLIERS,
} from '@/lib/salary-utils';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'
);

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
}

interface DailyStatsRow {
  user_id: number;
  date: string;
  calls_count: string | number;
  talk_time_seconds: string | number;
  leads_count: string | number;
}

interface AttendanceRow {
  user_id: number;
  date: string;
  status: 'on_time' | 'late' | 'half_day' | 'absent';
  hr_approved: boolean;
}

interface CallLogStats {
  agent_extension: string;
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
  }[];
}

export async function GET(request: NextRequest) {
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
    const { payload } = await jwtVerify(token, JWT_SECRET);
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
    
    // 3. Get all agents
    const agents = await query<Agent>(
      `SELECT id, username, full_name, extension_number, base_salary, shift_start, shift_end
       FROM users 
       WHERE role = 'agent'
       ORDER BY full_name`
    );

    // 4. Get daily_stats for the month
    const dailyStatsRows = await query<DailyStatsRow>(
      `SELECT user_id, date::text, calls_count, talk_time_seconds, leads_count
       FROM daily_stats
       WHERE date >= $1 AND date <= $2
       ORDER BY date`,
      [monthStart, monthEnd]
    );

    // 5. Get call_logs aggregated by day for the month
    // Only count calls with duration >= 30 seconds for talk time
    const callLogStats = await query<CallLogStats>(
      `SELECT 
         agent_extension,
         call_time::date::text as date,
         COUNT(*) as calls_count,
         COALESCE(SUM(
           CASE 
             WHEN call_duration ~ '^\\d+:\\d+:\\d+$' THEN 
               CASE WHEN (SPLIT_PART(call_duration, ':', 1)::int * 3600 + 
                          SPLIT_PART(call_duration, ':', 2)::int * 60 + 
                          SPLIT_PART(call_duration, ':', 3)::int) >= 30 THEN
                 (SPLIT_PART(call_duration, ':', 1)::int * 3600 + 
                  SPLIT_PART(call_duration, ':', 2)::int * 60 + 
                  SPLIT_PART(call_duration, ':', 3)::int)
               ELSE 0 END
             WHEN call_duration ~ '^\\d+:\\d+$' THEN 
               CASE WHEN (SPLIT_PART(call_duration, ':', 1)::int * 60 + 
                          SPLIT_PART(call_duration, ':', 2)::int) >= 30 THEN
                 (SPLIT_PART(call_duration, ':', 1)::int * 60 + 
                  SPLIT_PART(call_duration, ':', 2)::int)
               ELSE 0 END
             ELSE 0
           END
         ), 0) as talk_time_seconds
       FROM call_logs
       WHERE call_time::date >= $1 AND call_time::date <= $2
       GROUP BY agent_extension, call_time::date
       ORDER BY date`,
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
      const key = row.agent_extension;
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
      const dailyPotential = agent.base_salary / workingDays;
      const agentDailyStats = dailyStatsMap.get(`${agent.id}`) || [];
      const agentCallLogs = callLogsMap.get(agent.extension_number) || [];
      const agentAttendance = attendanceMap.get(`${agent.id}`) || [];
      
      // Create attendance lookup by date
      const attendanceLookup = new Map<string, AttendanceRow>();
      agentAttendance.forEach(a => attendanceLookup.set(a.date, a));
      
      // Merge daily_stats with call_logs
      const statsPerDay = new Map<string, { calls: number; talkTime: number; leads: number }>();
      
      // First, add from daily_stats (for leads)
      agentDailyStats.forEach(s => {
        statsPerDay.set(s.date, {
          calls: Number(s.calls_count),
          talkTime: Number(s.talk_time_seconds),
          leads: Number(s.leads_count),
        });
      });
      
      // Then, merge/override with call_logs (real-time data)
      agentCallLogs.forEach(c => {
        const existing = statsPerDay.get(c.date);
        if (existing) {
          existing.calls = Number(c.calls_count);
          existing.talkTime = Number(c.talk_time_seconds);
        } else {
          statsPerDay.set(c.date, {
            calls: Number(c.calls_count),
            talkTime: Number(c.talk_time_seconds),
            leads: 0,
          });
        }
      });
      
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
        
        const performanceScore = calculatePerformanceScore(dayStats);
        const dayEarnings = calculateDailyEarnings(dailyPotential, performanceScore, attendanceStatus, hrApproved);
        
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
