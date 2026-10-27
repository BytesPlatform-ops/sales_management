import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { loadMedia } from '@/lib/media/access';
import { descriptionRequired } from '@/lib/media/rules';

export const dynamic = 'force-dynamic';
type Ctx = { params: { id: string } };

/** PATCH /api/media/{id} { description } — uploader or HR. */
export const PATCH = handler(async (request: NextRequest, { params }: Ctx) => {
  const { media: m, viewer } = await loadMedia(request, params.id);
  if (Number(m.uploaded_by) !== viewer.userId && viewer.role !== 'hr') throw new HttpError(403, 'Only the uploader or HR can edit this');
  const d = String((await readJson(request)).description ?? '').trim().slice(0, 1000);
  if (!d && descriptionRequired(m.entity_type)) throw new HttpError(400, 'A description is required');
  await query(`UPDATE media_files SET description = $2 WHERE id = $1`, [m.id, d || null]);
  return ok({ id: m.id, description: d || null });
});

/** DELETE /api/media/{id} — uploader or HR. Soft delete; HR can restore for 30 days. */
export const DELETE = handler(async (request: NextRequest, { params }: Ctx) => {
  const { media: m, viewer } = await loadMedia(request, params.id);
  if (Number(m.uploaded_by) !== viewer.userId && viewer.role !== 'hr') throw new HttpError(403, 'Only the uploader or HR can delete this');
  await query(`UPDATE media_files SET deleted_at = NOW(), deleted_by = $2 WHERE id = $1`, [m.id, viewer.userId]);
  return ok({ deleted: m.id });
});
