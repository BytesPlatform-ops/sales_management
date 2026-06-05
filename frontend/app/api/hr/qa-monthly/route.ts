import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { query } from '@/lib/db';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'
);

interface JwtPayload { userId: number; username: string; role: string; }

export const dynamic = 'force-dynamic';

/**
 * GET /api/hr/qa-monthly
 *   ?month=YYYY-MM-01  -> monthly reports for that month (defaults to latest)
 * Returns the month list (for the selector) + reports joined to users. HR only.
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

    const months = await query<{ month: string }>(
      `SELECT DISTINCT month::text AS month FROM monthly_reports ORDER BY month DESC`
    );
    if (months.length === 0) {
      return NextResponse.json({ status: 'success', month: null, months: [], reports: [] });
    }

    const requested = new URL(request.url).searchParams.get('month');
    const month = months.find((m) => m.month === requested)?.month || months[0].month;

    const reports = await query<any>(
      `SELECT
         r.id, r.agent_id, u.full_name, u.extension_number,
         r.month::text AS month, r.weeks_count, r.avg_score,
         r.score_trend, r.persistent_weaknesses, r.improvement_rate,
         r.trajectory, r.narrative
       FROM monthly_reports r
       JOIN users u ON u.id = r.agent_id
       WHERE r.month = $1
       ORDER BY
         CASE r.trajectory WHEN 'declining' THEN 0 WHEN 'flat' THEN 1 WHEN 'improving' THEN 2 ELSE 3 END,
         u.full_name ASC`,
      [month]
    );

    return NextResponse.json({ status: 'success', month, months, reports });
  } catch (err: any) {
    console.error('[qa-monthly] error:', err);
    return NextResponse.json({ status: 'error', message: 'Internal error' }, { status: 500 });
  }
}
