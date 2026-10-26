import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { handler, ok } from '@/lib/training/http';
import { getViewer } from '@/lib/projects/core';

export const dynamic = 'force-dynamic';

/** GET /api/projects/people — active developers and supervisors (for assigning), with open workload. */
export const GET = handler(async (request: NextRequest) => {
  await getViewer(request);
  return ok(await query(
    `SELECT u.id, u.full_name AS name, u.username, u.role,
            (SELECT COUNT(*) FROM project_members m JOIN projects p ON p.id = m.project_id
             WHERE m.user_id = u.id AND p.status NOT IN ('delivered', 'closed', 'cancelled'))::int AS open_projects
     FROM users u
     WHERE u.role IN ('developer', 'hr') AND COALESCE(u.is_active, true)
     ORDER BY u.role DESC, u.full_name`
  ));
});
