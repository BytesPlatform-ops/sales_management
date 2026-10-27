import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { getViewer, loadProject, Viewer } from '@/lib/projects/core';
import { canEditView, canSeeView, MAX_CONFIG_BYTES, sanitizeViewConfig, viewHref } from '@/lib/saved-views';
import { str } from '@/lib/tickets/input';
import { activeGrant, isGuest } from '@/lib/access/grants';

export const dynamic = 'force-dynamic';
type Ctx = { params: { id: string } };

interface Row { id: number; owner_id: string; scope: 'personal' | 'shared'; project_id: number | null; name: string; view_type: string; config: unknown; pinned: boolean }

async function load(v: Viewer, id: number): Promise<Row> {
  const row = await queryOne<Row>(`SELECT id, owner_id, scope, project_id, name, view_type, config, pinned FROM saved_views WHERE id = $1`, [id]);
  if (!row) throw new HttpError(404, 'View not found');
  let canSeeProject = row.project_id == null;
  if (row.project_id != null) canSeeProject = await loadProject(row.project_id, v).then(() => true, () => false);
  // Shared with this user directly (scoped grant): view, or edit at 'edit' level.
  const grant = await activeGrant(v.userId, 'saved_view', row.id);
  // Team-wide (no project) shared views are for staff developers, not guests.
  const guestBlocked = row.project_id == null && Number(row.owner_id) !== v.userId && await isGuest(v.userId);
  if ((!canSeeView(v, row, canSeeProject) || guestBlocked) && !grant) throw new HttpError(404, 'View not found');
  (row as any).grant_level = grant?.level ?? null;
  return row;
}

/** GET /api/saved-views/{id} */
export const GET = handler(async (request: NextRequest, { params }: Ctx) => {
  const v = await getViewer(request);
  const row = await load(v, Number(params.id));
  return ok({ ...row, owner_id: Number(row.owner_id), href: viewHref(row), mine: Number(row.owner_id) === v.userId, can_edit: canEditView(v, row) });
});

/** PATCH /api/saved-views/{id} { name?, config?, scope?, pinned? } — owner or HR. */
export const PATCH = handler(async (request: NextRequest, { params }: Ctx) => {
  const v = await getViewer(request);
  const row = await load(v, Number(params.id));
  if (!canEditView(v, row) && (row as any).grant_level !== 'edit') throw new HttpError(403, 'Only the owner or HR can change this view');
  const b = await readJson(request);
  const set: Record<string, unknown> = {};
  if (b.name !== undefined) set.name = str(b.name, 'Name', 100, true);
  if (b.scope !== undefined) set.scope = b.scope === 'shared' ? 'shared' : 'personal';
  if (b.pinned !== undefined) set.pinned = !!b.pinned;
  if (b.config !== undefined) {
    const config = JSON.stringify(sanitizeViewConfig(b.config));
    if (config.length > MAX_CONFIG_BYTES) throw new HttpError(400, 'View settings are too large');
    set.config = config;
  }
  const keys = Object.keys(set);
  if (keys.length) {
    await query(
      `UPDATE saved_views SET ${keys.map((k, i) => `${k} = $${i + 2}${k === 'config' ? '::jsonb' : ''}`).join(', ')}, updated_at = NOW() WHERE id = $1`,
      [row.id, ...keys.map((k) => set[k])]
    );
  }
  return ok({ id: row.id });
});

/** DELETE /api/saved-views/{id} — owner or HR. */
export const DELETE = handler(async (request: NextRequest, { params }: Ctx) => {
  const v = await getViewer(request);
  const row = await load(v, Number(params.id));
  if (!canEditView(v, row)) throw new HttpError(403, 'Only the owner or HR can delete this view');
  await query(`DELETE FROM saved_views WHERE id = $1`, [row.id]);
  return ok({ deleted: row.id });
});
