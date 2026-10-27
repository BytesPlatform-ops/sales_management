import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { getViewer, loadProject } from '@/lib/projects/core';
import { effectiveTriageOwner } from '@/lib/tickets/core';

export const dynamic = 'force-dynamic';

/** GET /api/projects/{id}/collab-settings — weekly triage rotation on/off and who triages this week. */
export const GET = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const v = await getViewer(request);
  const p = await loadProject(Number(params.id), v) as any;
  const owner = await effectiveTriageOwner(p);
  const name = owner ? (await queryOne<{ full_name: string }>(`SELECT full_name FROM users WHERE id = $1`, [owner]))?.full_name ?? null : null;
  return ok({ triage_rotation: !!p.triage_rotation, triage_owner_id: owner, triage_owner_name: name });
});

/** PUT /api/projects/{id}/collab-settings { triage_rotation } — HR or the lead developer. */
export const PUT = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const v = await getViewer(request);
  const p = await loadProject(Number(params.id), v);
  const lead = await queryOne(`SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2 AND member_role = 'lead_developer'`, [p.id, v.userId]);
  if (v.role !== 'hr' && !lead) throw new HttpError(403, 'Only HR or the lead developer can change this');
  const b = await readJson(request);
  await query(`UPDATE projects SET triage_rotation = $2, updated_at = NOW() WHERE id = $1`, [p.id, !!b.triage_rotation]);
  return ok({ triage_rotation: !!b.triage_rotation });
});
