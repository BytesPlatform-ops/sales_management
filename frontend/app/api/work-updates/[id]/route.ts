import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { handler, ok, HttpError } from '@/lib/training/http';
import { getViewer, loadProject } from '@/lib/projects/core';

export const dynamic = 'force-dynamic';

/** DELETE /api/work-updates/{id} — the author or HR. Soft delete; its files go with it. */
export const DELETE = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const v = await getViewer(request);
  const w = await queryOne<{ id: number; project_id: number; user_id: string }>(
    `SELECT id, project_id, user_id FROM work_updates WHERE id = $1 AND deleted_at IS NULL`, [Number(params.id)]
  );
  if (!w) throw new HttpError(404, 'Update not found');
  await loadProject(w.project_id, v);
  if (Number(w.user_id) !== v.userId && v.role !== 'hr') throw new HttpError(403, 'Only the author or HR can delete this');
  await query(`UPDATE work_updates SET deleted_at = NOW() WHERE id = $1`, [w.id]);
  await query(`UPDATE media_files SET deleted_at = NOW(), deleted_by = $2 WHERE entity_type = 'work_update' AND entity_id = $1::text AND deleted_at IS NULL`, [w.id, v.userId]);
  await query(`DELETE FROM project_activity WHERE source_id = $1`, [`work-update:${w.id}`]);
  return ok({ deleted: w.id });
});
