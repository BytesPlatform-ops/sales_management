import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { announceEntry, briefCtx, ensureOriginal } from '@/lib/brief/core';
import { canAddBrief, canEditBrief, canMarkBrief, cleanTags, isBriefType } from '@/lib/brief/rules';
import { str } from '@/lib/tickets/input';

export const dynamic = 'force-dynamic';

/**
 * GET /api/projects/{id}/brief?type=&q=&deleted=1
 * The brief timeline, newest first, with each entry's files, marks and history count.
 * q searches entry text and the descriptions/names of their files.
 * deleted=1 (HR) lists deleted entries for restore.
 */
export const GET = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const ctx = await briefCtx(request, Number(params.id));
  const { project, actor } = ctx;
  await ensureOriginal(project as any);
  const sp = new URL(request.url).searchParams;
  const args: unknown[] = [project.id];
  const where = ['e.project_id = $1'];
  if (sp.get('deleted') === '1') {
    if (actor.role !== 'hr') throw new HttpError(403, 'Only HR can see deleted brief updates');
    where.push('e.deleted_at IS NOT NULL');
  } else where.push('e.deleted_at IS NULL');
  const type = sp.get('type');
  if (type && isBriefType(type)) { args.push(type); where.push(`e.type = $${args.length}`); }
  const q = (sp.get('q') || '').trim().slice(0, 200);
  if (q) {
    args.push(q);
    where.push(`(e.search @@ plainto_tsquery('english', $${args.length}) OR e.body ILIKE '%' || $${args.length} || '%'
      OR EXISTS (SELECT 1 FROM media_files f WHERE f.entity_type = 'brief_entry' AND f.entity_id = e.id::text AND f.deleted_at IS NULL
                 AND (f.description ILIKE '%' || $${args.length} || '%' OR f.file_name ILIKE '%' || $${args.length} || '%')))`);
  }
  const rows = await query(
    `SELECT e.id, e.type, e.body, e.tags, e.is_original, e.version, e.created_by, cu.full_name AS created_by_name, cu.role AS created_by_role,
            e.created_at, e.edited_at, eu.full_name AS edited_by_name, e.deleted_at, e.source_message_id,
            (SELECT COUNT(*) FROM brief_entry_versions v WHERE v.entry_id = e.id)::int AS history_count,
            (SELECT COUNT(*) FROM media_files f WHERE f.entity_type = 'brief_entry' AND f.entity_id = e.id::text AND f.deleted_at IS NULL AND f.status = 'ready')::int AS file_count,
            COALESCE((SELECT json_agg(json_build_object('id', m.id, 'user_id', m.user_id, 'name', mu.full_name, 'kind', m.kind, 'comment', m.comment,
                                                        'created_at', m.created_at, 'resolved_at', m.resolved_at, 'resolution', m.resolution) ORDER BY m.id)
                        FROM brief_entry_marks m LEFT JOIN users mu ON mu.id = m.user_id WHERE m.entry_id = e.id), '[]') AS marks,
            (SELECT t.key FROM tickets t WHERE t.source_brief_entry_id = e.id AND t.deleted_at IS NULL ORDER BY t.id LIMIT 1) AS ticket_key
       FROM brief_entries e
       LEFT JOIN users cu ON cu.id = e.created_by
       LEFT JOIN users eu ON eu.id = e.edited_by
      WHERE ${where.join(' AND ')}
      ORDER BY e.is_original ASC, e.created_at DESC, e.id DESC`,
    args
  );
  return ok({
    entries: rows,
    can: { add: canAddBrief(actor), mark: canMarkBrief(actor), restore: actor.role === 'hr' },
    // Per-entry edit rights depend on the author; the browser checks with this.
    me: { id: actor.userId, role: actor.role, can_edit_any: canEditBrief(actor, { created_by: -1 }) },
  });
});

/** POST /api/projects/{id}/brief { type, body, tags? } — HR or the client's agent. Files are attached afterwards. */
export const POST = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const ctx = await briefCtx(request, Number(params.id));
  if (!canAddBrief(ctx.actor)) throw new HttpError(403, 'Only HR or the client’s agent can add brief updates');
  const b = await readJson(request);
  if (!isBriefType(b.type)) throw new HttpError(400, 'Pick a type: requirement, content, change, feedback or clarification');
  const body = str(b.body, 'Text', 50_000) ?? '';
  if (!body && !b.allow_empty) throw new HttpError(400, 'Write something (you can attach files next)');
  const entry = await queryOne<{ id: number; type: any; body: string }>(
    `INSERT INTO brief_entries (project_id, type, body, tags, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id, type, body`,
    [ctx.project.id, b.type, body, cleanTags(b.tags), ctx.viewer.userId]
  );
  // Files are uploaded right after; the text is announced now and the files show on the entry.
  await announceEntry(ctx, entry!);
  return ok({ id: entry!.id });
});
