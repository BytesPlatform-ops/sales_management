import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { getViewer } from '@/lib/projects/core';
import { isSelf, loadReminder } from '@/lib/reminders/core';
import { resolveWhen } from '@/lib/reminders/rules';

export const dynamic = 'force-dynamic';

/**
 * POST /api/reminders/{id}/snooze { preset: '1h' | 'tomorrow' | 'monday' | 'pick', until? }
 * The assignee pushes it to a later time; it fires once more, at that time.
 */
export const POST = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const v = await getViewer(request);
  const r = await loadReminder(v, Number(params.id));
  if (!isSelf(v, r.assigned_to)) throw new HttpError(403, 'Only the person the reminder is for can snooze it');
  if (r.status !== 'open') throw new HttpError(400, 'This reminder is already closed');
  const b = await readJson(request);
  let until: Date;
  try { until = resolveWhen(b.preset ?? 'pick', b.until); } catch (e) { throw new HttpError(400, (e as Error).message); }
  if (until.getTime() <= Date.now()) throw new HttpError(400, 'Pick a time in the future');
  if (until.getTime() > Date.now() + 365 * 86_400_000) throw new HttpError(400, 'Snooze for at most a year');
  const row = await queryOne(
    `UPDATE reminders SET snoozed_until = $2, updated_at = NOW() WHERE id = $1 RETURNING id, snoozed_until`, [r.id, until]
  );
  // The notification is handled: hide it until the reminder fires again.
  await query(
    `UPDATE notifications_inbox SET read_at = COALESCE(read_at, NOW())
      WHERE user_id = $1 AND entity_type = 'reminder' AND entity_id = $2`, [v.userId, String(r.id)]
  ).catch(() => {});
  return ok(row);
});
