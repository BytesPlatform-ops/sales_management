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
 * Resolve the shift/working date (9 PM pivot, matches dashboards).
 * If no date is provided and it's before 6 AM PKT, use yesterday's shift.
 */
function getWorkingDate(dateStr?: string): string {
  if (dateStr) return dateStr;

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
    hour12: false,
  });

  const currentDate = dateFormatter.format(now); // YYYY-MM-DD
  const hour = parseInt(hourFormatter.format(now), 10);

  if (hour < 6) {
    const [year, month, day] = currentDate.split('-').map(Number);
    const t = new Date(year, month - 1, day - 1);
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  }
  return currentDate;
}

interface RollupRow {
  agent_id: number;
  full_name: string;
  extension_number: string;
  calls_total: number | null;
  calls_evaluated: number | null;
  avg_engagement: number | null;
  avg_technical: number | null;
  avg_objection: number | null;
  meetings_scheduled: number | null;
  daily_score: number | null;
  summary: string | null;
}

interface EvaluationRow {
  id: number;
  threecx_rec_id: number;
  customer_number: string | null;
  call_started_at: string;
  duration_sec: number;
  call_type: string | null;
  talk_ratio: number | null;
  engagement: number | null;
  technical_knowledge: number | null;
  objection_handling: number | null;
  meeting_scheduled: boolean | null;
  overall_score: number | null;
  reasons: Record<string, string> | null;
  evidence: Array<{ dimension: string; quote: string; speaker: string; rationale: string }> | null;
  not_evaluable: boolean;
  not_evaluable_reason: string | null;
  transcript: string | null;
  flag_verdict: string | null;
  flag_dimension: string | null;
  flag_note: string | null;
}

/**
 * GET /api/hr/qa-daily
 *   ?date=YYYY-MM-DD            -> daily roll-up for all agents on that shift date
 *   ?date=YYYY-MM-DD&agentId=5  -> individual call evaluations for that agent (drill-down)
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ status: 'error', message: 'No token provided' }, { status: 401 });
    }

    let jwtPayload: JwtPayload;
    try {
      const { payload } = await jwtVerify(authHeader.split(' ')[1], JWT_SECRET);
      jwtPayload = payload as unknown as JwtPayload;
    } catch {
      return NextResponse.json({ status: 'error', message: 'Invalid token' }, { status: 401 });
    }

    if (jwtPayload.role !== 'hr') {
      return NextResponse.json({ status: 'error', message: 'Access denied. HR only.' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const date = getWorkingDate(searchParams.get('date') || undefined);
    const agentIdParam = searchParams.get('agentId');

    // ---- Drill-down: individual evaluations for one agent ----
    if (agentIdParam) {
      const agentId = Number(agentIdParam);
      if (!Number.isInteger(agentId)) {
        return NextResponse.json({ status: 'error', message: 'Invalid agentId' }, { status: 400 });
      }

      const evaluations = await query<EvaluationRow>(
        `SELECT
           e.id, t.threecx_rec_id, t.customer_number, t.call_started_at,
           t.duration_sec, t.call_type, t.talk_ratio,
           e.engagement, e.technical_knowledge, e.objection_handling,
           e.meeting_scheduled, e.overall_score, e.reasons, e.evidence,
           e.not_evaluable, e.not_evaluable_reason, t.transcript,
           f.verdict AS flag_verdict, f.dimension AS flag_dimension, f.note AS flag_note
         FROM call_evaluations e
         JOIN call_transcripts t ON t.id = e.transcript_id
         LEFT JOIN qa_calibration_flags f
           ON f.evaluation_id = e.id AND f.flagged_by = $3
         WHERE e.agent_id = $1 AND e.shift_date = $2
         ORDER BY t.call_started_at ASC`,
        [agentId, date, jwtPayload.userId]
      );

      const agent = await query<{ full_name: string; extension_number: string }>(
        `SELECT full_name, extension_number FROM users WHERE id = $1`,
        [agentId]
      );

      return NextResponse.json({
        status: 'success',
        date,
        agent: agent[0] || null,
        evaluations,
      });
    }

    // ---- Roll-up: all agents for the shift date ----
    const rollup = await query<RollupRow>(
      `SELECT
         ds.agent_id, u.full_name, u.extension_number,
         ds.calls_total, ds.calls_evaluated,
         ds.avg_engagement, ds.avg_technical, ds.avg_objection,
         ds.meetings_scheduled, ds.daily_score, ds.summary
       FROM daily_scores ds
       JOIN users u ON u.id = ds.agent_id
       WHERE ds.shift_date = $1
       ORDER BY ds.daily_score DESC NULLS LAST, u.full_name ASC`,
      [date]
    );

    return NextResponse.json({ status: 'success', date, rollup });
  } catch (err: any) {
    console.error('[qa-daily] error:', err);
    return NextResponse.json({ status: 'error', message: 'Internal error' }, { status: 500 });
  }
}
