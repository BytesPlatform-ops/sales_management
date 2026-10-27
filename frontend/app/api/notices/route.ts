import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { handler, ok, readJson } from '@/lib/training/http';
import { getViewer } from '@/lib/projects/core';

export const dynamic = 'force-dynamic';

/** GET /api/notices — company notices you haven't acknowledged yet (e.g. chat visibility). */
export const GET = handler(async (request: NextRequest) => {
  const v = await getViewer(request);
  return ok(await query(
    `SELECT n.id, n.kind, n.title, n.body, n.published_at, n.effective_at FROM staff_notices n
      WHERE NOT EXISTS (SELECT 1 FROM staff_notice_acks a WHERE a.notice_id = n.id AND a.user_id = $1)
      ORDER BY n.published_at DESC LIMIT 10`,
    [v.userId]
  ).catch(() => []));
});

/** POST /api/notices { id } — acknowledge a notice. */
export const POST = handler(async (request: NextRequest) => {
  const v = await getViewer(request);
  const id = Number((await readJson(request)).id);
  await query(`INSERT INTO staff_notice_acks (notice_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [id, v.userId]);
  return ok({ acknowledged: id });
});
