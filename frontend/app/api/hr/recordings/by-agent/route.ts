import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getRecordingSettings } from '@/lib/recording-settings';
import { getShiftDate } from '@/lib/shift-date';
import { loadShiftCalls } from '@/lib/agent-calls';
import { legacyAuth, withAuth } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * GET /api/hr/recordings/by-agent?date=YYYY-MM-DD[&min_seconds=60]
 *
 * Recordings by agent for one shift: every agent with their calls longer than
 * min_seconds and each call's 3CX recording. Active agents are always listed;
 * inactive agents only when they made calls that shift. Transcripts are left
 * out to keep the team view light (the per-agent page shows them).
 */
async function GET__handler(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ status: 'error', message: 'No token provided' }, { status: 401 });
  }
  try {
    const { payload } = await legacyAuth(request);
    if ((payload as any).role !== 'hr') {
      return NextResponse.json({ status: 'error', message: 'HR access required' }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ status: 'error', message: 'Invalid token' }, { status: 401 });
  }

  try {
    const sp = request.nextUrl.searchParams;
    const settings = await getRecordingSettings();
    const shiftStartHour = Number(settings.shiftStart.split(':')[0]) || 21;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.get('date') || '') ? sp.get('date')! : getShiftDate(new Date(), shiftStartHour);
    const minSeconds = Math.max(0, Number(sp.get('min_seconds') ?? 60));

    const agents = await query<{ id: string; full_name: string; username: string; extension_number: string; is_active: boolean }>(
      `SELECT id, full_name, username, extension_number, COALESCE(is_active, true) AS is_active
       FROM users WHERE role = 'agent' AND extension_number IS NOT NULL AND extension_number <> ''
       ORDER BY full_name`
    );
    const shift = await loadShiftCalls(
      agents.map((a) => ({ id: Number(a.id), extension_number: a.extension_number })),
      date, minSeconds, { transcripts: false }
    );

    const list = agents
      .map((a) => {
        const s = shift.byAgent.get(Number(a.id))!;
        return {
          id: Number(a.id), full_name: a.full_name, username: a.username, extension_number: a.extension_number,
          is_active: a.is_active, before_start: s.before_start, start_date: s.start_date, summary: s.summary, calls: s.calls,
        };
      })
      // Hide agents who hadn't started yet, and inactive agents with no calls that shift.
      .filter((a) => !a.before_start && (a.is_active || a.summary.total_calls > 0))
      .sort((x, y) => y.summary.long_calls - x.summary.long_calls || x.full_name.localeCompare(y.full_name));

    const totals = list.reduce(
      (t, a) => ({
        agents_with_calls: t.agents_with_calls + (a.summary.long_calls > 0 ? 1 : 0),
        total_calls: t.total_calls + a.summary.total_calls,
        long_calls: t.long_calls + a.summary.long_calls,
        with_recording: t.with_recording + a.summary.with_recording,
        long_talk_seconds: t.long_talk_seconds + a.summary.long_talk_seconds,
      }),
      { agents_with_calls: 0, total_calls: 0, long_calls: 0, with_recording: 0, long_talk_seconds: 0 }
    );

    return NextResponse.json({
      status: 'success',
      data: { date, min_seconds: minSeconds, shift_window: shift.window, recordings_error: shift.recordingsError, totals, agents: list },
    });
  } catch (error) {
    console.error('Recordings by agent error:', error);
    return NextResponse.json({ status: 'error', message: 'Failed to load recordings' }, { status: 500 });
  }
}

export const GET = withAuth(GET__handler);
