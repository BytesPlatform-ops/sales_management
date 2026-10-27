import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { handler, ok, HttpError } from '@/lib/training/http';
import { assertEntityAccess, entityMediaAccess, mediaProject, projectIdFor } from '@/lib/media/access';
import { isMediaEntity } from '@/lib/media/rules';

export const dynamic = 'force-dynamic';

const COLS = `m.id, m.project_id, m.entity_type, m.entity_id, m.file_name, m.mime_type, m.size_bytes::bigint AS size_bytes, m.description,
  m.kind, m.uploaded_by, u.full_name AS uploaded_by_name, m.created_at, m.deleted_at,
  CASE WHEN m.entity_type = 'ticket' THEN (SELECT key FROM tickets WHERE id = m.entity_id::int)
       WHEN m.entity_type = 'ticket_comment' THEN (SELECT t.key FROM ticket_comments c JOIN tickets t ON t.id = c.ticket_id WHERE c.id = m.entity_id::int)
  END AS ticket_key`;

/**
 * GET /api/media?entity_type=ticket&entity_id=5     files on one thing
 * GET /api/media?project_id=3                         every file in the project (Files tab)
 *     &kind=image|video|audio|pdf|file|voice &uploader=<id> &q=<search name/description> &deleted=1 (HR: recently deleted)
 *     &entity_types=message,brief_entry   only files attached to those kinds of things
 */
export const GET = handler(async (request: NextRequest) => {
  const sp = new URL(request.url).searchParams;
  let projectId: number;
  const where: string[] = [`m.status = 'ready'`];
  const args: any[] = [];
  const add = (sql: string, v: unknown) => { args.push(v); where.push(sql.replaceAll('?', `$${args.length}`)); };

  const entity = sp.get('entity_type');
  if (entity) {
    if (!isMediaEntity(entity)) throw new HttpError(400, 'Unknown entity type');
    projectId = await projectIdFor(entity, String(sp.get('entity_id')));
    add('m.entity_type = ?', entity);
    add('m.entity_id = ?', String(Number(sp.get('entity_id'))));
  } else {
    projectId = Number(sp.get('project_id'));
    if (!projectId) throw new HttpError(400, 'project_id or entity_type is required');
  }
  const { viewer, project } = entity
    ? await entityMediaAccess(request, entity as any, String(sp.get('entity_id')), projectId, 'read')
    : await mediaProject(request, projectId);
  if (entity) await assertEntityAccess(viewer, project, entity as any, String(sp.get('entity_id')), 'list');
  add('m.project_id = ?', projectId);
  // Someone else's unsent message draft (and anything on a deleted message) is never listed.
  add(`NOT (m.entity_type = 'message' AND EXISTS (SELECT 1 FROM project_messages pm WHERE pm.id = m.entity_id::int
         AND (pm.deleted_at IS NOT NULL OR (pm.is_draft AND COALESCE(pm.user_id, 0) <> ?))))`, viewer.userId);
  // &entity_types=message,brief_entry — e.g. the thread's Media tab.
  const types = (sp.get('entity_types') || '').split(',').filter((t) => isMediaEntity(t));
  if (!entity && types.length) add('m.entity_type = ANY(?::text[])', types);

  if (sp.get('deleted') === '1') {
    if (viewer.role !== 'hr') throw new HttpError(403, 'Only HR can see deleted files');
    where.push(`m.deleted_at IS NOT NULL AND m.deleted_at > NOW() - INTERVAL '30 days'`);
  } else where.push('m.deleted_at IS NULL');
  if (sp.get('kind')) add('m.kind = ?', sp.get('kind'));
  if (sp.get('uploader')) add('m.uploaded_by = ?', Number(sp.get('uploader')));
  const q = (sp.get('q') || '').trim();
  if (q) add(`(m.search @@ plainto_tsquery('simple', ?) OR m.file_name ILIKE '%' || ? || '%' OR m.description ILIKE '%' || ? || '%')`, q.slice(0, 200));

  return ok(await query(
    `SELECT ${COLS} FROM media_files m LEFT JOIN users u ON u.id = m.uploaded_by
      WHERE ${where.join(' AND ')} ORDER BY m.created_at DESC LIMIT 500`,
    args
  ));
});
