import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { handler, ok, requireServiceOrHr, HttpError } from '@/lib/training/http';
import { getRampStatus } from '@/lib/training/ramp';
import { getSettings } from '@/lib/training/settings';

export const dynamic = 'force-dynamic';

/**
 * GET /api/training/integration/ramp-status/{employee_id}
 * For the salary system (B.9). Auth: HR JWT or Bearer TRAINING_SERVICE_TOKEN / CRON_SECRET.
 * Use "all" to get every rep (same rows as the v_rep_ramp_status view).
 */
export const GET = handler(async (request: NextRequest, { params }: { params: { employeeId: string } }) => {
  await requireServiceOrHr(request);
  const settings = await getSettings();
  if (params.employeeId === 'all') return ok(await query(`SELECT * FROM v_rep_ramp_status ORDER BY employee_id`));

  const id = Number(params.employeeId);
  const user = await queryOne(`SELECT id FROM users WHERE id = $1 AND role = 'agent'`, [id]);
  if (!user) throw new HttpError(404, 'Employee not found');
  const status = await getRampStatus(id);
  const history = await query(`SELECT phase, quota_multiplier, started_at, ended_at, reason FROM training_ramp_history WHERE user_id = $1 ORDER BY started_at`, [id]);
  return ok({
    employee_id: id,
    phase: status.phase,
    quota_multiplier: Number(status.quota_multiplier),
    penalty_free: settings.penalty_free_phases.includes(status.phase),
    quota_credit: !!status.certified_at || status.grandfathered,
    certified_at: status.certified_at,
    phase_started_at: status.phase_started_at,
    grandfathered: status.grandfathered,
    history,
  });
});
