import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { legacyAuth, withAuth } from '@/lib/auth/session';

interface JwtPayload {
  userId: number;
  username: string;
  role: string;
}

export const dynamic = 'force-dynamic';

/**
 * GET /api/agent/coaching/weekly
 * Returns ONLY the logged-in agent's PUBLISHED weekly reports, newest first.
 * Drafts / low_data are never exposed to agents — HR sees those in the QA dashboard.
 */
async function GET__handler(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ status: 'error', message: 'No token' }, { status: 401 });
    }

    let jwt: JwtPayload;
    try {
      const { payload } = await legacyAuth(request);
      jwt = payload as unknown as JwtPayload;
    } catch {
      return NextResponse.json({ status: 'error', message: 'Invalid token' }, { status: 401 });
    }

    // Scoped to jwt.userId AND status='published' — an agent can only ever see their own,
    // and only reports HR has approved.
    const reports = await query<any>(
      `SELECT
         id, week_start::text AS week_start, week_end::text AS week_end,
         avg_score, calls_count, meetings_count,
         strengths, weaknesses, custom_scripts, improvement, improvement_rate, narrative
       FROM weekly_reports
       WHERE agent_id = $1 AND status = 'published'
       ORDER BY week_start DESC`,
      [Number(jwt.userId)]
    );

    return NextResponse.json({ status: 'success', reports });
  } catch (err: any) {
    console.error('[agent/coaching/weekly] error:', err);
    return NextResponse.json({ status: 'error', message: 'Internal error' }, { status: 500 });
  }
}

export const GET = withAuth(GET__handler);
