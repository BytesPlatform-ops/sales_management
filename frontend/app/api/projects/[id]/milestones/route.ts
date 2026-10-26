import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { getViewer, loadProject, systemMessage, fmtDay, Viewer, normalizeDates } from '@/lib/projects/core';

export const dynamic = 'force-dynamic';

function requireMilestoneAccess(v: Viewer) {
  if (v.role === 'agent') throw new HttpError(403, 'Only the team working on the project can change milestones');
}

/** POST /api/projects/{id}/milestones { title, description?, start_date?, due_date, assignee_id? } */
export const POST = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const v = await getViewer(request);
  requireMilestoneAccess(v);
  const p = await loadProject(Number(params.id), v);
  const b = await readJson(request);
  if (!String(b.title || '').trim()) throw new HttpError(400, 'Milestone title is required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.due_date || '')) throw new HttpError(400, 'Pick a due date');
  if (b.start_date && b.start_date > b.due_date) throw new HttpError(400, 'Start date is after the due date');
  const cycle = p.project_type === 'recurring'
    ? await queryOne<{ id: number }>(`SELECT id FROM project_cycles WHERE project_id = $1 AND status = 'open' ORDER BY cycle_no DESC LIMIT 1`, [p.id])
    : null;
  const row = await queryOne<any>(
    `INSERT INTO project_milestones (project_id, cycle_id, title, description, start_date, due_date, assignee_id, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM project_milestones WHERE project_id = $1))
     RETURNING *`,
    [p.id, cycle?.id ?? null, String(b.title).trim().slice(0, 200), b.description || null, b.start_date || null, b.due_date, b.assignee_id || null]
  );
  await systemMessage(p.id, `${v.name} added milestone “${row.title}” due ${fmtDay(b.due_date)}.`, v.userId);
  return ok(normalizeDates(row, ['start_date', 'due_date']));
});

/** PATCH /api/projects/{id}/milestones { id, title?, description?, start_date?, due_date?, status?, assignee_id? } */
export const PATCH = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const v = await getViewer(request);
  requireMilestoneAccess(v);
  const p = await loadProject(Number(params.id), v);
  const b = await readJson(request);
  const ms = await queryOne<any>(`SELECT * FROM project_milestones WHERE id = $1 AND project_id = $2`, [Number(b.id), p.id]);
  if (!ms) throw new HttpError(404, 'Milestone not found');
  const fields = ['title', 'description', 'start_date', 'due_date', 'status', 'assignee_id'].filter((k) => k in b);
  if (!fields.length) throw new HttpError(400, 'Nothing to update');
  if ('status' in b && !['pending', 'in_progress', 'done'].includes(b.status)) throw new HttpError(400, 'Unknown milestone status');
  const vals = fields.map((k) => (b[k] === '' ? null : b[k]));
  vals.push(ms.id);
  const row = await queryOne<any>(
    // SET sees the old row, so completed_at follows the status being written (if any).
    `UPDATE project_milestones SET ${fields.map((k, i) => `${k} = $${i + 1}`).join(', ')}${'status' in b
       ? `, completed_at = CASE WHEN $${fields.indexOf('status') + 1}::varchar = 'done' THEN COALESCE(completed_at, NOW()) ELSE NULL END`
       : ''}
     WHERE id = $${vals.length} RETURNING *`,
    vals
  );
  if ('status' in b && b.status !== ms.status) {
    await systemMessage(p.id, `${v.name} marked “${ms.title}” as ${b.status === 'done' ? 'done ✓' : b.status.replace('_', ' ')}.`, v.userId);
  } else if ('due_date' in b && String(b.due_date) !== String(ms.due_date).slice(0, 10)) {
    await systemMessage(p.id, `${v.name} moved “${ms.title}” to ${fmtDay(b.due_date)}.`, v.userId);
  }
  return ok(normalizeDates(row, ['start_date', 'due_date']));
});

/** DELETE /api/projects/{id}/milestones?milestone_id= */
export const DELETE = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const v = await getViewer(request);
  requireMilestoneAccess(v);
  const p = await loadProject(Number(params.id), v);
  const id = Number(new URL(request.url).searchParams.get('milestone_id'));
  const rows = await query<{ title: string }>(`DELETE FROM project_milestones WHERE id = $1 AND project_id = $2 RETURNING title`, [id, p.id]);
  if (!rows.length) throw new HttpError(404, 'Milestone not found');
  await systemMessage(p.id, `${v.name} removed milestone “${rows[0].title}”.`, v.userId);
  return ok({ deleted: id });
});
