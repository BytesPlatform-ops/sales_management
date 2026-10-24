import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { handler, ok, readJson, requireHr, HttpError } from '@/lib/training/http';
import { getRampStatus, setPhase, setSupervised, RampPhase } from '@/lib/training/ramp';

export const dynamic = 'force-dynamic';

const PHASES: RampPhase[] = ['TRAINING', 'SUPERVISED', 'RAMP_50', 'RAMP_75', 'FULL'];

/** GET /api/training/ramp/{userId} (trainer) — status + history. */
export const GET = handler(async (request: NextRequest, { params }: { params: { userId: string } }) => {
  await requireHr(request);
  const id = Number(params.userId);
  return ok({
    status: await getRampStatus(id),
    history: await query(`SELECT * FROM training_ramp_history WHERE user_id = $1 ORDER BY started_at`, [id]),
  });
});

/**
 * POST /api/training/ramp/{userId} (trainer)
 *   { action: 'supervised_on', reason }  pause penalties while coaching (base pay unaffected)
 *   { action: 'supervised_off', reason }
 *   { action: 'set_phase', phase, reason } manual override
 */
export const POST = handler(async (request: NextRequest, { params }: { params: { userId: string } }) => {
  await requireHr(request);
  const id = Number(params.userId);
  const b = await readJson(request);
  const reason = String(b.reason || '').slice(0, 500);
  if (b.action === 'supervised_on') return ok(await setSupervised(id, true, reason || 'trainer'));
  if (b.action === 'supervised_off') return ok(await setSupervised(id, false, reason));
  if (b.action === 'set_phase') {
    if (!PHASES.includes(b.phase)) throw new HttpError(400, `phase must be one of ${PHASES.join(', ')}`);
    return ok(await setPhase(id, b.phase, `trainer override${reason ? `: ${reason}` : ''}`));
  }
  throw new HttpError(400, 'Unknown action');
});
