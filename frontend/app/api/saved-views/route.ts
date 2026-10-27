import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { getViewer, loadProject, visibilityClause } from '@/lib/projects/core';
import { isViewType, MAX_CONFIG_BYTES, sanitizeViewConfig, viewHref, viewVisibilitySql } from '@/lib/saved-views';
import { str } from '@/lib/tickets/input';

export const dynamic = 'force-dynamic';

const VIEW_COLS = `sv.id, sv.owner_id, u.full_name AS owner_name, sv.scope, sv.project_id, p2.ticket_no AS project_ticket_no,
  sv.name, sv.view_type, sv.config, sv.pinned, sv.created_at, sv.updated_at`;

/**
 * GET /api/saved-views?project_id=&view_type=&pinned=1
 * Views the viewer may see: their own plus shared ones for projects they can open.
 */
export const GET = handler(async (request: NextRequest) => {
  const v = await getViewer(request);
  const sp = new URL(request.url).searchParams;
  const where = [viewVisibilitySql(visibilityClause(v, 'p'))];
  const args: unknown[] = [v.userId, v.role];
  if (sp.get('project_id')) { args.push(Number(sp.get('project_id'))); where.push(`sv.project_id = $${args.length}`); }
  if (isViewType(sp.get('view_type'))) { args.push(sp.get('view_type')); where.push(`sv.view_type = $${args.length}`); }
  if (sp.get('pinned') === '1') where.push('sv.pinned');
  const rows = await query<any>(
    `SELECT ${VIEW_COLS} FROM saved_views sv LEFT JOIN users u ON u.id = sv.owner_id LEFT JOIN projects p2 ON p2.id = sv.project_id
      WHERE ${where.join(' AND ')} ORDER BY sv.scope DESC, LOWER(sv.name) LIMIT 200`,
    args
  );
  return ok(rows.map((r) => ({ ...r, owner_id: Number(r.owner_id), href: viewHref(r), mine: Number(r.owner_id) === v.userId })));
});

/** POST /api/saved-views { name, view_type, config, scope?, project_id?, pinned? } */
export const POST = handler(async (request: NextRequest) => {
  const v = await getViewer(request);
  const b = await readJson(request);
  if (!isViewType(b.view_type)) throw new HttpError(400, 'Unknown view type');
  const projectId = b.project_id ? Number(b.project_id) : null;
  if (projectId) await loadProject(projectId, v); // must be able to see the project
  if (!projectId && b.view_type !== 'my_work') throw new HttpError(400, 'Project views need a project');
  const config = sanitizeViewConfig(b.config);
  if (JSON.stringify(config).length > MAX_CONFIG_BYTES) throw new HttpError(400, 'View settings are too large');
  const row = await queryOne<{ id: number }>(
    `INSERT INTO saved_views (owner_id, scope, project_id, name, view_type, config, pinned)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7) RETURNING id`,
    [v.userId, b.scope === 'shared' ? 'shared' : 'personal', projectId, str(b.name, 'Name', 100, true), b.view_type, JSON.stringify(config), !!b.pinned]
  );
  return ok({ id: row!.id, href: viewHref({ id: row!.id, project_id: projectId, view_type: b.view_type }) });
});
