import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { handler, ok, readJson, requireHr, HttpError } from '@/lib/training/http';

export const dynamic = 'force-dynamic';

/** PUT /api/training/integration/webhooks/{id} { active } */
export const PUT = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  await requireHr(request);
  const b = await readJson(request);
  const rows = await query(`UPDATE training_webhooks SET active = $2 WHERE id = $1 RETURNING id, active`, [Number(params.id), !!b.active]);
  if (!rows.length) throw new HttpError(404, 'Webhook not found');
  return ok(rows[0]);
});

/** DELETE /api/training/integration/webhooks/{id} */
export const DELETE = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  await requireHr(request);
  const rows = await query(`DELETE FROM training_webhooks WHERE id = $1 RETURNING id`, [Number(params.id)]);
  if (!rows.length) throw new HttpError(404, 'Webhook not found');
  return ok({ deleted: Number(params.id) });
});
