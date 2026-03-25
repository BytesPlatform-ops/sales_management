import { query, queryOne } from '@/lib/db';

/**
 * Core distribution logic — used by both manual distribute API and auto-scheduler.
 * Distributes leads to all active agents with priority: callbacks → recycled → fresh.
 */
export async function distributeLeads(leadsPerAgent: number, agentIds?: number[]) {
  // 1. Get agents
  let agents;
  if (agentIds && agentIds.length > 0) {
    agents = await query<{ id: number; full_name: string }>(
      `SELECT id, full_name FROM users WHERE role = 'agent' AND is_active = true AND id = ANY($1)`,
      [agentIds]
    );
  } else {
    agents = await query<{ id: number; full_name: string }>(
      `SELECT id, full_name FROM users WHERE role = 'agent' AND is_active = true ORDER BY full_name`
    );
  }

  if (agents.length === 0) {
    return { distributed: 0, callbacks: 0, recycled: 0, fresh: 0, breakdown: [], message: 'No active agents found' };
  }

  const today = new Date().toISOString().split('T')[0];

  // 2. Check existing pending leads per agent
  const existingCounts = await query<{ assigned_agent_id: number; count: string }>(
    `SELECT assigned_agent_id, COUNT(*) as count
     FROM dialer_leads
     WHERE assigned_agent_id IS NOT NULL
       AND pool = 'active'
       AND call_outcome = 'pending'
     GROUP BY assigned_agent_id`
  );

  const countMap = new Map(existingCounts.map(r => [Number(r.assigned_agent_id), parseInt(r.count)]));

  // 3. Calculate needs
  const agentNeeds: { id: number; full_name: string; needed: number }[] = [];
  const agentBreakdown = new Map<string, number>(); // tracks total distributed per agent
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
    return { distributed: 0, callbacks: 0, recycled: 0, fresh: 0, breakdown: [], message: 'All agents already at limit' };
  }

  // 4. PRIORITY 1: Callback leads (same agent, date reached)
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
      agentBreakdown.set(need.full_name, (agentBreakdown.get(need.full_name) || 0) + 1);
    }
  }

  if (totalNeeded <= 0) {
    return {
      distributed: callbackCount, callbacks: callbackCount, recycled: 0, fresh: 0,
      breakdown: [], message: `Distributed ${callbackCount} callback leads`,
    };
  }

  // 5. PRIORITY 2: Recycled leads (different agent, recycle period passed)
  const recycledLeads = await query<{ id: number; previous_agents: any; recycle_after_days: number }>(
    `SELECT id, previous_agents, recycle_after_days FROM dialer_leads
     WHERE pool = 'recycle'
       AND last_outcome_at <= NOW() - (COALESCE(recycle_after_days, 15) || ' days')::INTERVAL
     ORDER BY last_outcome_at ASC
     LIMIT $1`,
    [totalNeeded]
  );

  const distribution = agentNeeds.map(a => ({ agentId: a.id, agentName: a.full_name, leadIds: [] as number[] }));

  let recycledCount = 0;
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

  // Bulk update recycled leads
  for (const dist of distribution) {
    if (dist.leadIds.length === 0) continue;
    await query(
      `UPDATE dialer_leads
       SET assigned_agent_id = $1, assigned_date = $2, pool = 'active', call_outcome = 'pending', updated_at = NOW()
       WHERE id = ANY($3)`,
      [dist.agentId, today, dist.leadIds]
    );
    agentBreakdown.set(dist.agentName, (agentBreakdown.get(dist.agentName) || 0) + dist.leadIds.length);
  }

  // Recalculate remaining needs
  for (const dist of distribution) {
    const need = agentNeeds.find(a => a.id === dist.agentId)!;
    need.needed -= dist.leadIds.length;
  }
  totalNeeded = agentNeeds.reduce((sum, a) => sum + a.needed, 0);

  // 6. PRIORITY 3: Fresh leads — state-aware round-robin
  // Fetch fresh leads grouped by state so each agent gets leads from all states evenly
  let freshCount = 0;
  if (totalNeeded > 0) {
    // Get available states
    const availableStates = await query<{ state: string | null }>(
      `SELECT DISTINCT state FROM dialer_leads
       WHERE pool = 'fresh' AND assigned_agent_id IS NULL`
    );
    const states = availableStates.map(r => r.state);

    // Fetch fresh leads per state
    const freshByState: Map<string | null, number[]> = new Map();
    for (const state of states) {
      const leads = await query<{ id: number }>(
        state === null
          ? `SELECT id FROM dialer_leads WHERE pool = 'fresh' AND assigned_agent_id IS NULL AND state IS NULL ORDER BY id ASC`
          : `SELECT id FROM dialer_leads WHERE pool = 'fresh' AND assigned_agent_id IS NULL AND state = $1 ORDER BY id ASC`,
        state === null ? [] : [state]
      );
      if (leads.length > 0) {
        freshByState.set(state, leads.map(l => l.id));
      }
    }

    const freshDist = agentNeeds.filter(a => a.needed > 0).map(a => ({ agentId: a.id, agentName: a.full_name, leadIds: [] as number[] }));

    if (freshByState.size > 0) {
      // Round-robin: pick one lead from each state in turn for each agent
      const stateKeys = Array.from(freshByState.keys());
      const stateIndexes = new Map(stateKeys.map(s => [s, 0])); // track position per state

      let agentIdx = 0;
      let assigned = true;
      while (assigned) {
        assigned = false;
        for (const stateKey of stateKeys) {
          const ids = freshByState.get(stateKey)!;
          const stateIdx = stateIndexes.get(stateKey)!;
          if (stateIdx >= ids.length) continue; // this state exhausted

          // Try to assign to next agent who still needs leads
          let attempts = 0;
          while (attempts < freshDist.length) {
            const dist = freshDist[agentIdx % freshDist.length];
            const need = agentNeeds.find(a => a.id === dist.agentId)!;
            if (dist.leadIds.length < need.needed) {
              dist.leadIds.push(ids[stateIdx]);
              stateIndexes.set(stateKey, stateIdx + 1);
              freshCount++;
              agentIdx++;
              assigned = true;
              break;
            }
            agentIdx++;
            attempts++;
          }
          if (attempts >= freshDist.length) break; // all agents full
        }
        // Check if all agents are full
        const allFull = freshDist.every(d => {
          const need = agentNeeds.find(a => a.id === d.agentId)!;
          return d.leadIds.length >= need.needed;
        });
        if (allFull) break;
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
      agentBreakdown.set(dist.agentName, (agentBreakdown.get(dist.agentName) || 0) + dist.leadIds.length);
    }
  }

  const totalDistributed = callbackCount + recycledCount + freshCount;

  return {
    distributed: totalDistributed,
    callbacks: callbackCount,
    recycled: recycledCount,
    fresh: freshCount,
    breakdown: Array.from(agentBreakdown.entries()).map(([agent, count]) => ({ agent, count })),
    message: `Distributed ${totalDistributed} leads (${callbackCount} callbacks, ${recycledCount} recycled, ${freshCount} fresh)`,
  };
}

