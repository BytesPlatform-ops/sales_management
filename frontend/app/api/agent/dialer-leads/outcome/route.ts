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

const VALID_OUTCOMES = [
  'interested',
  'not_interested',
  'voicemail',
  'busy',
  'gatekeeper',
  'owner_picked',
  'callback',
  'bad_number',
  'dnc',
] as const;

/**
 * Pool logic:
 * - interested / owner_picked → 'interested' pool (pipeline starts)
 * - callback                  → 'callback' pool (same agent, specific date)
 * - bad_number / gatekeeper   → 'dead' pool (unreachable)
 * - everything else (not_interested, voicemail, busy, dnc) → 'recycle'
 *   recycled to different agent after recycle_after_days, up to max_attempts
 */
// Priority hierarchy: highest-priority outcome determines pool + stored call_outcome
// Positive outcomes first (keep lead alive), negative outcomes last
const OUTCOME_PRIORITY: string[] = [
  'interested', 'owner_picked', 'callback',
  'not_interested', 'voicemail', 'busy', 'dnc',
  'gatekeeper', 'bad_number',
];

function determinePool(outcomes: string[], callCount: number, maxAttempts: number): { pool: string; pipelineStage: string | null; primaryOutcome: string } {
  // Pick the highest-priority outcome from the selected array
  const primary = OUTCOME_PRIORITY.find(o => outcomes.includes(o)) || outcomes[0];

  if (primary === 'interested' || primary === 'owner_picked') {
    return { pool: 'interested', pipelineStage: 'new_interested', primaryOutcome: primary };
  }
  if (primary === 'callback') {
    return { pool: 'callback', pipelineStage: null, primaryOutcome: primary };
  }
  if (primary === 'bad_number' || primary === 'gatekeeper') {
    return { pool: 'dead', pipelineStage: null, primaryOutcome: primary };
  }

  // Everything else recycles — unless max attempts reached
  if (callCount + 1 >= maxAttempts) {
    return { pool: 'dead', pipelineStage: null, primaryOutcome: primary };
  }
  return { pool: 'recycle', pipelineStage: null, primaryOutcome: primary };
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ status: 'error', message: 'No token provided' }, { status: 401 });
    }

    const token = authHeader.split(' ')[1];
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const jwt = payload as unknown as JwtPayload;

    const body = await request.json();
    const { lead_id, outcomes, notes, callback_at } = body;

    if (!lead_id) {
      return NextResponse.json({ status: 'error', message: 'lead_id is required' }, { status: 400 });
    }

    if (!outcomes || !Array.isArray(outcomes) || outcomes.length === 0) {
      return NextResponse.json({ status: 'error', message: 'outcomes array is required' }, { status: 400 });
    }

    for (const o of outcomes) {
      if (!VALID_OUTCOMES.includes(o)) {
        return NextResponse.json({ status: 'error', message: `Invalid outcome: ${o}` }, { status: 400 });
      }
    }

    // Fetch lead with current state
    const lead = await queryOne<any>(
      `SELECT id, assigned_agent_id, call_count, max_attempts, previous_agents
       FROM dialer_leads WHERE id = $1`,
      [lead_id]
    );

    if (!lead) {
      return NextResponse.json({ status: 'error', message: 'Lead not found' }, { status: 404 });
    }

    console.log('📋 OUTCOME: lead.assigned_agent_id =', lead.assigned_agent_id, 'type:', typeof lead.assigned_agent_id);
    console.log('📋 OUTCOME: jwt.userId =', jwt.userId, 'type:', typeof jwt.userId);
    console.log('📋 OUTCOME: Number comparison:', Number(lead.assigned_agent_id), '!==', jwt.userId, '=', Number(lead.assigned_agent_id) !== jwt.userId);

    if (Number(lead.assigned_agent_id) !== Number(jwt.userId)) {
      console.log('🔴 OUTCOME: Agent mismatch! Returning 403');
      return NextResponse.json({ status: 'error', message: 'Lead not assigned to you' }, { status: 403 });
    }

    const currentCount = Number(lead.call_count) || 0;
    const maxAttempts = Number(lead.max_attempts) || 3;

    const { pool, pipelineStage, primaryOutcome } = determinePool(outcomes, currentCount, maxAttempts);
    console.log('📋 OUTCOME: lead_id =', lead_id, 'outcomes =', outcomes, 'pool =', pool, 'pipelineStage =', pipelineStage);

    // Track previous agents (for recycle — don't assign to same agent again)
    let previousAgents: number[] = [];
    try {
      previousAgents = Array.isArray(lead.previous_agents) ? lead.previous_agents : JSON.parse(lead.previous_agents || '[]');
    } catch { previousAgents = []; }
    if (!previousAgents.includes(jwt.userId)) {
      previousAgents.push(jwt.userId);
    }

    // For recycle pool: unassign agent so it goes back to distribution
    const newAgentId = pool === 'recycle' ? null : lead.assigned_agent_id;

    console.log('📋 OUTCOME: Updating lead', lead_id, '→ call_outcome:', primaryOutcome, 'pool:', pool, 'newAgentId:', newAgentId);

    const updated = await queryOne<any>(
      `UPDATE dialer_leads
       SET call_outcome = $1,
           call_outcomes = $2,
           call_notes = $3,
           last_called_at = NOW(),
           last_outcome_at = NOW(),
           call_count = call_count + 1,
           next_callback_at = $4,
           pool = $5::varchar,
           pipeline_stage = COALESCE($6::varchar, pipeline_stage),
           previous_agents = $7,
           assigned_agent_id = $8,
           assigned_date = CASE WHEN $5::varchar = 'recycle' THEN NULL ELSE assigned_date END,
           updated_at = NOW()
       WHERE id = $9
       RETURNING id, call_outcome, call_outcomes, call_count, pool, pipeline_stage`,
      [
        primaryOutcome,
        JSON.stringify(outcomes),
        notes || null,
        callback_at || null,
        pool,
        pipelineStage,
        JSON.stringify(previousAgents),
        newAgentId,
        lead_id,
      ]
    );

    console.log('📋 OUTCOME: Update result:', JSON.stringify(updated));

    // Insert call log for history preservation
    await query(
      `INSERT INTO dialer_call_logs (lead_id, agent_id, call_outcome, call_outcomes, notes, pool_after, call_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [lead_id, Number(jwt.userId), primaryOutcome, JSON.stringify(outcomes), notes || null, pool, currentCount + 1]
    );

    return NextResponse.json({
      status: 'success',
      message: `Lead marked as: ${outcomes.join(', ')} → ${pool} pool`,
      data: updated,
    });
  } catch (error) {
    console.error('Agent dialer-leads outcome error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Failed to log outcome' },
      { status: 500 }
    );
  }
}
