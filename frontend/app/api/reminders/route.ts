import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { getViewer } from '@/lib/projects/core';
import { assertViewerSees, insertReminder, resolveItem } from '@/lib/reminders/core';
import { isReminderEntity } from '@/lib/reminders/rules';
import { parseDue, parseNote, parseRepeat, parseTitle, resolveAssignee } from '@/lib/reminders/input';

export const dynamic = 'force-dynamic';

/** Columns for lists: the reminder + names + where it points. */
const LIST_SQL = `
  SELECT r.id, r.entity_type, r.entity_id, r.project_id, r.title, r.note, r.due_at, r.repeat_rule, r.assigned_to, r.created_by,
         r.status, r.snoozed_until, r.fired_for, r.last_fired_at, r.fire_count, r.auto_kind, r.email, r.done_at, r.created_at,
         COALESCE(r.snoozed_until, r.due_at) AS effective_due,
         (r.fired_for IS NOT NULL AND r.fired_for = COALESCE(r.snoozed_until, r.due_at)) AS fired,
         au.full_name AS assigned_to_name, cu.full_name AS created_by_name, p.ticket_no,
         CASE r.entity_type WHEN 'ticket' THEN (SELECT key FROM tickets WHERE id = r.entity_id::int) END AS ticket_key
    FROM reminders r
    LEFT JOIN users au ON au.id = r.assigned_to
    LEFT JOIN users cu ON cu.id = r.created_by
    LEFT JOIN projects p ON p.id = r.project_id`;

/**
 * GET /api/reminders?scope=mine|created &status=open|done|all &entity_type=&entity_id=
 *   mine     reminders for me (default)
 *   created  reminders I set for other people
 */
export const GET = handler(async (request: NextRequest) => {
  const v = await getViewer(request);
  const sp = new URL(request.url).searchParams;
  const args: unknown[] = [v.userId];
  const where = [sp.get('scope') === 'created' ? 'r.created_by = $1 AND r.assigned_to <> $1' : 'r.assigned_to = $1'];
  const status = sp.get('status') || 'open';
  if (status !== 'all') { args.push(status === 'done' ? ['done', 'cancelled'] : ['open']); where.push(`r.status = ANY($${args.length}::text[])`); }
  if (sp.get('entity_type')) {
    if (!isReminderEntity(sp.get('entity_type'))) throw new HttpError(400, 'Unknown item type');
    args.push(sp.get('entity_type'), String(sp.get('entity_id') || ''));
    where.push(`r.entity_type = $${args.length - 1} AND r.entity_id = $${args.length}`);
  }
  const rows = await query(`${LIST_SQL} WHERE ${where.join(' AND ')} ORDER BY COALESCE(r.snoozed_until, r.due_at) LIMIT 500`, args);
  return ok(rows);
});

/**
 * POST /api/reminders
 * { entity_type?, entity_id?, title, note?, preset?: '1h'|'tomorrow'|'monday'|'pick', until?|due_at?,
 *   repeat_rule?, assigned_to?, email? }
 */
export const POST = handler(async (request: NextRequest) => {
  const v = await getViewer(request);
  const b = await readJson(request);
  const entity = b.entity_type ?? 'none';
  if (!isReminderEntity(entity)) throw new HttpError(400, 'Unknown item type');
  const item = await resolveItem(entity, b.entity_id, v.userId);
  await assertViewerSees(v, item);
  const assignee = await resolveAssignee(request, v, entity, item, b.assigned_to);
  const due = parseDue(b);
  if (due.getTime() < Date.now() - 60_000) throw new HttpError(400, 'Pick a time in the future');

  const r = await insertReminder({
    entity_type: entity, entity_id: entity === 'none' ? null : String(Number(b.entity_id)), project_id: item.projectId,
    title: parseTitle(b.title), note: parseNote(b.note), due_at: due, repeat_rule: parseRepeat(b.repeat_rule),
    assigned_to: assignee, created_by: v.userId, email: !!b.email,
  });
  return ok(r);
});
