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
 * GET /api/agent/dialer-leads/next
 * Get the next pending dialer lead for the logged-in agent (today's assigned leads).
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

    // Get next pending lead for this agent (all assigned, not date-filtered)
    const nextLead = await queryOne<any>(
      `SELECT id, firm_name, contact_person, phone_number, raw_data,
              what_to_offer, talking_points, ai_generated,
              call_outcome, call_notes, call_count, last_called_at
       FROM dialer_leads
       WHERE assigned_agent_id = $1
         AND call_outcome = 'pending'
       ORDER BY assigned_date DESC NULLS LAST, id ASC
       LIMIT 1`,
      [jwt.userId]
    );

    // Stats: leads currently assigned + leads this agent already called (now recycled/dead/etc)
    const agentId = Number(jwt.userId);
    const agentJsonb = JSON.stringify([agentId]); // e.g. '[11]' for @> containment check
    const stats = await queryOne<any>(
      `SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE call_outcome != 'pending') as called,
        COUNT(*) FILTER (WHERE call_outcome = 'interested') as interested,
        COUNT(*) FILTER (WHERE call_outcome = 'not_interested') as not_interested,
        COUNT(*) FILTER (WHERE call_outcome = 'voicemail') as voicemail,
        COUNT(*) FILTER (WHERE call_outcome = 'gatekeeper') as gatekeeper,
        COUNT(*) FILTER (WHERE call_outcome = 'owner_picked') as owner_picked,
        COUNT(*) FILTER (WHERE call_outcome = 'callback') as callback,
        COUNT(*) FILTER (WHERE call_outcome = 'busy') as busy,
        COUNT(*) FILTER (WHERE call_outcome = 'bad_number') as bad_number,
        COUNT(*) FILTER (WHERE call_outcome = 'dnc') as dnc
       FROM dialer_leads
       WHERE assigned_agent_id = $1
          OR (previous_agents IS NOT NULL AND previous_agents::jsonb @> $2::jsonb)`,
      [agentId, agentJsonb]
    );

    if (!nextLead) {
      return NextResponse.json({
        status: 'success',
        data: null,
        hasMore: false,
        stats,
        message: 'No more leads',
      });
    }

    // Get upcoming leads count
    const upcoming = await query<{ id: number; firm_name: string; phone_number: string }>(
      `SELECT id, firm_name, phone_number
       FROM dialer_leads
       WHERE assigned_agent_id = $1
         AND call_outcome = 'pending'
         AND id > $2
       ORDER BY id ASC
       LIMIT 5`,
      [jwt.userId, nextLead.id]
    );

    return NextResponse.json({
      status: 'success',
      data: {
        ...nextLead,
        raw_data: typeof nextLead.raw_data === 'string' ? JSON.parse(nextLead.raw_data) : nextLead.raw_data,
        what_to_offer: typeof nextLead.what_to_offer === 'string' ? JSON.parse(nextLead.what_to_offer) : nextLead.what_to_offer,
        talking_points: typeof nextLead.talking_points === 'string' ? JSON.parse(nextLead.talking_points) : nextLead.talking_points,
      },
      hasMore: upcoming.length > 0,
      upcoming,
      stats,
    });
  } catch (error) {
    console.error('Agent dialer-leads next error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Failed to get next lead' },
      { status: 500 }
    );
  }
}
