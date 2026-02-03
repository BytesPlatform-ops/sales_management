import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { query } from '@/lib/db';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'
);

interface JwtPayload {
  userId: number;
  username: string;
  role: string;
}

/**
 * Get the working date based on shift start time (9 PM logic)
 * If current time is before 6 AM, the "working date" is yesterday
 * This handles overnight shifts that start at 9 PM and end at 4 AM
 */
function getWorkingDate(dateStr?: string): string {
  if (dateStr) {
    return dateStr;
  }

  const now = new Date();

  // Get current date in Asia/Karachi timezone using reliable formatting
  const dateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const hourFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Karachi',
    hour: 'numeric',
    hour12: false,
  });

  const currentDate = dateFormatter.format(now); // Returns YYYY-MM-DD
  const hour = parseInt(hourFormatter.format(now), 10);

  // If it's before 6 AM, we're still in yesterday's shift
  if (hour < 6) {
    const [year, month, day] = currentDate.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    date.setDate(date.getDate() - 1);
    return date.toISOString().split('T')[0];
  }

  return currentDate;
}

/**
 * Calculate estimated daily earnings based on performance
 */
function calculateEstimatedEarnings(
  baseSalary: number,
  workingDaysInMonth: number,
  callsCount: number,
  talkTimeSeconds: number,
  leadsCount: number,
  attendanceStatus: string | null,
  hrApproved: boolean,
  employmentType: string = 'full_time'
): number {
  const dailyPotential = baseSalary / workingDaysInMonth;
  
  // Performance targets
  const targets = employmentType === 'part_time' 
    ? { calls: 75, talkTime: 1800, leads: 2 }
    : { calls: 150, talkTime: 3600, leads: 3 };
  
  // Calculate performance score (0-1.0)
  const callsScore = Math.min((callsCount / targets.calls) * 0.40, 0.40);
  const talkTimeScore = Math.min((talkTimeSeconds / targets.talkTime) * 0.30, 0.30);
  const leadsScore = Math.min((leadsCount / targets.leads) * 0.30, 0.30);
  const performanceScore = callsScore + talkTimeScore + leadsScore;
  
  // Attendance multiplier
  let attendanceMultiplier = 1.0;
  if (attendanceStatus === 'half_day') {
    attendanceMultiplier = hrApproved ? 0.5 : 0.25;
  } else if (attendanceStatus === 'absent' || !attendanceStatus) {
    attendanceMultiplier = 0;
  }
  
  return Math.round(dailyPotential * performanceScore * attendanceMultiplier * 100) / 100;
}

