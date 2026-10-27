import { NextRequest } from 'next/server';
import { queryOne } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { canWorkTicket } from '@/lib/tickets/rules';
import { projectCtx } from '@/lib/tickets/core';
import { sanitizeWipLimits } from '@/lib/tickets/board';

export const dynamic = 'force-dynamic';

/** GET /api/projects/{id}/board-settings → { wip_limits } — anyone who can see the project. */
export const GET = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const { project } = await projectCtx(request, Number(params.id));
  const row = await queryOne<{ wip_limits: unknown }>(`SELECT wip_limits FROM project_board_settings WHERE project_id = $1`, [project.id]);
  return ok({ wip_limits: sanitizeWipLimits(row?.wip_limits) });
});

/** PUT /api/projects/{id}/board-settings { wip_limits: { in_progress: 5, … } } — developers and HR. */
export const PUT = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const { project, actor, viewer } = await projectCtx(request, Number(params.id));
  if (!canWorkTicket(actor)) throw new HttpError(403, 'Only the project’s developers or HR can change WIP limits');
  const limits = sanitizeWipLimits((await readJson(request)).wip_limits);
  await queryOne(
    `INSERT INTO project_board_settings (project_id, wip_limits, updated_by, updated_at) VALUES ($1, $2::jsonb, $3, NOW())
     ON CONFLICT (project_id) DO UPDATE SET wip_limits = EXCLUDED.wip_limits, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [project.id, JSON.stringify(limits), viewer.userId]
  );
  return ok({ wip_limits: limits });
});
