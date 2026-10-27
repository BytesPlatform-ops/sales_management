import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { getViewer, loadProject } from '@/lib/projects/core';
import { actorFor } from '@/lib/tickets/core';
import { str, typeOf } from '@/lib/tickets/input';

export const dynamic = 'force-dynamic';

/**
 * GET /api/ticket-templates?project_id= — company-wide templates plus that project's.
 * HR may pass ?all=1 to see every project's templates too.
 */
export const GET = handler(async (request: NextRequest) => {
  const v = await getViewer(request);
  const sp = new URL(request.url).searchParams;
  if (sp.get('all') === '1' && v.role === 'hr') {
    return ok(await query(
      `SELECT tt.id, tt.project_id, p.ticket_no AS project_ticket_no, tt.name, tt.type, tt.title_prefix, tt.description, tt.checklist,
              tt.require_attachment, tt.created_by IS NULL AS built_in
         FROM ticket_templates tt LEFT JOIN projects p ON p.id = tt.project_id ORDER BY tt.project_id NULLS FIRST, tt.name`
    ));
  }
  const pid = Number(sp.get('project_id')) || null;
  if (pid) await loadProject(pid, v);
  return ok(await query(
    `SELECT id, project_id, name, type, title_prefix, description, checklist, require_attachment, created_by IS NULL AS built_in
       FROM ticket_templates WHERE project_id IS NULL OR project_id = $1 ORDER BY project_id NULLS FIRST, name`,
    [pid]
  ));
});

/**
 * POST /api/ticket-templates { name, type, title_prefix?, description?, checklist?, require_attachment?, project_id? }
 * HR: company-wide or any project. Lead developer: for their project.
 */
export const POST = handler(async (request: NextRequest) => {
  const v = await getViewer(request);
  const b = await readJson(request);
  const pid = b.project_id ? Number(b.project_id) : null;
  if (v.role !== 'hr') {
    if (!pid) throw new HttpError(403, 'Only HR can add company-wide templates');
    const actor = await actorFor(v, await loadProject(pid, v));
    if (actor.memberRole !== 'lead_developer') throw new HttpError(403, 'Only HR or the lead developer can add templates');
  }
  const checklist = Array.isArray(b.checklist) ? b.checklist.map((s: unknown) => String(s).trim().slice(0, 500)).filter(Boolean).slice(0, 100) : [];
  return ok(await queryOne(
    `INSERT INTO ticket_templates (project_id, name, type, title_prefix, description, checklist, require_attachment, created_by)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8) RETURNING id, name, type`,
    [pid, str(b.name, 'Name', 100, true), typeOf(b.type, 'task'), str(b.title_prefix, 'Title prefix', 100) ?? '',
      str(b.description, 'Description', 20_000) ?? '', JSON.stringify(checklist), !!b.require_attachment, v.userId]
  ));
});
