import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { handler, ok, readJson } from '@/lib/training/http';
import { getViewer } from '@/lib/projects/core';
import { splitIds } from '@/lib/inbox';

export const dynamic = 'force-dynamic';

/**
 * POST /api/inbox/read { ids?: ["n12", "t7"], unread?: true }
 * Mark read (or unread again). Without ids: mark everything read.
 */
export const POST = handler(async (request: NextRequest) => {
  const v = await getViewer(request);
  const b = await readJson(request).catch(() => ({}));
  const unread = b.unread === true;
  if (!Array.isArray(b.ids)) {
    await query(`UPDATE notifications_inbox SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL AND (snoozed_until IS NULL OR snoozed_until <= NOW())`, [v.userId]);
    await query(`UPDATE training_notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL`, [v.userId]);
    return ok({ all: true });
  }
  const { inbox, training } = splitIds(b.ids);
  const val = unread ? 'NULL' : 'NOW()';
  if (inbox.length) await query(`UPDATE notifications_inbox SET read_at = ${val} WHERE user_id = $1 AND id = ANY($2::bigint[])`, [v.userId, inbox]);
  if (training.length) await query(`UPDATE training_notifications SET read_at = ${val} WHERE user_id = $1 AND id = ANY($2::int[])`, [v.userId, training]);
  return ok({ updated: inbox.length + training.length });
});
