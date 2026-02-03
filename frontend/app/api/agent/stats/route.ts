import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { query, queryOne } from '@/lib/db';
import {
  calculateSalaryBreakdown,
  DailyStats,
  AttendanceRecord,
} from '@/lib/salary-utils';
import {
  getCurrentDateKarachi,
  formatDateYMD,
  getFirstDayOfMonth,
  getTodayDate,
  getWorkingDaysInMonth,
  getWorkingDaysElapsed,
  getWorkingDaysRemaining,
  formatDurationHuman,
} from '@/lib/date-utils';
import { getCurrentShiftWindow, getShiftStartTimeUTC, isWeekendShift } from '@/lib/attendance-utils';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'
);

interface User {
  id: number;
  username: string;
  full_name: string;
  extension_number: string;
  role: 'hr' | 'agent';
  base_salary: number;
  shift_start: string;
  shift_end: string;
  sales_target: number;
  created_at: string;
  employment_type?: 'full_time' | 'part_time';
}

interface DbDailyStats {
  date: string;
  calls_count: string | number;
  talk_time_seconds: string | number;
  leads_count: string | number;
  sales_amount: string | number;
}

interface DbAttendance {
  date: string;
  status: 'on_time' | 'late' | 'half_day' | 'absent';
  check_in_time: string | null;
  check_out_time: string | null;
  hr_approved: boolean;
}

interface SystemSettings {
  key: string;
  value: string;
}

