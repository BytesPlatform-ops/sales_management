import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { handler, ok, HttpError } from '@/lib/training/http';
import { loadMedia } from '@/lib/media/access';
import { RESTORE_DAYS } from '@/lib/media/rules';

export const dynamic = 'force-dynamic';

/** POST /api/media/{id}/restore — HR, within 30 days of deletion. */
export const POST = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const { media: m, viewer } = await loadMedia(request, params.id, { allowDeleted: true });
  if (viewer.role !== 'hr') throw new HttpError(403, 'Only HR can restore files');
  if (!m.deleted_at) return ok({ id: m.id });
  if (Date.now() - new Date(m.deleted_at).getTime() > RESTORE_DAYS * 86_400_000) throw new HttpError(400, 'Too late to restore this file');
  await query(`UPDATE media_files SET deleted_at = NULL, deleted_by = NULL WHERE id = $1`, [m.id]);
  return ok({ id: m.id, restored: true });
});