/**
 * Run auto-distribution if enabled and it's time.
 * Called by the in-app scheduler every minute.
 */
export async function checkAndAutoDistribute() {
  try {
    const settings = await queryOne<any>(
      `SELECT leads_per_agent, auto_distribute_enabled, auto_distribute_time, last_auto_distributed_at
       FROM distribution_settings WHERE id = 1`
    );

    if (!settings?.auto_distribute_enabled) return;

    // Get current time in PKT
    const now = new Date();
    const pktTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Karachi' }));
    const currentHour = pktTime.getHours().toString().padStart(2, '0');
    const currentMin = pktTime.getMinutes().toString().padStart(2, '0');
    const currentTime = `${currentHour}:${currentMin}`;

    const targetTime = settings.auto_distribute_time || '19:00';

    // Check if already ran today — if yes, skip
    if (settings.last_auto_distributed_at) {
      const lastRun = new Date(settings.last_auto_distributed_at);
      const lastRunPKT = new Date(lastRun.toLocaleString('en-US', { timeZone: 'Asia/Karachi' }));
      if (
        lastRunPKT.getFullYear() === pktTime.getFullYear() &&
        lastRunPKT.getMonth() === pktTime.getMonth() &&
        lastRunPKT.getDate() === pktTime.getDate()
      ) {
        return; // Already ran today
      }
    }

    // Run if current time >= configured time (catches late server starts / restarts)
    if (currentTime < targetTime) return;

    console.log(`🤖 AUTO-DISTRIBUTE: Triggered at ${currentTime} PKT`);

    const result = await distributeLeads(settings.leads_per_agent || 200);

    // Update last run timestamp
    await query(`UPDATE distribution_settings SET last_auto_distributed_at = NOW() WHERE id = 1`);

    console.log(`✅ AUTO-DISTRIBUTE: ${result.message}`);
  } catch (error) {
    console.error('❌ AUTO-DISTRIBUTE ERROR:', error);
  }
}
