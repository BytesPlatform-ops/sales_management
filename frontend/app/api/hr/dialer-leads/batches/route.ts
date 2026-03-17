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
 * GET /api/hr/dialer-leads/batches
 * Get all uploaded batches with stats
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ status: 'error', message: 'No token provided' }, { status: 401 });
    }

    const token = authHeader.split(' ')[1];
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const jwt = payload as unknown as JwtPayload;

    if (jwt.role !== 'hr') {
      return NextResponse.json({ status: 'error', message: 'Access denied. HR only.' }, { status: 403 });
    }

    // Get batches with lead stats
    const batches = await query<any>(
      `SELECT
        b.id,
        b.file_name,
        b.total_leads,
        b.leads_per_agent,
        b.distributed,
        b.created_at,
        u.full_name as uploaded_by_name,
        COUNT(dl.id) as actual_leads,
        COUNT(dl.id) FILTER (WHERE dl.assigned_agent_id IS NOT NULL) as assigned_leads,
        COUNT(dl.id) FILTER (WHERE dl.call_outcome != 'pending') as called_leads
      FROM lead_upload_batches b
      LEFT JOIN users u ON b.uploaded_by = u.id
      LEFT JOIN dialer_leads dl ON dl.batch_id = b.id
      GROUP BY b.id, u.full_name
      ORDER BY b.created_at DESC`
    );

    // Get overall stats with pool breakdown
    const stats = await query<any>(
      `SELECT
        COUNT(*) as total_leads,
        COUNT(*) FILTER (WHERE pool = 'fresh') as fresh,
        COUNT(*) FILTER (WHERE pool = 'active') as active,
        COUNT(*) FILTER (WHERE pool = 'interested') as interested,
        COUNT(*) FILTER (WHERE pool = 'recycle') as recycle,
        COUNT(*) FILTER (WHERE pool = 'callback') as callback,
        COUNT(*) FILTER (WHERE pool = 'dead') as dead,
        COUNT(*) FILTER (WHERE call_outcome != 'pending') as called
      FROM dialer_leads`
    );

    return NextResponse.json({
      status: 'success',
      data: {
        batches,
        stats: stats[0] || {},
      },
    });
  } catch (error) {
    console.error('Batches GET error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Failed to fetch batches' },
      { status: 500 }
    );
  }
}
