import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { getViewer, loadProject, requireSupervisor } from '@/lib/projects/core';

export const dynamic = 'force-dynamic';

/** PATCH /api/projects/{id}/tracking { tracking_source?: 'github'|'manual', production_env_name? } — HR. */
export const PATCH = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const v = await getViewer(request);
  requireSupervisor(v);
  const p = await loadProject(Number(params.id), v);
  const b = await readJson(request);
  const src = b.tracking_source;
  if (src !== undefined && src !== 'github' && src !== 'manual') throw new HttpError(400, 'Tracking source is github or manual');
  const env = b.production_env_name !== undefined ? String(b.production_env_name).trim().slice(0, 60) : undefined;
  if (env !== undefined && !env) throw new HttpError(400, 'Name the production environment');
  await query(
    `UPDATE projects SET tracking_source = COALESCE($2, tracking_source), production_env_name = COALESCE($3, production_env_name), updated_at = NOW() WHERE id = $1`,
    [p.id, src ?? null, env ?? null]
  );
  return ok({ tracking_source: src, production_env_name: env });
});
