import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { requireCeo } from '@/lib/auth/ceo';
import { notify } from '@/lib/notifications';

export const dynamic = 'force-dynamic';

/** GET /api/ceo/vault-revocations — who has had Env access cut off. */
export const GET = handler(async (request: NextRequest) => {
  await requireCeo(request);
  return ok(await query(
    `SELECT r.id, r.user_id, u.full_name AS user_name, u.role AS user_role, r.project_id, p.ticket_no, r.reason,
            r.revoked_by, b.full_name AS revoked_by_name, r.created_at
       FROM vault_access_revocations r
       LEFT JOIN users u ON u.id = r.user_id LEFT JOIN users b ON b.id = r.revoked_by LEFT JOIN projects p ON p.id = r.project_id
      ORDER BY r.created_at DESC`
  ));
});

/**
 * POST /api/ceo/vault-revocations { user_id, project_id?, reason? } — cut a person's Env access
 * at once (one project, or every project when project_id is omitted). Works without Admin mode.
 */
export const POST = handler(async (request: NextRequest) => {
  const a = await requireCeo(request);
  const b = await readJson(request);
  const userId = Number(b.user_id);
  const u = await queryOne<{ role: string }>(`SELECT role FROM users WHERE id = $1`, [userId]);
  if (!u) throw new HttpError(404, 'User not found');
  if (u.role === 'ceo') throw new HttpError(400, 'CEO access can’t be revoked here');
  const projectId = b.project_id ? Number(b.project_id) : null;
  const row = await queryOne(
    `INSERT INTO vault_access_revocations (user_id, project_id, reason, revoked_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, COALESCE(project_id, 0)) DO UPDATE SET reason = EXCLUDED.reason, revoked_by = EXCLUDED.revoked_by, created_at = NOW()
     RETURNING id`,
    [userId, projectId, b.reason ? String(b.reason).slice(0, 1000) : null, a.userId]
  );
  await notify({ users: [userId], actorId: a.userId, type: 'vault_access_revoked',
    body: projectId ? 'Your access to a project’s Env (secrets) was revoked.' : 'Your access to all project Env (secrets) was revoked.' });
  return ok(row);
});

/** DELETE /api/ceo/vault-revocations?id= — restore access (Admin mode). */
export const DELETE = handler(async (request: NextRequest) => {
  await requireCeo(request);
  const id = Number(new URL(request.url).searchParams.get('id'));
  await query(`DELETE FROM vault_access_revocations WHERE id = $1`, [id]);
  return ok({ deleted: id });
});
