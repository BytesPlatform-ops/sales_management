import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { shiftCallTotalsSql } from '@/lib/call-stats';
import bcrypt from 'bcryptjs';
import { startOnboarding } from '@/lib/training/onboarding';
import { legacyAuth, withAuth } from '@/lib/auth/session';

interface Agent {
  id: number;
  username: string;
  full_name: string;
  extension_number: string;
  base_salary: number;
  sales_target: number;
  shift_start: string;
  shift_end: string;
  employment_type: string;
  is_active: boolean;
  created_at: string;
  date_of_joining: string | null;
}

/**
 * Get the current working date considering shift time (9 PM start)
 */
function getDefaultWorkingDate(): string {
  const now = new Date();

  const dateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const hourFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Karachi',
    hour: 'numeric',
    hourCycle: 'h23',
  });

  const dateStr = dateFormatter.format(now);
  const hour = parseInt(hourFormatter.format(now), 10) % 24;

  if (hour < 6) {
    const [year, month, day] = dateStr.split('-').map(Number);
    const tempDate = new Date(year, month - 1, day - 1);
    return `${tempDate.getFullYear()}-${String(tempDate.getMonth() + 1).padStart(2, '0')}-${String(tempDate.getDate()).padStart(2, '0')}`;
  }

  return dateStr;
}

async function GET__handler(request: NextRequest) {
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
    const { payload } = await legacyAuth(request);
    
    // Check if user is HR
    if (payload.role !== 'hr') {
      return NextResponse.json(
        { status: 'error', message: 'Access denied. HR only.' },
        { status: 403 }
      );
    }

    // Fetch all agents
    const agents = await query<Agent>(
      `SELECT id, username, full_name, extension_number, base_salary, 
              sales_target, shift_start, shift_end, employment_type, is_active, created_at,
              to_char(date_of_joining, 'YYYY-MM-DD') AS date_of_joining
       FROM users 
       WHERE role = 'agent'
       ORDER BY full_name ASC`
    );

    // Get current shift date
    const shiftDate = getDefaultWorkingDate();
    
    // Get today's attendance for each agent
    const attendanceRows = await query<{ user_id: number; status: string; check_in_time: string }>(
      `SELECT user_id, status, check_in_time 
       FROM attendance 
       WHERE date = $1`,
      [shiftDate]
    );

    // Today's talk time per agent: call talk time from call_logs (calls >= 30 s,
    // each agent's own shift — lib/call-stats.ts) plus HR-added meeting time.
    // Falls back to daily_stats when an agent has no call_logs that day.
    const talkTimeRows = await query<{ user_id: number; talk_time_seconds: number; meeting_seconds: number }>(
      `SELECT COALESCE(c.user_id, ds.user_id) AS user_id,
              CASE WHEN c.user_id IS NOT NULL
                   THEN c.talk_time_seconds + COALESCE(ds.meeting_seconds, 0)
                   ELSE ds.talk_time_seconds END AS talk_time_seconds,
              COALESCE(ds.meeting_seconds, 0) AS meeting_seconds
         FROM (SELECT * FROM daily_stats WHERE date = $1) ds
         FULL JOIN ${shiftCallTotalsSql('$1::date', '$1::date')} c ON c.user_id = ds.user_id`,
      [shiftDate]
    );

    const attendanceMap = new Map(
      attendanceRows.map(a => [Number(a.user_id), { status: a.status, checkInTime: a.check_in_time }])
    );

    const talkTimeMap = new Map(
      talkTimeRows.map(t => [Number(t.user_id), { 
        talkTimeSeconds: Number(t.talk_time_seconds) || 0,
        meetingSeconds: Number(t.meeting_seconds) || 0
      }])
    );

    // Combine agents with their attendance and talk time
    const agentsWithAttendance = agents.map(agent => {
      const talkTime = talkTimeMap.get(Number(agent.id));
      return {
        ...agent,
        id: Number(agent.id),
        base_salary: Number(agent.base_salary),
        sales_target: Number(agent.sales_target || 0),
        todayAttendance: attendanceMap.get(Number(agent.id)) || null,
        talk_time_today: talkTime?.talkTimeSeconds || 0,
        meeting_time_today: talkTime?.meetingSeconds || 0,
      };
    });

    return NextResponse.json({
      status: 'success',
      data: agentsWithAttendance,
    });
  } catch (error) {
    console.error('HR agents API error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Failed to fetch agents' },
      { status: 500 }
    );
  }
}

// POST - Create new agent
async function POST__handler(request: NextRequest) {
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
    const { payload } = await legacyAuth(request);
    
    // Check if user is HR
    if (payload.role !== 'hr') {
      return NextResponse.json(
        { status: 'error', message: 'Access denied. HR only.' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const {
      username,
      password,
      full_name,
      extension_number,
      base_salary,
      sales_target,
      shift_start,
      shift_end,
      employment_type,
      date_of_joining,
    } = body;

    // Validate required fields
    if (!username || !password || !full_name || !extension_number || !base_salary) {
      return NextResponse.json(
        { status: 'error', message: 'Missing required fields' },
        { status: 400 }
      );
    }

    if (date_of_joining && !/^\d{4}-\d{2}-\d{2}$/.test(date_of_joining)) {
      return NextResponse.json(
        { status: 'error', message: 'Invalid date of joining' },
        { status: 400 }
      );
    }

    // Check if username already exists
    const existingUser = await queryOne<{ id: number }>(
      'SELECT id FROM users WHERE username = $1',
      [username]
    );

    if (existingUser) {
      return NextResponse.json(
        { status: 'error', message: 'Username already exists' },
        { status: 400 }
      );
    }

    // Check if extension number already exists
    const existingExtension = await queryOne<{ id: number }>(
      'SELECT id FROM users WHERE extension_number = $1',
      [extension_number]
    );

    if (existingExtension) {
      return NextResponse.json(
        { status: 'error', message: 'Extension number already in use' },
        { status: 400 }
      );
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Insert new agent
    const result = await query<Agent>(
      `INSERT INTO users (
        username, password, full_name, extension_number, 
        base_salary, sales_target, shift_start, shift_end, employment_type, date_of_joining, role, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'agent', true)
      RETURNING id, username, full_name, extension_number, base_salary, 
                sales_target, shift_start, shift_end, employment_type, is_active, created_at,
                to_char(date_of_joining, 'YYYY-MM-DD') AS date_of_joining`,
      [
        username,
        passwordHash,
        full_name,
        extension_number,
        base_salary,
        sales_target || 0,
        shift_start || '09:00:00',
        shift_end || '18:00:00',
        employment_type || 'full_time',
        date_of_joining || null,
      ]
    );

    // Training module: new reps start in TRAINING with the onboarding path assigned.
    // Never block agent creation on it (module may not be installed yet).
    await startOnboarding(Number(result[0].id), Number(payload.userId)).catch((err) =>
      console.error('Training onboarding setup failed:', err)
    );

    return NextResponse.json({
      status: 'success',
      message: 'Agent created successfully',
      data: result[0],
    });
  } catch (error) {
    console.error('Create agent error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Failed to create agent' },
      { status: 500 }
    );
  }
}

export const GET = withAuth(GET__handler);
export const POST = withAuth(POST__handler);
