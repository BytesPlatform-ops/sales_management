import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { getViewer } from '@/lib/projects/core';

export const dynamic = 'force-dynamic';

/** POST /api/inbox/snooze { id: "n12", until: ISO } — hide until then; it comes back unread. */
export const POST = handler(async (request: NextRequest) => {
  const v = await getViewer(request);
  const b = await readJson(request);
  const m = /^n(\d+)$/.exec(String(b.id || ''));
  if (!m) throw new HttpError(400, 'Only inbox notifications can be snoozed');
  const until = new Date(String(b.until || ''));
  if (Number.isNaN(until.getTime()) || until.getTime() <= Date.now()) throw new HttpError(400, 'Pick a time in the future');
  if (until.getTime() > Date.now() + 90 * 86_400_000) throw new HttpError(400, 'Snooze for at most 90 days');
  const rows = await query(
    `UPDATE notifications_inbox SET snoozed_until = $3, read_at = NULL WHERE id = $2 AND user_id = $1 RETURNING id`,
    [v.userId, Number(m[1]), until]
  );
  if (!rows.length) throw new HttpError(404, 'Notification not found');
  return ok({ id: b.id, snoozed_until: until.toISOString() });
});
