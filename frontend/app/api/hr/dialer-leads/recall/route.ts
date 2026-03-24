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

/**
 * POST /api/hr/dialer-leads/recall
 * Recall excess pending leads from agents back to fresh pool.
 * Body: { agent_id?: number, keep_count: number }
 * - agent_id: specific agent (optional, if omitted applies to all agents)
 * - keep_count: how many pending leads to keep per agent, rest go back to fresh
 */
export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const { agent_id, keep_count } = body;

    if (keep_count === undefined || keep_count < 0) {
      return NextResponse.json({ status: 'error', message: 'keep_count is required and must be >= 0' }, { status: 400 });
    }

    // Get target agents
    let agents: { id: number; full_name: string }[];
    if (agent_id) {
      const agent = await queryOne<{ id: number; full_name: string }>(
        `SELECT id, full_name FROM users WHERE id = $1 AND role = 'agent'`,
        [agent_id]
      );
      if (!agent) {
        return NextResponse.json({ status: 'error', message: 'Agent not found' }, { status: 404 });
      }
      agents = [agent];
    } else {
      agents = await query<{ id: number; full_name: string }>(
        `SELECT id, full_name FROM users WHERE role = 'agent' AND is_active = true`
      );
    }

    const breakdown: { agent: string; recalled: number; kept: number }[] = [];
    let totalRecalled = 0;

    for (const agent of agents) {
      // Get all pending leads for this agent, ordered by id ASC (oldest first kept)
      const pendingLeads = await query<{ id: number }>(
        `SELECT id FROM dialer_leads
         WHERE assigned_agent_id = $1 AND call_outcome = 'pending'
         ORDER BY id ASC`,
        [agent.id]
      );

      if (pendingLeads.length <= keep_count) {
        breakdown.push({ agent: agent.full_name, recalled: 0, kept: pendingLeads.length });
        continue;
      }

      // IDs to recall (everything after keep_count)
      const idsToRecall = pendingLeads.slice(keep_count).map(l => l.id);

      // Return to fresh pool
      await query(
        `UPDATE dialer_leads
         SET assigned_agent_id = NULL, pool = 'fresh', assigned_date = NULL
         WHERE id = ANY($1)`,
        [idsToRecall]
      );

      const recalled = idsToRecall.length;
      totalRecalled += recalled;
      breakdown.push({ agent: agent.full_name, recalled, kept: keep_count });
    }

    return NextResponse.json({
      status: 'success',
      message: `Recalled ${totalRecalled} leads from ${breakdown.filter(b => b.recalled > 0).length} agent(s)`,
      data: { total_recalled: totalRecalled, breakdown },
    });
  } catch (error) {
    console.error('Recall leads error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Failed to recall leads' },
      { status: 500 }
    );
  }
}
