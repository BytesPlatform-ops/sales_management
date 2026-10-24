import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { query, queryOne } from '@/lib/db';
import { listRecordings } from '@/lib/3cx-client';
import { assignForCalls, getClientSecret } from '@/lib/recording-lookup';
import { getRecordingSettings, shiftWindowPKT } from '@/lib/recording-settings';
import { recordingPlayUrl } from '@/lib/recording-links';
import { getShiftDate } from '@/lib/shift-date';
import { getAgentStartDates } from '@/lib/agent-start';

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

// call_duration is "MM:SS" or "HH:MM:SS"
const DURATION_SEC = `(CASE
  WHEN c.call_duration LIKE '%:%:%' THEN SPLIT_PART(c.call_duration, ':', 1)::int * 3600 + SPLIT_PART(c.call_duration, ':', 2)::int * 60 + SPLIT_PART(c.call_duration, ':', 3)::int
  WHEN c.call_duration LIKE '%:%' THEN SPLIT_PART(c.call_duration, ':', 1)::int * 60 + SPLIT_PART(c.call_duration, ':', 2)::int
  ELSE 0 END)`;

interface CallRow {
  id: number;
  call_time: string;
  phone_number: string | null;
  agent_extension: string;
  call_duration: string;
  duration_sec: number;
  rec_id: string | null;
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
    const window = shiftWindowPKT(date, settings);

    // A reused extension carries the previous agent's calls — only count from this agent's start.
    const startDate = (await getAgentStartDates([agentId])).get(agentId) || null;

    // Shift dates with long calls in the last 30 days (for the picker).
    const days = await query<{ shift_date: string; calls: number }>(
      `SELECT ((c.call_time AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Karachi' - make_interval(hours => $2))::date::text AS shift_date,
              COUNT(*)::int AS calls
       FROM call_logs c
       WHERE c.agent_extension = $1
         AND c.call_time >= (NOW() AT TIME ZONE 'UTC') - INTERVAL '31 days'
         AND ${DURATION_SEC} > $3
       GROUP BY 1 ORDER BY 1 DESC`,
      [agent.extension_number, shiftStartHour, minSeconds]
    );

    const beforeStart = !!startDate && date < startDate;
    const allCalls = beforeStart ? [] : await query<CallRow>(
      `SELECT c.id, c.call_time, c.phone_number, c.agent_extension, c.call_duration, ${DURATION_SEC} AS duration_sec, c.rec_id
       FROM call_logs c
       WHERE c.agent_extension = $1
         -- call_time is UTC without a zone: convert the PKT window to UTC explicitly
         -- so the comparison doesn't depend on the session time zone.
         AND c.call_time >= ($2::timestamp AT TIME ZONE 'Asia/Karachi') AT TIME ZONE 'UTC'
         AND c.call_time < ($3::timestamp AT TIME ZONE 'Asia/Karachi') AT TIME ZONE 'UTC'
       ORDER BY c.call_time ASC`,
      [agent.extension_number, window.start, window.end]
    );
    const calls = allCalls.filter((c) => Number(c.duration_sec) > minSeconds);

    // Match recordings for calls that don't have one cached yet (same matcher as auditing).
    let recordingsError: string | null = null;
    const needing = calls.filter((c) => !c.rec_id);
    if (needing.length) {
      const clientSecret = await getClientSecret();
      if (!clientSecret) {
        recordingsError = '3CX is not configured — add the recording access token in settings.';
      } else {
        const times = needing.map((c) => new Date(c.call_time).getTime());
        const from = new Date(Math.min(...times) - 6 * 3600 * 1000).toISOString().slice(0, 10);
        const to = new Date(Math.max(...times) + 6 * 3600 * 1000).toISOString().slice(0, 10);
        const { recordings, error } = await listRecordings(clientSecret, from, to);
        if (error) {
          recordingsError = `Could not reach 3CX: ${error}`;
        } else {
          const assigned = await assignForCalls(needing, recordings, {
            minSeconds: settings.recordingMinSeconds,
            windowMs: settings.matchWindowMinutes * 60 * 1000,
          });
          for (const c of needing) {
            const m = assigned.get(String(c.id));
            if (m) {
              c.rec_id = String(m.recording.Id);
              await query(`UPDATE call_logs SET rec_id = $1 WHERE id = $2`, [c.rec_id, c.id]);
            }
          }
        }
      }
    }

    // QA pipeline data (transcript + evaluation) keyed by 3CX recording id.
    const recIds = calls.map((c) => c.rec_id).filter((r): r is string => !!r && /^\d+$/.test(r));
    const qa = recIds.length
      ? await query<any>(
          `SELECT t.threecx_rec_id::text AS rec_id, t.id AS transcript_id, t.status::text AS status, t.transcript,
                  e.overall_score, e.meeting_scheduled, e.disposition, e.not_evaluable, e.not_evaluable_reason
           FROM call_transcripts t
           LEFT JOIN call_evaluations e ON e.transcript_id = t.id
           WHERE t.threecx_rec_id = ANY($1::bigint[])`,
          [recIds]
        )
      : [];
    const qaByRec = new Map(qa.map((q) => [q.rec_id, q]));

    const items = await Promise.all(calls.map(async (c) => {
      const playUrl = c.rec_id ? await recordingPlayUrl(c.rec_id) : null;
      const q = c.rec_id ? qaByRec.get(c.rec_id) : null;
      return {
        id: c.id,
        call_time: c.call_time,
        phone_number: c.phone_number,
        duration_sec: Number(c.duration_sec),
        call_duration: c.call_duration,
        rec_id: c.rec_id,
        play_url: playUrl,
        download_url: playUrl ? `${playUrl}&download=1` : null,
        qa: q ? {
          transcript_id: Number(q.transcript_id),
          status: q.status,
          transcript: q.transcript ? String(q.transcript).slice(0, 20000) : null,
          overall_score: q.overall_score === null ? null : Number(q.overall_score),
          meeting_scheduled: q.meeting_scheduled,
          disposition: q.disposition,
          not_evaluable: q.not_evaluable,
          not_evaluable_reason: q.not_evaluable_reason,
        } : null,
      };
    }));

    const talk = calls.reduce((s, c) => s + Number(c.duration_sec), 0);
    return NextResponse.json({
      status: 'success',
      data: {
        agent: { id: agent.id, full_name: agent.full_name, username: agent.username, extension_number: agent.extension_number, is_active: agent.is_active },
        date,
        start_date: startDate,
        before_start: beforeStart,
        min_seconds: minSeconds,
        shift_window: { start: window.start.slice(0, 16), end: window.end.slice(0, 16) }, // PKT wall clock
        summary: {
          total_calls: allCalls.length,
          long_calls: calls.length,
          long_talk_seconds: talk,
          with_recording: items.filter((i) => i.rec_id).length,
          meetings: items.filter((i) => i.qa?.meeting_scheduled).length,
        },
        recordings_error: recordingsError,
        calls: items,
        days: days.filter((d) => !startDate || d.shift_date >= startDate),
      },
    });
  } catch (error) {
    console.error('Agent calls error:', error);
    return NextResponse.json({ status: 'error', message: 'Failed to load calls' }, { status: 500 });
  }
}
