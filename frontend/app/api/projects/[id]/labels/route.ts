import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { canWorkTicket } from '@/lib/tickets/rules';
import { projectCtx } from '@/lib/tickets/core';
import { str } from '@/lib/tickets/input';

export const dynamic = 'force-dynamic';

/** GET /api/projects/{id}/labels — this project's labels plus company-wide ones. */
export const GET = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const { project } = await projectCtx(request, Number(params.id));
  return ok(await query(
    `SELECT id, name, color, project_id IS NULL AS global FROM labels WHERE project_id IS NULL OR project_id = $1 ORDER BY LOWER(name)`,
    [project.id]
  ));
});

/** POST /api/projects/{id}/labels { name, color?, global? } — developers and HR; company-wide labels are HR only. */
export const POST = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const { project, actor } = await projectCtx(request, Number(params.id));
  if (!canWorkTicket(actor)) throw new HttpError(403, 'Only the project’s developers or HR can add labels');
  const b = await readJson(request);
  const global = !!b.global;
  if (global && actor.role !== 'hr') throw new HttpError(403, 'Only HR can add company-wide labels');
  const name = str(b.name, 'Name', 50, true)!;
  const color = /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : '#64748b';
  const existing = await queryOne(
    `SELECT id, name, color FROM labels WHERE COALESCE(project_id, 0) = $1 AND LOWER(name) = LOWER($2)`, [global ? 0 : project.id, name]
  );
  if (existing) return ok(existing);
  return ok(await queryOne(
    `INSERT INTO labels (project_id, name, color) VALUES ($1, $2, $3) RETURNING id, name, color`, [global ? null : project.id, name, color]
  ));
});
