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

const VALID_STAGES = ['new_interested', 'follow_up', 'proposal_sent', 'closed_won', 'closed_lost'];

/**
 * GET /api/agent/pipeline
 * Get agent's interested leads with optional stage filter
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
    const agentId = Number(jwt.userId);

    const { searchParams } = new URL(request.url);
    const stage = searchParams.get('stage');

    // Get pipeline leads
    const leads = await query<any>(
      `SELECT id, firm_name, contact_person, phone_number, raw_data,
              pipeline_stage, follow_up_at, deal_value, pipeline_notes,
              call_notes, call_outcomes, last_called_at, updated_at, created_at
       FROM dialer_leads
       WHERE assigned_agent_id = $1
         AND pool = 'interested'
         ${stage ? 'AND pipeline_stage = $2' : ''}
       ORDER BY
         CASE WHEN follow_up_at IS NOT NULL AND follow_up_at < NOW() THEN 0 ELSE 1 END,
         follow_up_at ASC NULLS LAST,
         updated_at DESC`,
      stage ? [agentId, stage] : [agentId]
    );

    // Get stage counts + overdue counts
    const stageCounts = await query<any>(
      `SELECT
         pipeline_stage,
         COUNT(*) as count,
         COUNT(*) FILTER (WHERE follow_up_at IS NOT NULL AND follow_up_at < NOW()) as overdue,
         COALESCE(SUM(deal_value), 0) as total_value
       FROM dialer_leads
       WHERE assigned_agent_id = $1 AND pool = 'interested'
       GROUP BY pipeline_stage`,
      [agentId]
    );

    // Total summary
    const summary = await queryOne<any>(
      `SELECT
         COUNT(*) as total,
         COUNT(*) FILTER (WHERE follow_up_at IS NOT NULL AND follow_up_at < NOW()) as total_overdue,
         COALESCE(SUM(deal_value), 0) as total_value
       FROM dialer_leads
       WHERE assigned_agent_id = $1 AND pool = 'interested'`,
      [agentId]
    );

    return NextResponse.json({
      status: 'success',
      data: {
        leads: leads.map((l: any) => ({
          ...l,
          raw_data: typeof l.raw_data === 'string' ? JSON.parse(l.raw_data) : l.raw_data,
          call_outcomes: typeof l.call_outcomes === 'string' ? JSON.parse(l.call_outcomes) : l.call_outcomes,
        })),
        stageCounts,
        summary,
      },
    });
  } catch (error) {
    console.error('Agent pipeline GET error:', error);
    return NextResponse.json({ status: 'error', message: 'Failed to fetch pipeline' }, { status: 500 });
  }
}

/**
 * PUT /api/agent/pipeline
 * Update a pipeline lead (stage, follow-up, deal value, notes)
 */
export async function PUT(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ status: 'error', message: 'No token provided' }, { status: 401 });
    }

    const token = authHeader.split(' ')[1];
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const jwt = payload as unknown as JwtPayload;
    const agentId = Number(jwt.userId);

    const body = await request.json();
    const { lead_id, pipeline_stage, follow_up_at, deal_value, pipeline_notes } = body;

    if (!lead_id) {
      return NextResponse.json({ status: 'error', message: 'lead_id is required' }, { status: 400 });
    }

    if (pipeline_stage && !VALID_STAGES.includes(pipeline_stage)) {
      return NextResponse.json({ status: 'error', message: `Invalid stage: ${pipeline_stage}` }, { status: 400 });
    }

    // Verify lead belongs to agent and is in interested pool
    const lead = await queryOne<any>(
      `SELECT id, assigned_agent_id, pool FROM dialer_leads WHERE id = $1`,
      [lead_id]
    );

    if (!lead) {
      return NextResponse.json({ status: 'error', message: 'Lead not found' }, { status: 404 });
    }

    if (Number(lead.assigned_agent_id) !== agentId) {
      return NextResponse.json({ status: 'error', message: 'Lead not assigned to you' }, { status: 403 });
    }

    if (lead.pool !== 'interested') {
      return NextResponse.json({ status: 'error', message: 'Lead is not in interested pool' }, { status: 400 });
    }

    const updated = await queryOne<any>(
      `UPDATE dialer_leads
       SET pipeline_stage = COALESCE($1::varchar, pipeline_stage),
           follow_up_at = CASE WHEN $2::text IS NOT NULL THEN $2::timestamptz ELSE follow_up_at END,
           deal_value = CASE WHEN $3::text IS NOT NULL THEN $3::decimal ELSE deal_value END,
           pipeline_notes = CASE WHEN $4::text IS NOT NULL THEN $4::text ELSE pipeline_notes END,
           updated_at = NOW()
       WHERE id = $5
       RETURNING id, pipeline_stage, follow_up_at, deal_value, pipeline_notes`,
      [
        pipeline_stage || null,
        follow_up_at !== undefined ? follow_up_at : null,
        deal_value !== undefined ? String(deal_value) : null,
        pipeline_notes !== undefined ? pipeline_notes : null,
        lead_id,
      ]
    );

    return NextResponse.json({
      status: 'success',
      message: 'Pipeline lead updated',
      data: updated,
    });
  } catch (error) {
    console.error('Agent pipeline PUT error:', error);
    return NextResponse.json({ status: 'error', message: 'Failed to update pipeline lead' }, { status: 500 });
  }
}
