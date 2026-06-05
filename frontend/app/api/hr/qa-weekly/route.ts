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

export const dynamic = 'force-dynamic';

/**
 * GET /api/hr/qa-weekly
 *   ?week=YYYY-MM-DD   -> reports for that week_start (defaults to the latest week)
 * Returns the distinct week list (for the selector) + the week's reports joined to users.
 * HR only.
 */
export async function GET(request: NextRequest) {
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

    // Distinct weeks (newest first) for the selector. ::text to avoid DATE→UTC drift.
    const weeks = await query<{ week_start: string; week_end: string }>(
      `SELECT DISTINCT week_start::text AS week_start, week_end::text AS week_end
       FROM weekly_reports
       ORDER BY week_start DESC`
    );

    if (weeks.length === 0) {
      return NextResponse.json({ status: 'success', week_start: null, week_end: null, weeks: [], reports: [] });
    }

    // Default to the latest week if none specified.
    const requested = new URL(request.url).searchParams.get('week');
    const week = weeks.find((w) => w.week_start === requested) || weeks[0];

    const reports = await query<any>(
      `SELECT
         r.id, u.full_name, u.extension_number, r.agent_id,
         r.week_start::text AS week_start, r.week_end::text AS week_end,
         r.avg_score, r.calls_count, r.meetings_count,
         r.strengths, r.weaknesses, r.custom_scripts, r.improvement,
         r.improvement_rate, r.narrative, r.status
       FROM weekly_reports r
       JOIN users u ON u.id = r.agent_id
       WHERE r.week_start = $1
       ORDER BY r.status ASC, r.avg_score DESC NULLS LAST, u.full_name ASC`,
      [week.week_start]
    );

    return NextResponse.json({
      status: 'success',
      week_start: week.week_start,
      week_end: week.week_end,
      weeks,
      reports,
    });
  } catch (err: any) {
    console.error('[qa-weekly] error:', err);
    return NextResponse.json({ status: 'error', message: 'Internal error' }, { status: 500 });
  }
}
