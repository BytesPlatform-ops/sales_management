/**
 * Once-a-day notification jobs, run from the in-app scheduler after 09:00 PKT
 * (instrumentation.ts, behind a job lock so only one instance runs them).
 *
 *   dueTomorrow()   assignees of open tickets due tomorrow (once per ticket per day)
 *   sendDigests()   email each opted-in user their unread notifications
 */
import { query } from '@/lib/db';
import { appUrl, escapeHtml, sendEmail } from '@/lib/email';
import { notify, once } from '@/lib/notifications';

/** Today's date in Pakistan time, YYYY-MM-DD. */
export function pktDate(now = new Date(), addDays = 0): string {
  const d = new Date(now.getTime() + 5 * 3600_000 + addDays * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export function pktHour(now = new Date()): number {
  return new Date(now.getTime() + 5 * 3600_000).getUTCHours();
}

export async function dueTomorrow(now = new Date()): Promise<number> {
  const tomorrow = pktDate(now, 1);
  const rows = await query<{ id: number; key: string; title: string; project_id: number; assignees: string[] }>(
    `SELECT t.id, t.key, t.title, t.project_id, ARRAY_AGG(a.user_id::text) AS assignees
       FROM tickets t JOIN ticket_assignees a ON a.ticket_id = t.id
      WHERE t.due_date = $1 AND t.deleted_at IS NULL AND t.status NOT IN ('done','closed','declined','triage')
      GROUP BY t.id`,
    [tomorrow]
  );
  let sent = 0;
  for (const t of rows) {
    if (!(await once(`due:${t.id}:${tomorrow}`))) continue;
    await notify({
      users: t.assignees.map(Number), actorId: null, type: 'ticket_due',
      body: `${t.key} is due tomorrow: ${t.title}`, link: `/projects/${t.project_id}/tickets/${t.key}`,
      projectId: t.project_id, entity: { type: 'ticket', id: t.key },
    });
    sent++;
  }
  return sent;
}

export async function sendDigests(now = new Date()): Promise<number> {
  const users = await query<{ id: string; full_name: string; email_address: string | null }>(
    `SELECT u.id, u.full_name, u.email_address FROM notification_settings s JOIN users u ON u.id = s.user_id
      WHERE s.digest_enabled AND COALESCE(u.is_active, true) AND u.email_address IS NOT NULL
        AND (s.last_digest_at IS NULL OR s.last_digest_at < $1::timestamptz - INTERVAL '20 hours')`,
    [now]
  );
  let sent = 0;
  for (const u of users) {
    const items = await query<{ body: string; link: string | null; created_at: string }>(
      `SELECT body, link, created_at FROM notifications_inbox
        WHERE user_id = $1 AND read_at IS NULL AND (snoozed_until IS NULL OR snoozed_until <= $2)
        ORDER BY created_at DESC LIMIT 50`,
      [u.id, now]
    );
    await query(
      `UPDATE notification_settings SET last_digest_at = $2 WHERE user_id = $1`, [u.id, now]
    );
    if (!items.length) continue;
    const list = items.map((i) => `<li>${i.link ? `<a href="${escapeHtml(appUrl(i.link))}">${escapeHtml(i.body)}</a>` : escapeHtml(i.body)}</li>`).join('');
    const ok = await sendEmail({
      to: u.email_address!,
      subject: `${items.length} unread notification${items.length === 1 ? '' : 's'}`,
      text: items.map((i) => `- ${i.body}`).join('\n') + `\n\n${appUrl('/inbox')}`,
      html: `<p>Good morning ${escapeHtml(u.full_name.split(' ')[0])}, here's what's waiting for you:</p><ul>${list}</ul><p><a href="${escapeHtml(appUrl('/inbox'))}">Open your inbox</a></p>`,
    });
    if (ok) sent++;
  }
  return sent;
}

export async function runDailyNotifications(now = new Date()) {
  try {
    const due = await dueTomorrow(now);
    const digests = await sendDigests(now);
    if (due || digests) console.log(`🔔 Daily notifications: ${due} due-tomorrow, ${digests} digest email(s)`);
  } catch (err) {
    if (!/does not exist/.test(String((err as Error)?.message))) console.error('[notifications] daily', err);
  }
}
