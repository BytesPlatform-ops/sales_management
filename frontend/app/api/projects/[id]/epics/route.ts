import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { canWorkTicket } from '@/lib/tickets/rules';
import { projectCtx } from '@/lib/tickets/core';
import { dateOrNull, str } from '@/lib/tickets/input';

export const dynamic = 'force-dynamic';

/** GET /api/projects/{id}/epics — with progress from their (top-level and sub) tickets. */
export const GET = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const { project } = await projectCtx(request, Number(params.id));
  return ok(await query(
    `SELECT e.id, e.title, e.description, e.color, e.owner_id, u.full_name AS owner_name, e.target_date::text AS target_date,
            e.status, e.sort_order,
            COUNT(t.id) FILTER (WHERE t.status NOT IN ('triage','declined'))::int AS total,
            COUNT(t.id) FILTER (WHERE t.status IN ('done','closed'))::int AS done
       FROM epics e
       LEFT JOIN users u ON u.id = e.owner_id
       LEFT JOIN tickets t ON t.epic_id = e.id AND t.deleted_at IS NULL
      WHERE e.project_id = $1 AND e.status <> 'archived'
      GROUP BY e.id, u.full_name ORDER BY e.sort_order, e.id`,
    [project.id]
  ));
});

/** POST /api/projects/{id}/epics { title, description?, color?, owner_id?, target_date? } — developers and HR. */
export const POST = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const { project, actor, viewer } = await projectCtx(request, Number(params.id));
  if (!canWorkTicket(actor)) throw new HttpError(403, 'Only the project’s developers or HR can add epics');
  const b = await readJson(request);
  const color = /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : '#6366f1';
  return ok(await queryOne(
    `INSERT INTO epics (project_id, title, description, color, owner_id, target_date, sort_order, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE((SELECT MAX(sort_order) + 1 FROM epics WHERE project_id = $1), 0), $7)
     RETURNING id, title, description, color, owner_id, target_date::text AS target_date, status, sort_order`,
    [project.id, str(b.title, 'Title', 200, true), str(b.description, 'Description', 5000) ?? '', color,
      b.owner_id ? Number(b.owner_id) : null, dateOrNull(b.target_date, 'Target date') ?? null, viewer.userId]
  ));
});
