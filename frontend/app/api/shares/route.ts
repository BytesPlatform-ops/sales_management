import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { getViewer } from '@/lib/projects/core';
import { ACTIVE_GRANT } from '@/lib/access/grants';
import { createShare, describeGrants } from '@/lib/collab/shares';

export const dynamic = 'force-dynamic';

const COLS = `g.id, g.grantee_id, gu.full_name AS grantee_name, g.resource_type, g.resource_id, g.project_id, g.level, g.scope,
  g.reason, g.granted_by, bu.full_name AS granted_by_name, g.source, g.starts_at, g.expires_at, g.revoked_at, g.created_at`;
const FROM = `FROM access_grants g LEFT JOIN users gu ON gu.id = g.grantee_id LEFT JOIN users bu ON bu.id = g.granted_by`;

/**
 * GET /api/shares?scope=with_me (default) | by_me | approvals (HR: Production shares waiting) | all (HR)
 * Active (or pending) grants only, with a label and link for each.
 */
export const GET = handler(async (request: NextRequest) => {
  const v = await getViewer(request);
  const scope = new URL(request.url).searchParams.get('scope') || 'with_me';
  const live = `g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > NOW())`;
  let rows: any[];
  if (scope === 'with_me') {
    rows = await query(`SELECT ${COLS}, ${ACTIVE_GRANT('g')} AS active ${FROM} WHERE g.grantee_id = $1 AND ${live} ORDER BY g.expires_at NULLS LAST, g.id DESC`, [v.userId]);
  } else if (scope === 'by_me') {
    rows = await query(`SELECT ${COLS}, ${ACTIVE_GRANT('g')} AS active ${FROM} WHERE g.granted_by = $1 AND ${live} ORDER BY g.id DESC`, [v.userId]);
  } else if (scope === 'approvals' || scope === 'all') {
    if (v.role !== 'hr') throw new HttpError(403, 'HR only');
    const extra = scope === 'approvals' ? `AND COALESCE((g.scope->>'pending_approval')::boolean, false)` : '';
    rows = await query(`SELECT ${COLS}, ${ACTIVE_GRANT('g')} AS active ${FROM} WHERE ${live} ${extra} ORDER BY g.id DESC LIMIT 500`);
  } else throw new HttpError(400, 'Unknown scope');
  return ok(await describeGrants(rows));
});

/**
 * POST /api/shares { resource_type: ticket|file|saved_view|vault_item, resource_id, grantee_id, level?: view|comment|edit,
 *                    expires_at?, note? }
 */
export const POST = handler(async (request: NextRequest) => {
  const v = await getViewer(request);
  return ok(await createShare(request, v, await readJson(request)));
});
