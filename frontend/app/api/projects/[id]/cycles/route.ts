import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { getViewer, loadProject, requireSupervisor, systemMessage, openNextCycle } from '@/lib/projects/core';

export const dynamic = 'force-dynamic';

/**
 * POST /api/projects/{id}/cycles { action: 'deliver' | 'skip' | 'open_next', cycle_id?, notes? }
 * Recurring projects: mark the current cycle delivered (or skipped) — the next
 * cycle opens automatically — or open the next one early. Supervisor only.
 */
export const POST = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const v = await getViewer(request);
  requireSupervisor(v);
  const p = await loadProject(Number(params.id), v);
  if (p.project_type !== 'recurring') throw new HttpError(400, 'This is not a recurring project');
  const b = await readJson(request);

  if (b.action === 'open_next') {
    const id = await openNextCycle(p.id);
    if (!id) throw new HttpError(400, 'No further cycle (the recurring end date has passed or the project is closed)');
    return ok({ opened: id });
  }
  if (!['deliver', 'skip'].includes(b.action)) throw new HttpError(400, 'Unknown action');

  const cycle = b.cycle_id
    ? await queryOne<any>(`SELECT * FROM project_cycles WHERE id = $1 AND project_id = $2`, [Number(b.cycle_id), p.id])
    : await queryOne<any>(`SELECT * FROM project_cycles WHERE project_id = $1 AND status = 'open' ORDER BY cycle_no LIMIT 1`, [p.id]);
  if (!cycle) throw new HttpError(404, 'No open cycle');
  await query(
    `UPDATE project_cycles SET status = $2, delivered_at = CASE WHEN $2::varchar = 'delivered' THEN NOW() ELSE NULL END, notes = COALESCE($3, notes) WHERE id = $1`,
    [cycle.id, b.action === 'deliver' ? 'delivered' : 'skipped', b.notes || null]
  );
  await query(
    `UPDATE project_milestones SET status = 'done', completed_at = COALESCE(completed_at, NOW()) WHERE cycle_id = $1 AND $2::boolean`,
    [cycle.id, b.action === 'deliver' && b.complete_milestones === true]
  );
  await systemMessage(p.id, `${v.name} marked cycle ${cycle.cycle_no} as ${b.action === 'deliver' ? 'delivered ✓' : 'skipped'}${b.notes ? `: ${String(b.notes).slice(0, 500)}` : '.'}`, v.userId);

  // Keep the next period open if this one is already over.
  const hasCurrent = await queryOne(`SELECT 1 FROM project_cycles WHERE project_id = $1 AND status = 'open'`, [p.id]);
  const next = hasCurrent ? null : await openNextCycle(p.id);
  return ok({ cycle_id: cycle.id, next_cycle_id: next });
});
