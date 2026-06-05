import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { query, queryOne } from '@/lib/db';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'
);

interface JwtPayload {
  userId: number;
  username: string;
  role: string;
}

const VALID_VERDICTS = ['too_high', 'too_low', 'incorrect'];
const VALID_DIMENSIONS = [
  'engagement', 'technical_knowledge', 'objection_handling', 'meeting_scheduled', 'overall',
];

/**
 * POST /api/hr/qa-daily/flag
 * Body: { evaluationId: number, verdict: 'too_high'|'too_low'|'incorrect',
 *         dimension?: string, note?: string }
 * Upserts one flag per (evaluation, HR user). This is calibration feedback used
 * to tune the rubric before the AI is allowed to coach agents.
 */
export async function POST(request: NextRequest) {
  try {
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
      return NextResponse.json({ status: 'error', message: 'Access denied. HR only.' }, { status: 403 });
    }

    const body = await request.json();
    const evaluationId = Number(body.evaluationId);
    const verdict = String(body.verdict || '');
    const dimension = body.dimension ? String(body.dimension) : 'overall';
    const note = body.note ? String(body.note).slice(0, 1000) : null;

    if (!Number.isInteger(evaluationId)) {
      return NextResponse.json({ status: 'error', message: 'Invalid evaluationId' }, { status: 400 });
    }
    if (!VALID_VERDICTS.includes(verdict)) {
      return NextResponse.json({ status: 'error', message: 'Invalid verdict' }, { status: 400 });
    }
    if (!VALID_DIMENSIONS.includes(dimension)) {
      return NextResponse.json({ status: 'error', message: 'Invalid dimension' }, { status: 400 });
    }

    // Pull agent_id + shift_date from the evaluation so flags are reportable on their own.
    const evalRow = await queryOne<{ agent_id: number; shift_date: string }>(
      `SELECT agent_id, shift_date FROM call_evaluations WHERE id = $1`,
      [evaluationId]
    );
    if (!evalRow) {
      return NextResponse.json({ status: 'error', message: 'Evaluation not found' }, { status: 404 });
    }

    await query(
      `INSERT INTO qa_calibration_flags
         (evaluation_id, agent_id, shift_date, flagged_by, dimension, verdict, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (evaluation_id, flagged_by) DO UPDATE SET
         dimension = EXCLUDED.dimension,
         verdict   = EXCLUDED.verdict,
         note      = EXCLUDED.note,
         updated_at = now()`,
      [evaluationId, evalRow.agent_id, evalRow.shift_date, jwt.userId, dimension, verdict, note]
    );

    return NextResponse.json({ status: 'success' });
  } catch (err: any) {
    console.error('[qa-daily/flag] error:', err);
    return NextResponse.json({ status: 'error', message: 'Internal error' }, { status: 500 });
  }
}

/**
 * DELETE /api/hr/qa-daily/flag?evaluationId=123  — remove this HR user's flag.
 */
export async function DELETE(request: NextRequest) {
  try {
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
      return NextResponse.json({ status: 'error', message: 'Access denied. HR only.' }, { status: 403 });
    }

    const evaluationId = Number(new URL(request.url).searchParams.get('evaluationId'));
    if (!Number.isInteger(evaluationId)) {
      return NextResponse.json({ status: 'error', message: 'Invalid evaluationId' }, { status: 400 });
    }

    await query(
      `DELETE FROM qa_calibration_flags WHERE evaluation_id = $1 AND flagged_by = $2`,
      [evaluationId, jwt.userId]
    );
    return NextResponse.json({ status: 'success' });
  } catch (err: any) {
    console.error('[qa-daily/flag DELETE] error:', err);
    return NextResponse.json({ status: 'error', message: 'Internal error' }, { status: 500 });
  }
}
