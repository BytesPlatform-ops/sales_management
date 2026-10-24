import { NextRequest } from 'next/server';
import { handler, ok, readJson, requireHr } from '@/lib/training/http';
import { deleteEntity, updateEntity } from '@/lib/training/admin';

export const dynamic = 'force-dynamic';

/** PUT /api/training/admin/{entity}/{id} (trainer) */
export const PUT = handler(async (request: NextRequest, { params }: { params: { entity: string; id: string } }) => {
  await requireHr(request);
  return ok(await updateEntity(params.entity, Number(params.id), await readJson(request)));
});

/** DELETE /api/training/admin/{entity}/{id} (trainer) */
export const DELETE = handler(async (request: NextRequest, { params }: { params: { entity: string; id: string } }) => {
  await requireHr(request);
  return ok(await deleteEntity(params.entity, Number(params.id)));
});
