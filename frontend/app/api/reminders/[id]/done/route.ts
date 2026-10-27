import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { handler, ok } from '@/lib/training/http';
import { getViewer } from '@/lib/projects/core';
import { loadReminder } from '@/lib/reminders/core';

export const dynamic = 'force-dynamic';

/**
 * POST /api/reminders/{id}/done — finished. A repeating reminder is done for good
 * (cancel stops it the same way); also marks its notifications read.
 */
export const POST = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const v = await getViewer(request);
  const r = await loadReminder(v, Number(params.id));
  await query(`UPDATE reminders SET status = 'done', done_at = NOW(), updated_at = NOW() WHERE id = $1`, [r.id]);
  await query(
    `UPDATE notifications_inbox SET read_at = COALESCE(read_at, NOW())
      WHERE user_id = $1 AND entity_type = 'reminder' AND entity_id = $2`, [v.userId, String(r.id)]
  ).catch(() => {});
  return ok({ id: r.id, status: 'done' });
});
