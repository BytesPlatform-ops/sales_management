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

async function verifyHRAccess(request: NextRequest): Promise<{ success: true; payload: JwtPayload } | { success: false; error: NextResponse }> {
  const authHeader = request.headers.get('authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      success: false,
      error: NextResponse.json({ status: 'error', message: 'No token provided' }, { status: 401 }),
    };
  }

  try {
    const token = authHeader.split(' ')[1];
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const jwtPayload = payload as unknown as JwtPayload;

    if (jwtPayload.role !== 'hr') {
      return {
        success: false,
        error: NextResponse.json({ status: 'error', message: 'Access denied. HR only.' }, { status: 403 }),
      };
    }

    return { success: true, payload: jwtPayload };
  } catch {
    return {
      success: false,
      error: NextResponse.json({ status: 'error', message: 'Invalid token' }, { status: 401 }),
    };
  }
}

interface TargetRow {
  employment_type: 'full_time' | 'part_time';
  calls_target: number;
  talk_time_seconds: number;
  leads_target: number;
  updated_at: string;
  updated_by: string | null;
}

/**
 * GET /api/hr/targets
 * Returns the daily performance targets for both employment types.
 */
export async function GET(request: NextRequest) {
  const authResult = await verifyHRAccess(request);
  if (!authResult.success) {
    return authResult.error;
  }

  try {
    const rows = await query<TargetRow>(
      `SELECT employment_type, calls_target, talk_time_seconds, leads_target, updated_at, updated_by
       FROM performance_targets
       ORDER BY employment_type`
    );

    return NextResponse.json({
      status: 'success',
      data: rows.map(r => ({
        employmentType: r.employment_type,
        calls: Number(r.calls_target),
        talkTimeSeconds: Number(r.talk_time_seconds),
        leads: Number(r.leads_target),
        updatedAt: r.updated_at,
        updatedBy: r.updated_by,
      })),
    });
  } catch (error) {
    console.error('HR Targets GET error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Failed to get targets' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/hr/targets
 * Update daily performance targets for one employment type.
 * Body: { employmentType: 'full_time' | 'part_time', calls: number, talkTimeSeconds: number, leads: number }
 */
export async function PUT(request: NextRequest) {
  const authResult = await verifyHRAccess(request);
  if (!authResult.success) {
    return authResult.error;
  }

  try {
    const body = await request.json();
    const { employmentType, calls, talkTimeSeconds, leads } = body;

    if (employmentType !== 'full_time' && employmentType !== 'part_time') {
      return NextResponse.json(
        { status: 'error', message: "employmentType must be 'full_time' or 'part_time'" },
        { status: 400 }
      );
    }

    const callsNum = Number(calls);
    const talkNum = Number(talkTimeSeconds);
    const leadsNum = Number(leads);

    if (!Number.isInteger(callsNum) || callsNum < 1 || callsNum > 10000) {
      return NextResponse.json(
        { status: 'error', message: 'calls must be a whole number between 1 and 10000' },
        { status: 400 }
      );
    }
    if (!Number.isInteger(talkNum) || talkNum < 60 || talkNum > 86400) {
      return NextResponse.json(
        { status: 'error', message: 'talkTimeSeconds must be a whole number between 60 (1 minute) and 86400 (24 hours)' },
        { status: 400 }
      );
    }
    if (!Number.isInteger(leadsNum) || leadsNum < 1 || leadsNum > 1000) {
      return NextResponse.json(
        { status: 'error', message: 'leads must be a whole number between 1 and 1000' },
        { status: 400 }
      );
    }

    await query(
      `INSERT INTO performance_targets (employment_type, calls_target, talk_time_seconds, leads_target, updated_at, updated_by)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $5)
       ON CONFLICT (employment_type) DO UPDATE SET
         calls_target = $2,
         talk_time_seconds = $3,
         leads_target = $4,
         updated_at = CURRENT_TIMESTAMP,
         updated_by = $5`,
      [employmentType, callsNum, talkNum, leadsNum, authResult.payload.username]
    );

    console.log(
      `[HR Targets] ${authResult.payload.username} updated ${employmentType} targets → calls: ${callsNum}, talk: ${talkNum}s, leads: ${leadsNum}`
    );

    return NextResponse.json({
      status: 'success',
      message: `Targets updated for ${employmentType === 'full_time' ? 'Full Time' : 'Part Time'} agents`,
    });
  } catch (error) {
    console.error('HR Targets PUT error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Failed to update targets' },
      { status: 500 }
    );
  }
}
