/**
 * Delivers due reminders. Run every minute by the in-app scheduler under a job
 * lock, but correct even without it: each due row is claimed with one UPDATE
 * (FOR UPDATE SKIP LOCKED + "not yet fired for this moment"), so two runners can
 * never send the same occurrence twice.
 */
import { query, queryOne } from '@/lib/db';
import { emailConfigured, sendEmail, appUrl, escapeHtml } from '@/lib/email';
import { notify } from '@/lib/notifications';
import { nextOccurrenceAfter, RepeatRule } from './rules';
import { REMINDER_COLS, ReminderRow, resolveItem } from './core';

/** Claim every open reminder whose moment has come and that hasn't fired for that moment. */
export async function claimDue(limit = 200): Promise<ReminderRow[]> {
  return query<ReminderRow>(
    `UPDATE reminders r
        SET fired_for = COALESCE(r.snoozed_until, r.due_at), last_fired_at = NOW(),
            sent_at = COALESCE(r.sent_at, NOW()), fire_count = r.fire_count + 1, updated_at = NOW()
      WHERE r.id IN (
              SELECT id FROM reminders
               WHERE status = 'open' AND COALESCE(snoozed_until, due_at) <= NOW()
                 AND fired_for IS DISTINCT FROM COALESCE(snoozed_until, due_at)
               ORDER BY COALESCE(snoozed_until, due_at)
               LIMIT $1
               FOR UPDATE SKIP LOCKED)
        AND r.status = 'open'
        AND r.fired_for IS DISTINCT FROM COALESCE(r.snoozed_until, r.due_at)
      RETURNING ${REMINDER_COLS}`,
    [limit]
  );
}

async function deliver(r: ReminderRow) {
  let link = '/my-tasks#reminders';
  try {
    link = (await resolveItem(r.entity_type, r.entity_id, Number(r.assigned_to))).link;
  } catch {
    // The item was deleted; still deliver, linking to the reminders list.
  }
  const body = r.note ? `${r.title} — ${r.note}` : r.title;
  await notify({
    users: [Number(r.assigned_to)], actorId: null, type: 'reminder', title: `Reminder: ${r.title}`,
    body: body.slice(0, 500), link, entity: { type: 'reminder', id: r.id }, projectId: r.project_id,
  });
  if (r.email && emailConfigured()) {
    // notify() already emails people whose preference for reminders is "email".
    const pref = await queryOne<{ channel: string }>(
      `SELECT channel FROM notification_prefs WHERE user_id = $1 AND type = 'reminder'`, [r.assigned_to]);
    if (pref?.channel !== 'email' && pref?.channel !== 'off') {
      const u = await queryOne<{ email_address: string | null }>(`SELECT email_address FROM users WHERE id = $1`, [r.assigned_to]);
      if (u?.email_address) {
        await sendEmail({
          to: u.email_address, subject: `Reminder: ${r.title}`,
          text: `${body}\n\n${appUrl(link)}`,
          html: `<p>${escapeHtml(body)}</p><p><a href="${escapeHtml(appUrl(link))}">Open</a></p>`,
        });
      }
    }
  }
}

/**
 * After a repeating reminder fires, move it to its next occurrence (and clear any
 * snooze) so it fires again then. One-off reminders stay open until marked Done.
 */
async function scheduleNext(r: ReminderRow, now: Date) {
  if (r.repeat_rule === 'none') return;
  if (new Date(r.due_at).getTime() > now.getTime()) {
    // A snoozed occurrence fired before the regular one: keep the regular one.
    await query(`UPDATE reminders SET snoozed_until = NULL, updated_at = NOW() WHERE id = $1 AND status = 'open'`, [r.id]);
    return;
  }
  const next = nextOccurrenceAfter(new Date(r.due_at), r.repeat_rule as RepeatRule, now, r.repeat_day);
  if (next) await query(`UPDATE reminders SET due_at = $2, snoozed_until = NULL, updated_at = NOW() WHERE id = $1 AND status = 'open'`, [r.id, next]);
}

/** Fire everything due. Returns how many reminders fired. */
export async function runReminders(now = new Date()): Promise<number> {
  let total = 0;
  for (let round = 0; round < 10; round++) {
    const due = await claimDue();
    for (const r of due) {
      try {
        await deliver(r);
        await scheduleNext(r, now);
      } catch (err) {
        console.error('[reminders] deliver', r.id, (err as Error)?.message);
      }
    }
    total += due.length;
    if (due.length < 200) break;
  }
  return total;
}
