import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/cron/auto-distribute
 * Called by external cron job (crontab, Vercel Cron, etc.)
 * Requires: Authorization: Bearer <cron_secret>
 *
 * This runs the same distribution logic as the manual distribute endpoint:
 * 1. Callbacks (same agent) → 2. Recycled (different agent) → 3. Fresh leads
 * Distributes to ALL active agents based on leads_per_agent setting.
 */
export async function POST(request: NextRequest) {
  try {
    // Authenticate via cron secret
    const authHeader = request.headers.get('authorization');
    const providedSecret = authHeader?.replace('Bearer ', '');

    if (!providedSecret) {
      return NextResponse.json({ status: 'error', message: 'No secret provided' }, { status: 401 });
    }

    const settings = await queryOne<any>(
      `SELECT leads_per_agent, auto_distribute_enabled, cron_secret
       FROM distribution_settings WHERE id = 1`
    );

    if (!settings?.cron_secret || settings.cron_secret !== providedSecret) {
      return NextResponse.json({ status: 'error', message: 'Invalid secret' }, { status: 403 });
    }

    if (!settings.auto_distribute_enabled) {
      return NextResponse.json({
        status: 'success',
        message: 'Auto-distribution is disabled',
        data: { distributed: 0 },
      });
    }

    const leadsPerAgent = settings.leads_per_agent || 200;

    console.log(`🤖 AUTO-DISTRIBUTE: Starting at ${new Date().toISOString()}, ${leadsPerAgent} leads/agent`);

    // Get all active agents
    const agents = await query<{ id: number; full_name: string }>(
      `SELECT id, full_name FROM users WHERE role = 'agent' AND is_active = true ORDER BY full_name`
    );

    if (agents.length === 0) {
      return NextResponse.json({
        status: 'success',
        message: 'No active agents found',
        data: { distributed: 0 },
      });
    }

    const today = new Date().toISOString().split('T')[0];

    // Check existing pending leads per agent
    const existingCounts = await query<{ assigned_agent_id: number; count: string }>(
      `SELECT assigned_agent_id, COUNT(*) as count
       FROM dialer_leads
       WHERE assigned_agent_id IS NOT NULL
         AND pool = 'active'
         AND call_outcome = 'pending'
       GROUP BY assigned_agent_id`
    );

    const countMap = new Map(existingCounts.map(r => [Number(r.assigned_agent_id), parseInt(r.count)]));

    // Calculate needs
    const agentNeeds: { id: number; full_name: string; needed: number }[] = [];
    let totalNeeded = 0;

    for (const agent of agents) {
      const existing = countMap.get(Number(agent.id)) || 0;
      const needed = Math.max(0, leadsPerAgent - existing);
      if (needed > 0) {
        agentNeeds.push({ id: Number(agent.id), full_name: agent.full_name, needed });
        totalNeeded += needed;
      }
    }

    if (totalNeeded === 0) {
      await query(`UPDATE distribution_settings SET last_auto_distributed_at = NOW() WHERE id = 1`);
      return NextResponse.json({
        status: 'success',
        message: 'All agents already at their lead limit',
        data: { distributed: 0 },
      });
    }

    // PRIORITY 1: Callback leads
    const callbackLeads = await query<{ id: number; assigned_agent_id: number }>(
      `SELECT id, assigned_agent_id FROM dialer_leads
       WHERE pool = 'callback'
         AND (next_callback_at IS NULL OR next_callback_at <= NOW())
       ORDER BY next_callback_at ASC NULLS FIRST`
    );

    let callbackCount = 0;
    for (const cb of callbackLeads) {
      const agentId = Number(cb.assigned_agent_id);
      const need = agentNeeds.find(a => a.id === agentId);
      if (need && need.needed > 0) {
        await query(
          `UPDATE dialer_leads SET pool = 'active', call_outcome = 'pending', assigned_date = $1, updated_at = NOW() WHERE id = $2`,
          [today, cb.id]
        );
        need.needed--;
        totalNeeded--;
        callbackCount++;
      }
    }

    // PRIORITY 2: Recycled leads (different agent)
    let recycledCount = 0;
    if (totalNeeded > 0) {
      const recycledLeads = await query<{ id: number; previous_agents: any; recycle_after_days: number }>(
        `SELECT id, previous_agents, recycle_after_days FROM dialer_leads
         WHERE pool = 'recycle'
           AND last_outcome_at <= NOW() - (COALESCE(recycle_after_days, 15) || ' days')::INTERVAL
         ORDER BY last_outcome_at ASC
         LIMIT $1`,
        [totalNeeded]
      );

      const distribution = agentNeeds.map(a => ({ agentId: a.id, leadIds: [] as number[] }));

      for (const rl of recycledLeads) {
        let prevAgents: number[] = [];
        try {
          prevAgents = Array.isArray(rl.previous_agents) ? rl.previous_agents : JSON.parse(rl.previous_agents || '[]');
        } catch { prevAgents = []; }

        let assigned = false;
        for (const dist of distribution) {
          const need = agentNeeds.find(a => a.id === dist.agentId)!;
          if (dist.leadIds.length < need.needed && !prevAgents.includes(dist.agentId)) {
            dist.leadIds.push(Number(rl.id));
            recycledCount++;
            assigned = true;
            break;
          }
        }
        if (!assigned) {
          for (const dist of distribution) {
            const need = agentNeeds.find(a => a.id === dist.agentId)!;
            if (dist.leadIds.length < need.needed) {
              dist.leadIds.push(Number(rl.id));
              recycledCount++;
              break;
            }
          }
        }
      }

      for (const dist of distribution) {
        if (dist.leadIds.length === 0) continue;
        await query(
          `UPDATE dialer_leads
           SET assigned_agent_id = $1, assigned_date = $2, pool = 'active', call_outcome = 'pending', updated_at = NOW()
           WHERE id = ANY($3)`,
          [dist.agentId, today, dist.leadIds]
        );
        const need = agentNeeds.find(a => a.id === dist.agentId)!;
        need.needed -= dist.leadIds.length;
      }
      totalNeeded = agentNeeds.reduce((sum, a) => sum + a.needed, 0);
    }

    // PRIORITY 3: Fresh leads
    let freshCount = 0;
    if (totalNeeded > 0) {
      const freshLeads = await query<{ id: number }>(
        `SELECT id FROM dialer_leads
         WHERE pool = 'fresh' AND assigned_agent_id IS NULL
         ORDER BY RANDOM()
         LIMIT $1`,
        [totalNeeded]
      );

      const freshDist = agentNeeds.filter(a => a.needed > 0).map(a => ({ agentId: a.id, leadIds: [] as number[] }));

      let idx = 0;
      for (const fl of freshLeads) {
        let attempts = 0;
        while (attempts < freshDist.length) {
          const dist = freshDist[idx % freshDist.length];
          const need = agentNeeds.find(a => a.id === dist.agentId)!;
          if (dist.leadIds.length < need.needed) {
            dist.leadIds.push(Number(fl.id));
            idx++;
            freshCount++;
            break;
          }
          idx++;
          attempts++;
        }
      }

      for (const dist of freshDist) {
        if (dist.leadIds.length === 0) continue;
        await query(
          `UPDATE dialer_leads
           SET assigned_agent_id = $1, assigned_date = $2, pool = 'active', updated_at = NOW()
           WHERE id = ANY($3)`,
          [dist.agentId, today, dist.leadIds]
        );
      }
    }

    const totalDistributed = callbackCount + recycledCount + freshCount;

    // Update last distributed timestamp
    await query(`UPDATE distribution_settings SET last_auto_distributed_at = NOW() WHERE id = 1`);

    console.log(`✅ AUTO-DISTRIBUTE: Done. ${totalDistributed} leads (${callbackCount} cb, ${recycledCount} recycled, ${freshCount} fresh)`);

    return NextResponse.json({
      status: 'success',
      message: `Auto-distributed ${totalDistributed} leads to ${agents.length} agents`,
      data: {
        distributed: totalDistributed,
        callbacks: callbackCount,
        recycled: recycledCount,
        fresh: freshCount,
        agents: agents.length,
      },
    });
  } catch (error) {
    console.error('Auto-distribute cron error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Auto-distribution failed' },
      { status: 500 }
    );
  }
}