// GET - Get daily stats for all agents on a specific date
export async function GET(request: NextRequest) {
  try {
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

    // Check if user is HR
    if (jwtPayload.role !== 'hr') {
      return NextResponse.json(
        { status: 'error', message: 'Access denied. HR only.' },
        { status: 403 }
      );
    }

    // Get date from query params (defaults to current working date)
    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get('date');
    const targetDate = getWorkingDate(dateParam || undefined);

    // Debug logging
    const now = new Date();
    const debugInfo = {
      serverTime: now.toISOString(),
      requestedDate: dateParam,
      resolvedDate: targetDate,
    };
    console.log('Daily Stats Debug:', debugInfo);

    // Calculate working days in month for earnings calculation
    const targetDateObj = new Date(targetDate);
    const year = targetDateObj.getFullYear();
    const month = targetDateObj.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    let workingDaysInMonth = 0;
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(year, month, day);
      const dayOfWeek = d.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        workingDaysInMonth++;
      }
    }

    // Fetch all active agents with their daily stats, attendance, leads, and sales
    const agentStats = await query<any>(`
      SELECT 
        u.id,
        u.full_name,
        u.extension_number,
        u.base_salary,
        u.sales_target,
        u.shift_start,
        u.shift_end,
        u.employment_type,
        u.is_active,
        
        -- Attendance data
        a.check_in_time,
        a.check_out_time,
        a.status as attendance_status,
        a.hr_approved,
        
        -- Daily stats (leads_count from daily_stats)
        COALESCE(ds.leads_count, 0) as leads_count,
        COALESCE(ds.sales_amount, 0) as sales_amount,
        
        -- Calls and talk time from call_logs
        COALESCE(call_stats.call_count, 0) as calls_count,
        COALESCE(call_stats.talk_time_seconds, 0) as talk_time_seconds,
        
        -- Leads breakdown (approved and pending for the date)
        COALESCE(leads_approved.count, 0) as leads_approved,
        COALESCE(leads_pending.count, 0) as leads_pending,
        
        -- Sales total for the date
        COALESCE(sales_total.total_value, 0) as total_sales_value
        
      FROM users u
      
      LEFT JOIN attendance a ON a.user_id = u.id AND a.date = $1
      
      LEFT JOIN daily_stats ds ON ds.user_id = u.id AND ds.date = $1
      
      -- Get calls and talk time from call_logs
      LEFT JOIN (
        SELECT 
          agent_extension,
          COUNT(*) as call_count,
          SUM(
            (CAST(SPLIT_PART(call_duration, ':', 1) AS INTEGER) * 60 +
             CAST(SPLIT_PART(call_duration, ':', 2) AS INTEGER))
          ) as talk_time_seconds
        FROM call_logs
        WHERE DATE(call_time AT TIME ZONE 'Asia/Karachi') = $1::date
        GROUP BY agent_extension
      ) call_stats ON call_stats.agent_extension = u.extension_number
      
      LEFT JOIN (
        SELECT agent_id, COUNT(*) as count
        FROM agent_leads
        WHERE DATE(created_at) = $1 AND status = 'approved'
        GROUP BY agent_id
      ) leads_approved ON leads_approved.agent_id = u.id
      
      LEFT JOIN (
        SELECT agent_id, COUNT(*) as count
        FROM agent_leads
        WHERE DATE(created_at) = $1 AND status = 'pending'
        GROUP BY agent_id
      ) leads_pending ON leads_pending.agent_id = u.id
      
      LEFT JOIN (
        SELECT agent_id, SUM(total_deal_value) as total_value
        FROM sales
        WHERE DATE(created_at) = $1
        GROUP BY agent_id
      ) sales_total ON sales_total.agent_id = u.id
      
      WHERE u.role = 'agent' AND u.is_active = true
      ORDER BY u.full_name ASC
    `, [targetDate]);

    // Process the data and calculate estimated earnings
    const processedStats = agentStats.map((agent: any) => {
      const baseSalary = Number(agent.base_salary) || 0;
      const salesTarget = Number(agent.sales_target) || 0;
      const callsCount = Number(agent.calls_count) || 0;
      const talkTimeSeconds = Number(agent.talk_time_seconds) || 0;
      const leadsApproved = Number(agent.leads_approved) || 0;
      const leadsCount = Number(agent.leads_count) || 0;
      const salesAmount = Number(agent.total_sales_value) || Number(agent.sales_amount) || 0;
      
      // Calculate daily potential (what they can earn if they hit 100%)
      const dailyPotential = workingDaysInMonth > 0 ? Math.round((baseSalary / workingDaysInMonth) * 100) / 100 : 0;
      
      // Calculate estimated daily earnings
      const estimatedEarnings = calculateEstimatedEarnings(
        baseSalary,
        workingDaysInMonth,
        callsCount,
        talkTimeSeconds,
        leadsApproved || leadsCount,
        agent.attendance_status,
        agent.hr_approved || false,
        agent.employment_type
      );
      
      // Check if sales target is hit (Golden Ticket)
      const targetHit = salesTarget > 0 && salesAmount >= salesTarget;
      
      return {
        id: Number(agent.id),
        fullName: agent.full_name,
        extensionNumber: agent.extension_number,
        shiftStart: agent.shift_start,
        shiftEnd: agent.shift_end,
        employmentType: agent.employment_type,
        baseSalary,
        dailyPotential,
        salesTarget,
        
        // Attendance
        checkInTime: agent.check_in_time,
        checkOutTime: agent.check_out_time,
        attendanceStatus: agent.attendance_status,
        hrApproved: agent.hr_approved || false,
        
        // Performance metrics
        callsCount,
        talkTimeSeconds,
        leadsApproved: Number(agent.leads_approved) || 0,
        leadsPending: Number(agent.leads_pending) || 0,
        salesAmount,
        
        // Calculated values
        estimatedEarnings,
        targetHit,
      };
    });

    return NextResponse.json({
      status: 'success',
      data: processedStats,
      date: targetDate,
      workingDaysInMonth,
    });
  } catch (error) {
    console.error('HR Daily Stats GET error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Failed to get daily stats' },
      { status: 500 }
    );
  }
}