export async function GET(request: NextRequest) {
  try {
    // Verify JWT token
    const authHeader = request.headers.get('authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { status: 'error', message: 'No token provided' },
        { status: 401 }
      );
    }

    const token = authHeader.split(' ')[1];
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const userId = payload.userId as number;

    // Fetch user data
    const user = await queryOne<User>(
      'SELECT * FROM users WHERE id = $1',
      [userId]
    );

    if (!user) {
      return NextResponse.json(
        { status: 'error', message: 'User not found' },
        { status: 404 }
      );
    }

    if (user.role !== 'agent') {
      return NextResponse.json(
        { status: 'error', message: 'Stats are only available for agents' },
        { status: 403 }
      );
    }

    // Get system launch date
    const launchSetting = await queryOne<SystemSettings>(
      "SELECT * FROM system_settings WHERE key = 'system_launch_date'",
      []
    );
    
    // Default to beginning of current month if not set
    const systemLaunchDate = launchSetting 
      ? new Date(launchSetting.value) 
      : new Date(getCurrentDateKarachi().getFullYear(), getCurrentDateKarachi().getMonth(), 1);

    // Keep these for local date comparisons
    const now = getCurrentDateKarachi();
    
    // Get CURRENT_DATE from database to ensure consistent timezone handling
    // This matches how dashboard.py works
    interface DbDate { today: string }
    const dbDateResult = await queryOne<DbDate>(
      `SELECT CURRENT_DATE::text as today`,
      []
    );
    const today = dbDateResult?.today || getTodayDate();

    // Use CURRENT_DATE from database to match dashboard.py logic
    // This ensures consistent timezone handling with the database server
    
    // Fetch all daily stats for this month from daily_stats table
    const dailyStatsRows = await query<DbDailyStats>(
      `SELECT date::text, calls_count, talk_time_seconds, leads_count, COALESCE(sales_amount, 0) as sales_amount
       FROM daily_stats 
       WHERE user_id = $1 
         AND date >= DATE_TRUNC('month', CURRENT_DATE)::date
         AND date <= CURRENT_DATE
       ORDER BY date ASC`,
      [userId]
    );

    // Also fetch real-time call data from call_logs table (aggregated by date)
    // This gets the actual call data that 3CX is logging
    // Using same logic as dashboard.py: call_time::date = CURRENT_DATE for today
    interface CallLogStats {
      date: string;
      calls_count: string | number;
      talk_time_seconds: string | number;
    }
    
    // Only count calls with duration >= 30 seconds for talk time calculation
    const callLogStats = await query<CallLogStats>(
      `SELECT 
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
       WHERE agent_extension = $1 
         AND call_time::date >= DATE_TRUNC('month', CURRENT_DATE)::date
         AND call_time::date <= CURRENT_DATE
       GROUP BY call_time::date
       ORDER BY date ASC`,
      [user.extension_number]
    );

    // Fetch all attendance records for this month
    const attendanceRows = await query<DbAttendance>(
      `SELECT date::text, status, check_in_time, check_out_time, hr_approved
       FROM attendance 
       WHERE user_id = $1 
         AND date >= DATE_TRUNC('month', CURRENT_DATE)::date
         AND date <= CURRENT_DATE
       ORDER BY date ASC`,
      [userId]
    );

    // Calculate current shift window based on agent's shift times
    // Uses the new timezone-aware helper that properly converts PKT to UTC
    const shiftTiming = getShiftStartTimeUTC(user.shift_start, user.shift_end);
    
    // Check if this shift falls on a weekend (based on shift START date)
    // Saturday/Sunday = Weekend (System Paused)
    const isWeekend = isWeekendShift(user.shift_start, user.shift_end);
    
    // Also get the legacy shift window for compatibility
    const shiftWindow = getCurrentShiftWindow(user.shift_start, user.shift_end);
    
    // Fetch TODAY's stats based on agent's shift window (not calendar day)
    // This handles overnight shifts like 9 PM - 5 AM correctly
    // The query uses UTC timestamps since database stores in UTC
    interface ShiftStats {
      calls_count: string | number;
      talk_time_seconds: string | number;
    }
    
    console.log(`📊 Fetching shift stats for ${user.extension_number}:`);
    console.log(`   Shift Start (PKT): ${shiftTiming.shiftStartFormatted}`);
    console.log(`   Shift Start (UTC): ${shiftTiming.shiftStartUTC.toISOString()}`);
    console.log(`   Shift End (UTC): ${shiftTiming.shiftEndUTC.toISOString()}`);
    
    // Only count calls with duration >= 30 seconds for talk time calculation
    const shiftStats = await queryOne<ShiftStats>(
      `SELECT 
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
       WHERE agent_extension = $1 
         AND call_time >= $2
         AND call_time < $3`,
      [user.extension_number, shiftTiming.shiftStartUTC.toISOString(), shiftTiming.shiftEndUTC.toISOString()]
    );

    // Get meeting_seconds from daily_stats for the current shift date
    // This is manually added by HR for Zoom/Google Meet demos that aren't in call_logs
    interface MeetingTimeResult { meeting_seconds: string | number | null }
    const meetingTimeResult = await queryOne<MeetingTimeResult>(
      `SELECT COALESCE(meeting_seconds, 0) as meeting_seconds
       FROM daily_stats 
       WHERE user_id = $1 AND date = $2`,
      [userId, shiftTiming.shiftDatePKT]
    );
    const meetingSeconds = Number(meetingTimeResult?.meeting_seconds || 0);

    // Get leads and sales_amount from daily_stats for the shift date (converted/qualified leads, NOT imported CSV leads)
    // Calculate leads_count for current shift: count of approved leads reviewed in shift window
    const leadsCountResult = await queryOne<{ count: string }>(
      `SELECT COUNT(*)::int as count
         FROM agent_leads
        WHERE agent_id = $1
          AND status = 'approved'
          AND (reviewed_at >= $2 AND reviewed_at < $3)
      `,
      [userId, shiftTiming.shiftStartUTC.toISOString(), shiftTiming.shiftEndUTC.toISOString()]
    );
    // Fallback: If no reviewed_at, fallback to created_at (legacy)
    const fallbackLeadsCountResult = await queryOne<{ count: string }>(
      `SELECT COUNT(*)::int as count
         FROM agent_leads
        WHERE agent_id = $1
          AND status = 'approved'
          AND (reviewed_at IS NULL AND created_at >= $2 AND created_at < $3)
      `,
      [userId, shiftTiming.shiftStartUTC.toISOString(), shiftTiming.shiftEndUTC.toISOString()]
    );
    const leads_count = Number(leadsCountResult?.count || 0) + Number(fallbackLeadsCountResult?.count || 0);
    
    // Calculate sales_amount for current shift: sum of approved sales in shift window
    const salesAmountResult = await queryOne<{ total: string }>(
      `SELECT COALESCE(SUM(total_deal_value), 0)::numeric as total
         FROM sales
        WHERE agent_id = $1
          AND approval_status = 'approved'
          AND (approved_at >= $2 AND approved_at < $3)
      `,
      [userId, shiftTiming.shiftStartUTC.toISOString(), shiftTiming.shiftEndUTC.toISOString()]
    );
    const sales_amount = Number(salesAmountResult?.total || 0);
    
    const shiftDailyStatsResult = { leads_count, sales_amount };

    // Merge daily_stats with call_logs data
    // call_logs has the real-time call data from 3CX
    // daily_stats has leads and any manually added data
    const statsMap = new Map<string, DailyStats>();
    
    // First, add data from daily_stats (for leads)
    for (const row of dailyStatsRows) {
      statsMap.set(row.date, {
        date: row.date,
        calls_count: Number(row.calls_count),
        talk_time_seconds: Number(row.talk_time_seconds),
        leads_count: Number(row.leads_count),
      });
    }
    
    // Then, merge/override with call_logs data (real 3CX calls)
    for (const row of callLogStats) {
      const existing = statsMap.get(row.date);
      if (existing) {
        // Merge: use call_logs for calls/talk_time, keep leads from daily_stats
        existing.calls_count = Number(row.calls_count);
        existing.talk_time_seconds = Number(row.talk_time_seconds);
      } else {
        // New entry from call_logs
        statsMap.set(row.date, {
          date: row.date,
          calls_count: Number(row.calls_count),
          talk_time_seconds: Number(row.talk_time_seconds),
          leads_count: 0, // No leads data from call_logs
        });
      }
    }
    
    // Convert to array and sort by date
    const dailyStats: DailyStats[] = Array.from(statsMap.values())
      .sort((a, b) => a.date.localeCompare(b.date));

    const attendanceRecords: AttendanceRecord[] = attendanceRows.map(row => ({
      date: row.date,
      status: row.status,
      hr_approved: row.hr_approved,
    }));

    // Build TODAY's stats from SHIFT data (calls from shift window + leads from shift date)
    // This ensures proper calculation for overnight shifts
    // IMPORTANT: Add meetingSeconds to talk_time_seconds (HR-added Zoom/Google Meet time)
    const shiftBasedTodayStats: DailyStats = {
      date: shiftTiming.shiftDatePKT,
      calls_count: Number(shiftStats?.calls_count || 0),
      talk_time_seconds: Number(shiftStats?.talk_time_seconds || 0) + meetingSeconds,
      leads_count: Number(shiftDailyStatsResult?.leads_count || 0),
    };

    // Get today's attendance (use shift date for overnight shifts)
    const todayAttendance = attendanceRecords.find(a => a.date === shiftTiming.shiftDatePKT) 
      || attendanceRecords.find(a => a.date === today);

    // Calculate salary breakdown using shift-based stats
    const salaryBreakdown = calculateSalaryBreakdown(
      Number(user.base_salary),
      systemLaunchDate,
      dailyStats.filter(s => s.date !== shiftTiming.shiftDatePKT && s.date !== today), // Previous days
      attendanceRecords.filter(a => a.date !== shiftTiming.shiftDatePKT && a.date !== today), // Previous attendance
      shiftBasedTodayStats,
      todayAttendance,
      user.employment_type || 'full_time'
    );

    // Additional context for the frontend
    const workingDaysInMonth = getWorkingDaysInMonth(now);
    const workingDaysElapsed = getWorkingDaysElapsed(now);
    const workingDaysRemaining = getWorkingDaysRemaining(now);

    // Format response
    return NextResponse.json({
      status: 'success',
      data: {
        user: {
          id: user.id,
          fullName: user.full_name,
          extensionNumber: user.extension_number,
          baseSalary: Number(user.base_salary),
          shiftStart: user.shift_start,
          shiftEnd: user.shift_end,
        },
        
        // Salary breakdown
        salary: {
          baseSalary: salaryBreakdown.baseSalary,
          dailyPotential: salaryBreakdown.dailyPotential,
          
          // Ghost earnings (pre-launch days)
          ghostDays: salaryBreakdown.ghostDays,
          ghostEarnings: salaryBreakdown.ghostEarnings,
          
          // Previous active days
          activeDays: salaryBreakdown.activeDays,
          activeEarnings: salaryBreakdown.activeEarnings,
          
          // Today
          todayEarnings: salaryBreakdown.todayEarnings,
          todayPerformanceScore: salaryBreakdown.todayPerformanceScore,
          todayAttendanceMultiplier: salaryBreakdown.todayAttendanceMultiplier,
          
          // Totals (after late policy deduction)
          totalEarnedBeforeDeduction: salaryBreakdown.totalEarnedBeforeDeduction,
          totalEarned: salaryBreakdown.totalEarned,
          projectedSalary: salaryBreakdown.projectedSalary,
          
          // Percentage of potential salary earned
          percentageEarned: Math.round((salaryBreakdown.totalEarned / salaryBreakdown.baseSalary) * 100),
        },
        
        // Attendance breakdown
        attendance: {
          breakdown: salaryBreakdown.attendanceBreakdown,
          todayStatus: todayAttendance?.status || null,
          todayHrApproved: todayAttendance?.hr_approved || false,
          is_late_counter: salaryBreakdown.attendanceBreakdown.late.days + salaryBreakdown.attendanceBreakdown.halfDay.days,
          // For CheckInButton component
          check_in_time: attendanceRows.find(a => a.date === today)?.check_in_time || null,
          check_out_time: attendanceRows.find(a => a.date === today)?.check_out_time || null,
          
          // "3 Lates Free" Policy Info
          latePolicy: salaryBreakdown.latePolicy,
        },
        
        // Performance summary
        performance: {
          totalCalls: salaryBreakdown.performanceSummary.totalCalls,
          totalTalkTime: salaryBreakdown.performanceSummary.totalTalkTime,
          totalTalkTimeFormatted: formatDurationHuman(salaryBreakdown.performanceSummary.totalTalkTime),
          totalLeads: salaryBreakdown.performanceSummary.totalLeads,
          avgPerformanceScore: salaryBreakdown.performanceSummary.avgPerformanceScore,
        },
        
        // Today's live stats - based on agent's SHIFT window, not calendar day
        // For overnight shifts like 9 PM - 5 AM, this shows stats from shift start to now
        // Stats reset at 9:00 PM PKT every day
        today: {
          date: shiftTiming.shiftDatePKT,
          shiftStart: user.shift_start,
          shiftEnd: user.shift_end,
          shiftStartFormatted: shiftTiming.shiftStartFormatted, // "Jan 29, 2026 9:00 PM"
          calls: Number(shiftStats?.calls_count || 0),
          talkTime: shiftBasedTodayStats.talk_time_seconds, // Includes call_logs + meeting time
          talkTimeFormatted: formatDurationHuman(shiftBasedTodayStats.talk_time_seconds),
          leads: Number(shiftDailyStatsResult?.leads_count || 0),
          salesAmount: Number(shiftDailyStatsResult?.sales_amount || 0),
          salesTarget: Number(user.sales_target || 0),
          targetHit: Number(user.sales_target) > 0 && Number(shiftDailyStatsResult?.sales_amount || 0) >= Number(user.sales_target),
          performanceScore: salaryBreakdown.todayPerformanceScore,
          attendanceStatus: todayAttendance?.status || 'absent',
          earnings: salaryBreakdown.todayEarnings,
        },
        
        // Step 5 Response Format (earned_today, metrics, attendance) - also shift-based
        earned_today: `Rs ${salaryBreakdown.todayEarnings.toLocaleString('en-PK', { minimumFractionDigits: 2 })}`,
        metrics: {
          calls: Number(shiftStats?.calls_count || 0),
          talk_time: formatDurationHuman(shiftBasedTodayStats.talk_time_seconds),
          talk_time_seconds: shiftBasedTodayStats.talk_time_seconds, // Includes call_logs + meeting time
          leads: Number(shiftDailyStatsResult?.leads_count || 0),
          sales_amount: Number(shiftDailyStatsResult?.sales_amount || 0),
          sales_target: Number(user.sales_target || 0),
          stats_since: shiftTiming.shiftStartFormatted, // For frontend display
        },
        
        // Month context
        month: {
          workingDays: workingDaysInMonth,
          workingDaysElapsed,
          workingDaysRemaining,
          systemLaunchDate: formatDateYMD(systemLaunchDate),
          currentDate: today,
        },
        
        // Weekend status - based on shift START date
        // Saturday/Sunday shifts = Weekend (System Paused)
        is_weekend: isWeekend,
      },
    });
  } catch (error) {
    console.error('Stats API error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Failed to fetch stats' },
      { status: 500 }
    );
  }
}
