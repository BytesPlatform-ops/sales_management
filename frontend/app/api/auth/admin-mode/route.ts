import { NextRequest } from 'next/server';
import { queryOne } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { sessionExpiry, signToken, verifyRequest } from '@/lib/auth/session';
import bcrypt from 'bcryptjs';

export const dynamic = 'force-dynamic';

const ADMIN_MODE_MINUTES = 30;

async function ceo(request: NextRequest) {
  const a = await verifyRequest(request);
  if (a.role !== 'ceo' || a.readonly || !a.sid) throw new HttpError(403, 'Only a CEO can use Admin mode');
  const exp = await sessionExpiry(a.sid);
  if (!exp) throw new HttpError(401, 'Session ended — sign in again');
  return { a, exp };
}

/** POST /api/auth/admin-mode { password } — a token that may make changes for 30 minutes. */
export const POST = handler(async (request: NextRequest) => {
  const { a, exp } = await ceo(request);
  const b = await readJson(request);
  const u = await queryOne<{ password: string }>(`SELECT password FROM users WHERE id = $1`, [a.userId]);
  if (!u || !(await bcrypt.compare(String(b.password || ''), u.password))) throw new HttpError(401, 'Wrong password');
  const until = Math.floor(Math.min(Date.now() + ADMIN_MODE_MINUTES * 60_000, exp.getTime()) / 1000);
  const token = await signToken({ userId: a.userId, username: a.username, role: 'ceo', sid: a.sid!, admin_until: until }, exp);
  return ok({ token, admin_until: until });
});

/** DELETE /api/auth/admin-mode — back to read-only. */
export const DELETE = handler(async (request: NextRequest) => {
  const { a, exp } = await ceo(request);
  const token = await signToken({ userId: a.userId, username: a.username, role: 'ceo', sid: a.sid! }, exp);
  return ok({ token, admin_until: null });
});
