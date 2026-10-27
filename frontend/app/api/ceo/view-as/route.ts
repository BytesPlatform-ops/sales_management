import { NextRequest } from 'next/server';
import { queryOne } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { logCeoAccess, requireCeo } from '@/lib/auth/ceo';
import { sessionExpiry, signToken } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

/**
 * POST /api/ceo/view-as { user_id } — a read-only token for that user (1 hour, or less if
 * the CEO's session ends sooner). Every write with it is refused; it's logged.
 */
export const POST = handler(async (request: NextRequest) => {
  const a = await requireCeo(request);
  const id = Number((await readJson(request)).user_id);
  const u = await queryOne<{ id: string; username: string; full_name: string; role: string; is_active: boolean | null }>(
    `SELECT id, username, full_name, role, is_active FROM users WHERE id = $1`, [id]
  );
  if (!u || u.is_active === false) throw new HttpError(404, 'User not found');
  if (u.role === 'ceo') throw new HttpError(400, 'You can’t view as another CEO');
  const sessionEnd = a.sid ? await sessionExpiry(a.sid) : null;
  const exp = new Date(Math.min(Date.now() + 3600_000, sessionEnd?.getTime() ?? 0));
  if (exp.getTime() <= Date.now()) throw new HttpError(401, 'Session ended — sign in again');
  const token = await signToken(
    { userId: Number(u.id), username: u.username, role: u.role as any, readonly: true, view_as_by: a.userId, view_as_sid: a.sid! }, exp
  );
  await logCeoAccess(a.userId, 'view_as', `${u.full_name} (#${u.id}, ${u.role})`, null, request);
  return ok({ token, user: { id: Number(u.id), full_name: u.full_name, role: u.role }, expires_at: exp });
});
