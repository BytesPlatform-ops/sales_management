import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'
);

interface JwtPayload {
  userId: number;
  username: string;
  role: 'hr' | 'agent';
}

/**
 * GET /api/agent/qa-daily?date=YYYY-MM-DD
 *
 * Agent-facing daily QA. ALWAYS scoped to the logged-in user — the agent_id is taken
 * from the verified JWT, never from a query param, so an agent can only ever see their
 * own calls. Read-only: no flag/dispute, and the raw transcript is intentionally omitted.
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ status: 'error', message: 'No token provided' }, { status: 401 });
    }
    let payload: JwtPayload;
    try {
      const verified = await jwtVerify(authHeader.split(' ')[1], JWT_SECRET);
      payload = verified.payload as unknown as JwtPayload;
    } catch {
      return NextResponse.json({ status: 'error', message: 'Invalid token' }, { status: 401 });
    }

    const userId = payload.userId;
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date');
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ status: 'error', message: 'date (YYYY-MM-DD) is required' }, { status: 400 });
    }

    // daily roll-up for this agent (may be absent if the shift wasn't graded)
    const summaryRows = await query<{
      calls_total: number | null;
      calls_evaluated: number | null;
      meetings_scheduled: number | null;
      daily_score: number | string | null;
      metrics: Record<string, number> | null;
    }>(
      `SELECT calls_total, calls_evaluated, meetings_scheduled, daily_score, metrics
       FROM daily_scores
       WHERE agent_id = $1 AND shift_date = $2`,
      [userId, date]
    );

    // per-call evaluations — NO transcript (read-only transparency, not the raw recording text)
    const evaluations = await query(
      `SELECT
         e.id, t.customer_number, t.call_started_at, t.duration_sec, t.call_type,
         e.overall_score, e.meeting_scheduled, e.not_evaluable, e.not_evaluable_reason,
         e.scorecard, e.disposition, e.attribution_confidence
       FROM call_evaluations e
       JOIN call_transcripts t ON t.id = e.transcript_id
       WHERE e.agent_id = $1 AND e.shift_date = $2
       ORDER BY t.call_started_at ASC`,
      [userId, date]
    );

    return NextResponse.json({
      status: 'success',
      date,
      summary: summaryRows[0] || null,
      evaluations,
    });
  } catch (error: any) {
    console.error('[agent/qa-daily] error:', error);
    return NextResponse.json({ status: 'error', message: error.message || 'Internal error' }, { status: 500 });
  }
}
