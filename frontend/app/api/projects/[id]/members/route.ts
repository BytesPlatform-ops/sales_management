import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { getViewer, loadProject, requireSupervisor, systemMessage } from '@/lib/projects/core';
import { notify } from '@/lib/notifications';
import { syncRepoAccessSoon } from '@/lib/github/access';

export const dynamic = 'force-dynamic';

/** POST /api/projects/{id}/members { user_id, member_role? } — supervisor assigns a developer. */
export const POST = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const v = await getViewer(request);
  requireSupervisor(v);
  const p = await loadProject(Number(params.id), v);
  const b = await readJson(request);
  const user = await queryOne<{ id: string; full_name: string; role: string; is_active: boolean | null }>(
    `SELECT id, full_name, role, is_active FROM users WHERE id = $1`, [Number(b.user_id)]
  );
  if (!user || user.is_active === false) throw new HttpError(404, 'User not found');
  const role = ['developer', 'lead_developer', 'watcher'].includes(b.member_role) ? b.member_role : 'developer';
  await query(
    `INSERT INTO project_members (project_id, user_id, member_role, added_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (project_id, user_id) DO UPDATE SET member_role = EXCLUDED.member_role`,
    [p.id, Number(user.id), role, v.userId]
  );
  await systemMessage(p.id, `${v.name} assigned ${user.full_name}${role === 'lead_developer' ? ' as lead developer' : role === 'watcher' ? ' as a watcher' : ''}.`, v.userId);
  await notify({
    users: [Number(user.id)], actorId: v.userId, type: 'project_assigned',
    body: `${v.name} added you to ${p.ticket_no}: ${p.title}${role === 'lead_developer' ? ' as lead developer' : ''}`,
    link: `/projects/${p.id}`, projectId: p.id, entity: { type: 'project', id: p.id },
  });
  syncRepoAccessSoon(p.id); // repo access follows membership
  return ok({ added: Number(user.id) });
});

/** DELETE /api/projects/{id}/members?user_id= — supervisor removes someone. */
export const DELETE = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const v = await getViewer(request);
  requireSupervisor(v);
  const p = await loadProject(Number(params.id), v);
  const userId = Number(new URL(request.url).searchParams.get('user_id'));
  const rows = await query<{ full_name: string }>(
    `DELETE FROM project_members m USING users u WHERE m.project_id = $1 AND m.user_id = $2 AND u.id = m.user_id RETURNING u.full_name`,
    [p.id, userId]
  );
  if (!rows.length) throw new HttpError(404, 'Not on this project');
  await systemMessage(p.id, `${v.name} removed ${rows[0].full_name} from the project.`, v.userId);
  syncRepoAccessSoon(p.id);
  return ok({ removed: userId });
});
