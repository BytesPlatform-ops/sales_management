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

export const dynamic = 'force-dynamic';

/**
 * POST /api/hr/qa-weekly/publish
 * Body: { reportId: number, action?: 'publish' | 'unpublish' }
 * Flips a weekly_report between draft/low_data and published. HR only.
 * Publishing is the human-in-the-loop gate before an agent can see the report.
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
    const reportId = Number(body.reportId);
    const action = body.action === 'unpublish' ? 'unpublish' : 'publish';
    if (!Number.isInteger(reportId)) {
      return NextResponse.json({ status: 'error', message: 'Invalid reportId' }, { status: 400 });
    }

    const existing = await queryOne<{ status: string }>(
      `SELECT status FROM weekly_reports WHERE id = $1`,
      [reportId]
    );
    if (!existing) {
      return NextResponse.json({ status: 'error', message: 'Report not found' }, { status: 404 });
    }

    const newStatus = action === 'publish' ? 'published' : 'draft';

    const updated = await queryOne<{ id: number; status: string }>(
      `UPDATE weekly_reports SET status = $1 WHERE id = $2 RETURNING id, status`,
      [newStatus, reportId]
    );

    return NextResponse.json({ status: 'success', report: updated });
  } catch (err: any) {
    console.error('[qa-weekly/publish] error:', err);
    return NextResponse.json({ status: 'error', message: 'Internal error' }, { status: 500 });
  }
}
