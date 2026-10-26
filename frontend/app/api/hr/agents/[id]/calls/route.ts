import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { query, queryOne } from '@/lib/db';
import { getRecordingSettings } from '@/lib/recording-settings';
import { getShiftDate } from '@/lib/shift-date';
import { DURATION_SEC_SQL, loadShiftCalls } from '@/lib/agent-calls';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'
);

interface JwtPayload {
  userId: number;
  username: string;
  role: string;
}

/**
 * GET /api/hr/agents/{id}/calls?date=YYYY-MM-DD[&min_seconds=60]
 *
 * One agent's calls for a shift (shift date = PKT date the shift starts; window
 * and grace from the recording settings, same as Call Auditing), longer than
 * min_seconds (default 60), each with its 3CX recording and — when the QA
 * pipeline has processed it — transcript and QA score. Also returns the last
 * 30 shift dates with call counts for the date picker.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ status: 'error', message: 'No token provided' }, { status: 401 });
  }
  let jwt: JwtPayload;
  try {
    const { payload } = await jwtVerify(authHeader.split(' ')[1], JWT_SECRET);
    jwt = payload as unknown as JwtPayload;
  } catch {
    return NextResponse.json({ status: 'error', message: 'Invalid token' }, { status: 401 });
  }
  if (jwt.role !== 'hr') {
    return NextResponse.json({ status: 'error', message: 'HR access required' }, { status: 403 });
  }

  try {
    const agentId = Number(params.id);
    const agent = await queryOne<{ id: number; full_name: string; username: string; extension_number: string; is_active: boolean }>(
      `SELECT id, full_name, username, extension_number, COALESCE(is_active, true) AS is_active FROM users WHERE id = $1 AND role = 'agent'`,
      [agentId]
    );
    if (!agent) {
      return NextResponse.json({ status: 'error', message: 'Agent not found' }, { status: 404 });
    }

    const sp = request.nextUrl.searchParams;
    const settings = await getRecordingSettings();
    const shiftStartHour = Number(settings.shiftStart.split(':')[0]) || 21;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.get('date') || '') ? sp.get('date')! : getShiftDate(new Date(), shiftStartHour);
    const minSeconds = Math.max(0, Number(sp.get('min_seconds') ?? 60));

    const shift = await loadShiftCalls([{ id: Number(agent.id), extension_number: agent.extension_number }], date, minSeconds);
    const mine = shift.byAgent.get(Number(agent.id))!;

    // Shift dates with long calls in the last 30 days (for the picker).
    const days = await query<{ shift_date: string; calls: number }>(
      `SELECT ((c.call_time AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Karachi' - make_interval(hours => $2))::date::text AS shift_date,
              COUNT(*)::int AS calls
       FROM call_logs c
       WHERE c.agent_extension = $1
         AND c.call_time >= (NOW() AT TIME ZONE 'UTC') - INTERVAL '31 days'
         AND ${DURATION_SEC_SQL} > $3
       GROUP BY 1 ORDER BY 1 DESC`,
      [agent.extension_number, shiftStartHour, minSeconds]
    );

    return NextResponse.json({
      status: 'success',
      data: {
        agent: { id: agent.id, full_name: agent.full_name, username: agent.username, extension_number: agent.extension_number, is_active: agent.is_active },
        date,
        start_date: mine.start_date,
        before_start: mine.before_start,
        min_seconds: minSeconds,
        shift_window: shift.window,
        summary: mine.summary,
        recordings_error: shift.recordingsError,
        calls: mine.calls,
        days: days.filter((d) => !mine.start_date || d.shift_date >= mine.start_date),
      },
    });
  } catch (error) {
    console.error('Agent calls error:', error);
    return NextResponse.json({ status: 'error', message: 'Failed to load calls' }, { status: 500 });
  }
}
