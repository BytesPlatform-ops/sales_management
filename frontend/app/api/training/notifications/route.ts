import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { getAuth, handler, ok, readJson } from '@/lib/training/http';

export const dynamic = 'force-dynamic';

/** GET /api/training/notifications */
export const GET = handler(async (request: NextRequest) => {
  const auth = await getAuth(request);
  return ok(await query(
    `SELECT id, type, body, link, read_at, created_at FROM training_notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [auth.userId]
  ));
});

/** POST /api/training/notifications { ids?: [] } — mark read (all when ids omitted). */
export const POST = handler(async (request: NextRequest) => {
  const auth = await getAuth(request);
  const b = await readJson(request).catch(() => ({}));
  const ids = Array.isArray(b.ids) ? b.ids.map(Number) : null;
  await query(
    `UPDATE training_notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL ${ids ? 'AND id = ANY($2::int[])' : ''}`,
    ids ? [auth.userId, ids] : [auth.userId]
  );
  return ok({ read: true });
});
