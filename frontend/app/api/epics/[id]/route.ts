import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { getViewer, loadProject } from '@/lib/projects/core';
import { canWorkTicket } from '@/lib/tickets/rules';
import { actorFor } from '@/lib/tickets/core';
import { dateOrNull, str } from '@/lib/tickets/input';

export const dynamic = 'force-dynamic';
type Ctx = { params: { id: string } };

async function load(request: NextRequest, id: number) {
  const viewer = await getViewer(request);
  const e = await queryOne<{ id: number; project_id: number }>(`SELECT id, project_id FROM epics WHERE id = $1`, [id]);
  if (!e) throw new HttpError(404, 'Epic not found');
  const project = await loadProject(e.project_id, viewer);
  if (!canWorkTicket(await actorFor(viewer, project))) throw new HttpError(403, 'Only the project’s developers or HR can change epics');
  return e;
}

/** PATCH /api/epics/{id} { title?, description?, color?, owner_id?, target_date?, status? } */
export const PATCH = handler(async (request: NextRequest, { params }: Ctx) => {
  const e = await load(request, Number(params.id));
  const b = await readJson(request);
  const set: Record<string, unknown> = {};
  if (b.title !== undefined) set.title = str(b.title, 'Title', 200, true);
  if (b.description !== undefined) set.description = str(b.description, 'Description', 5000) ?? '';
  if (b.color !== undefined && /^#[0-9a-f]{6}$/i.test(b.color)) set.color = b.color;
  if (b.owner_id !== undefined) set.owner_id = b.owner_id ? Number(b.owner_id) : null;
  if (b.target_date !== undefined) set.target_date = dateOrNull(b.target_date, 'Target date');
  if (b.status !== undefined) {
    if (!['open', 'done', 'archived'].includes(b.status)) throw new HttpError(400, 'Unknown status');
    set.status = b.status;
  }
  const keys = Object.keys(set);
  if (!keys.length) return ok({ id: e.id });
  return ok(await queryOne(
    `UPDATE epics SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = NOW() WHERE id = $1
     RETURNING id, title, description, color, owner_id, target_date::text AS target_date, status`,
    [e.id, ...keys.map((k) => set[k])]
  ));
});

/** DELETE /api/epics/{id} — tickets stay, just without an epic. */
export const DELETE = handler(async (request: NextRequest, { params }: Ctx) => {
  const e = await load(request, Number(params.id));
  await query(`DELETE FROM epics WHERE id = $1`, [e.id]);
  return ok({ deleted: e.id });
});
