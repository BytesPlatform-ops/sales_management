import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { verifyRequest } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

/** GET /api/auth/sessions — your sessions (newest first). */
export const GET = handler(async (request: NextRequest) => {
  const a = await verifyRequest(request);
  if (a.readonly) throw new HttpError(403, 'Not available while viewing as someone else');
  return ok(await query(
    `SELECT id, created_at, last_seen_at, expires_at, ip, user_agent, revoked_at, id = $2 AS current
       FROM user_sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [a.userId, a.sid]
  ));
});

/**
 * POST /api/auth/sessions { id } — sign out one session; { all: true } — sign out everywhere
 * (including this one).
 */
export const POST = handler(async (request: NextRequest) => {
  const a = await verifyRequest(request);
  const b = await readJson(request);
  const rows = b.all
    ? await query(`UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL RETURNING id`, [a.userId])
    : await query(`UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = $1 AND id = $2 AND revoked_at IS NULL RETURNING id`, [a.userId, String(b.id || '')]);
  return ok({ revoked: rows.length });
});
