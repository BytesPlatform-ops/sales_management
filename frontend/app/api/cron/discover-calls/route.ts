import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { listRecordings, type ThreeCXRecording } from '@/lib/3cx-client';
import { getShiftDate } from '@/lib/shift-date';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * POST /api/cron/discover-calls
 * Vercel Cron: "0 0 * * *" (05:00 PKT — shortly after the 9PM–5AM shift ends).
 * Requires: Authorization: Bearer <CRON_SECRET>.
 *
 * Fetches the just-completed shift's recordings from 3CX, filters to external
 * sales calls by active agents, and inserts one 'discovered' row per recording
 * into call_transcripts. The Python worker then drains the queue.
 *
 * Idempotent: ON CONFLICT (threecx_rec_id) DO NOTHING, so re-runs are safe.
 */

const CRON_SECRET = process.env.CRON_SECRET || '';
const VALID_CALL_TYPES = new Set(['OutboundExternal', 'InboundExternal']);

async function getClientSecret(): Promise<string> {
  const rows = await query<{ value: string }>(
    `SELECT value FROM system_settings WHERE key = 'recording_access_token' LIMIT 1`
  );
  return rows[0]?.value || '';
}

const durationSec = (rec: ThreeCXRecording): number =>
  Math.max(0, Math.round((new Date(rec.EndTime).getTime() - new Date(rec.StartTime).getTime()) / 1000));

const addDays = (ymd: string, n: number): string => {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + n);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
};

// Vercel Cron triggers via GET; external schedulers may POST. Support both.
export async function GET(request: NextRequest) {
  return POST(request);
}

export async function POST(request: NextRequest) {
  // --- auth ---
  const provided = request.headers.get('authorization')?.replace('Bearer ', '');
  if (!provided || provided !== CRON_SECRET) {
    return NextResponse.json({ status: 'error', message: 'Invalid secret' }, { status: 403 });
  }

  try {
    // The just-completed shift = the shift date of "now" (05:00 PKT < 21:00 pivot -> yesterday).
    const targetShiftDate = getShiftDate(new Date());

    // Active agents -> extension set + extension->id map for resolution.
    const agents = await query<{ id: number; extension_number: string }>(
      `SELECT id, extension_number FROM users
       WHERE role = 'agent' AND is_active = true AND extension_number IS NOT NULL`
    );
    const extToId = new Map<string, number>();
    for (const a of agents) extToId.set(String(a.extension_number), a.id);
    if (extToId.size === 0) {
      return NextResponse.json({ status: 'success', shiftDate: targetShiftDate, message: 'No active agents', inserted: 0 });
    }

    const clientSecret = await getClientSecret();
    if (!clientSecret) {
      return NextResponse.json({ status: 'error', message: 'No 3CX API key configured' }, { status: 500 });
    }

    // Fetch a window covering the shift. listRecordings filters by calendar day in UTC;
    // the shift spans yesterday-evening UTC into early-today UTC, so query [shiftDate, shiftDate+1].
    // We then narrow precisely via getShiftDate() below.
    const windowEnd = addDays(targetShiftDate, 1);
    const { recordings, error } = await listRecordings(clientSecret, targetShiftDate, windowEnd);
    if (error) {
      return NextResponse.json({ status: 'error', message: `3CX fetch failed: ${error}` }, { status: 502 });
    }

    // Filter: external sales calls, by an active agent, belonging to THIS shift.
    const matched = recordings.filter((rec) => {
      if (!VALID_CALL_TYPES.has(rec.CallType)) return false;
      if (!extToId.has(String(rec.FromDn))) return false;
      return getShiftDate(rec.StartTime) === targetShiftDate;
    });

    // Insert one 'discovered' row per recording (idempotent).
    let inserted = 0;
    for (const rec of matched) {
      const result = await query<{ id: number }>(
        `INSERT INTO call_transcripts
           (threecx_rec_id, agent_id, extension, shift_date,
            call_started_at, call_ended_at, duration_sec,
            customer_number, call_type, recording_url, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'discovered')
         ON CONFLICT (threecx_rec_id) DO NOTHING
         RETURNING id`,
        [
          rec.Id,
          extToId.get(String(rec.FromDn)),
          String(rec.FromDn),
          targetShiftDate,
          rec.StartTime,
          rec.EndTime,
          durationSec(rec),
          rec.ToCallerNumber || null,
          rec.CallType,
          rec.RecordingUrl || null,
        ]
      );
      if (result.length > 0) inserted++;
    }

    return NextResponse.json({
      status: 'success',
      shiftDate: targetShiftDate,
      fetched: recordings.length,
      matched: matched.length,
      inserted,                       // new rows (excludes already-discovered dupes)
      skippedDuplicates: matched.length - inserted,
    });
  } catch (err: any) {
    console.error('[discover-calls] error:', err);
    return NextResponse.json({ status: 'error', message: err.message || 'Internal error' }, { status: 500 });
  }
}
