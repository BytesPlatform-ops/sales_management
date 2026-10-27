import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { getViewer } from '@/lib/projects/core';
import { isSelf, loadReminder, REMINDER_COLS, resolveItem } from '@/lib/reminders/core';
import { pktDayOfMonth } from '@/lib/reminders/rules';
import { parseDue, parseNote, parseRepeat, parseTitle, resolveAssignee } from '@/lib/reminders/input';

export const dynamic = 'force-dynamic';
type Ctx = { params: { id: string } };

/** GET /api/reminders/{id} — the assignee or the person who set it. */
export const GET = handler(async (request: NextRequest, { params }: Ctx) => {
  const v = await getViewer(request);
  const r = await loadReminder(v, Number(params.id));
  let link = '/my-tasks#reminders';
  try { link = (await resolveItem(r.entity_type, r.entity_id, v.userId)).link; } catch { /* item gone */ }
  return ok({ ...r, link });
});

/**
 * PATCH /api/reminders/{id} { title?, note?, preset?/until?/due_at?, repeat_rule?, assigned_to?, email? }
 * The person who set it may change anything; the assignee may edit a reminder they set
 * themselves. Automatic reminders can only be done, snoozed or cancelled.
 */
export const PATCH = handler(async (request: NextRequest, { params }: Ctx) => {
  const v = await getViewer(request);
  const r = await loadReminder(v, Number(params.id));
  if (r.auto_kind) throw new HttpError(400, 'Automatic reminders can only be marked done, snoozed or cancelled');
  if (!isSelf(v, r.created_by ?? 0)) throw new HttpError(403, 'Only the person who set this reminder can change it');
  const b = await readJson(request);
  const set: Record<string, unknown> = {};
  if (b.title !== undefined) set.title = parseTitle(b.title);
  if (b.note !== undefined) set.note = parseNote(b.note);
  if (b.repeat_rule !== undefined) set.repeat_rule = parseRepeat(b.repeat_rule);
  if (b.email !== undefined) set.email = !!b.email;
  if (b.preset !== undefined || b.until !== undefined || b.due_at !== undefined) {
    const due = parseDue(b);
    set.due_at = due;
    // A new time is a new occurrence: it can fire again.
    set.snoozed_until = null;
    set.fired_for = null;
  }
  if (b.assigned_to !== undefined) {
    const item = await resolveItem(r.entity_type, r.entity_id, v.userId);
    set.assigned_to = await resolveAssignee(request, v, r.entity_type, item, b.assigned_to);
  }
  if ((set.repeat_rule ?? r.repeat_rule) === 'monthly') set.repeat_day = pktDayOfMonth(new Date((set.due_at as Date) ?? r.due_at));
  const keys = Object.keys(set);
  if (!keys.length) return ok(r);
  return ok(await queryOne(
    `UPDATE reminders SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING ${REMINDER_COLS.replace(/r\./g, '')}`,
    [r.id, ...keys.map((k) => set[k])]
  ));
});

/** DELETE /api/reminders/{id} — cancel (the person who set it, or the assignee). */
export const DELETE = handler(async (request: NextRequest, { params }: Ctx) => {
  const v = await getViewer(request);
  const r = await loadReminder(v, Number(params.id));
  await query(`UPDATE reminders SET status = 'cancelled', updated_at = NOW() WHERE id = $1`, [r.id]);
  return ok({ id: r.id, status: 'cancelled' });
});
