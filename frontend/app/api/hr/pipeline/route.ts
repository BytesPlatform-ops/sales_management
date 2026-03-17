import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { query, queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'
);

interface JwtPayload {
  userId: number;
  username: string;
  role: string;
}

/**
 * GET /api/hr/pipeline
 * HR sees all interested leads across all agents
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

    const { searchParams } = new URL(request.url);
    const stage = searchParams.get('stage');
    const agentId = searchParams.get('agent_id');

    // Build dynamic WHERE clauses
    const conditions: string[] = ["dl.pool = 'interested'"];
    const params: any[] = [];
    let paramIndex = 1;

    if (stage) {
      conditions.push(`dl.pipeline_stage = $${paramIndex}`);
      params.push(stage);
      paramIndex++;
    }

    if (agentId) {
      conditions.push(`dl.assigned_agent_id = $${paramIndex}`);
      params.push(Number(agentId));
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    // Get all pipeline leads with agent names
    const leads = await query<any>(
      `SELECT dl.id, dl.firm_name, dl.contact_person, dl.phone_number,
              dl.pipeline_stage, dl.follow_up_at, dl.deal_value, dl.pipeline_notes,
              dl.call_notes, dl.call_outcomes, dl.last_called_at, dl.updated_at,
              u.full_name as agent_name, u.id as agent_id
       FROM dialer_leads dl
       LEFT JOIN users u ON dl.assigned_agent_id = u.id
       WHERE ${whereClause}
       ORDER BY
         CASE WHEN dl.follow_up_at IS NOT NULL AND dl.follow_up_at < NOW() THEN 0 ELSE 1 END,
         dl.follow_up_at ASC NULLS LAST,
         dl.updated_at DESC`,
      params
    );

    // Stage counts (global, not filtered)
    const stageCounts = await query<any>(
      `SELECT
         pipeline_stage,
         COUNT(*) as count,
         COUNT(*) FILTER (WHERE follow_up_at IS NOT NULL AND follow_up_at < NOW()) as overdue,
         COALESCE(SUM(deal_value), 0) as total_value
       FROM dialer_leads
       WHERE pool = 'interested'
       GROUP BY pipeline_stage`
    );

    // Total summary
    const summary = await queryOne<any>(
      `SELECT
         COUNT(*) as total,
         COUNT(*) FILTER (WHERE follow_up_at IS NOT NULL AND follow_up_at < NOW()) as total_overdue,
         COALESCE(SUM(deal_value), 0) as total_value,
         COUNT(DISTINCT assigned_agent_id) as agents_with_leads
       FROM dialer_leads
       WHERE pool = 'interested'`
    );

    // Agent breakdown
    const agentBreakdown = await query<any>(
      `SELECT
         u.id, u.full_name,
         COUNT(*) as lead_count,
         COALESCE(SUM(dl.deal_value), 0) as total_value
       FROM dialer_leads dl
       JOIN users u ON dl.assigned_agent_id = u.id
       WHERE dl.pool = 'interested'
       GROUP BY u.id, u.full_name
       ORDER BY lead_count DESC`
    );

    return NextResponse.json({
      status: 'success',
      data: {
        leads: leads.map((l: any) => ({
          ...l,
          call_outcomes: typeof l.call_outcomes === 'string' ? JSON.parse(l.call_outcomes) : l.call_outcomes,
        })),
        stageCounts,
        summary,
        agentBreakdown,
      },
    });
  } catch (error) {
    console.error('HR pipeline GET error:', error);
    return NextResponse.json({ status: 'error', message: 'Failed to fetch pipeline' }, { status: 500 });
  }
}
