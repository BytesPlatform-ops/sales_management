import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { handler, ok, HttpError } from '@/lib/training/http';
import { entryCtx } from '@/lib/brief/core';

export const dynamic = 'force-dynamic';

/** POST /api/brief/{entryId}/restore — HR brings back a deleted brief update. */
export const POST = handler(async (request: NextRequest, { params }: { params: { entryId: string } }) => {
  const { entry: e, actor } = await entryCtx(request, Number(params.entryId), { allowDeleted: true });
  if (actor.role !== 'hr') throw new HttpError(403, 'Only HR can restore brief updates');
  await query(`UPDATE brief_entries SET deleted_at = NULL, deleted_by = NULL WHERE id = $1`, [e.id]);
  return ok({ id: e.id, restored: true });
});
