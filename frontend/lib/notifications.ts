/**
 * In-app notifications (+ optional email) for everything outside the training module.
 * Use notify() from here for every new notification type.
 *
 *  - never notifies the person who did the action
 *  - honours each user's preference per type: in_app (default), email (in-app + email), off
 *  - drops an identical unread notification sent to the same person within the last minute
 *
 * Old training notifications stay in training_notifications; /api/inbox shows both.
 */
import { query } from '@/lib/db';
import { appUrl, escapeHtml, sendEmail } from '@/lib/email';

export type Channel = 'in_app' | 'email' | 'off';

/** Types people can configure, grouped for the preferences screen. */
export const NOTIFICATION_TYPES: { type: string; label: string; group: string }[] = [
  { type: 'ticket_assigned', label: 'Assigned to a ticket', group: 'Tickets' },
  { type: 'mention', label: '@mentioned', group: 'Tickets' },
  { type: 'ticket_comment', label: 'Comment on a ticket you watch', group: 'Tickets' },
  { type: 'ticket_status', label: 'Status change on a ticket you watch', group: 'Tickets' },
  { type: 'ticket_done', label: 'Your ticket is done', group: 'Tickets' },
  { type: 'ticket_due', label: 'Ticket due tomorrow', group: 'Tickets' },
  { type: 'ticket_unblocked', label: 'A blocker is done', group: 'Tickets' },
  { type: 'ticket_triage', label: 'New ticket to triage', group: 'Triage' },
  { type: 'triage_need_info', label: 'More info needed on your ticket', group: 'Triage' },
  { type: 'triage_info', label: 'Answer to your question', group: 'Triage' },
  { type: 'triage_accepted', label: 'Your ticket was accepted', group: 'Triage' },
  { type: 'triage_declined', label: 'Your ticket was declined', group: 'Triage' },
  { type: 'triage_merged', label: 'Your ticket was merged', group: 'Triage' },
  { type: 'cr_pending', label: 'Change request waiting for approval', group: 'Change requests' },
  { type: 'cr_approved', label: 'Change request approved', group: 'Change requests' },
  { type: 'cr_rejected', label: 'Change request rejected', group: 'Change requests' },
  { type: 'project_assigned', label: 'Added to a project', group: 'Projects' },
  { type: 'project_status', label: 'Your client’s project changed status', group: 'Projects' },
  { type: 'project_red', label: 'A project turned red', group: 'Projects' },
  { type: 'ready_to_deliver', label: 'Deployed to production — ready to deliver', group: 'Projects' },
  { type: 'work_update_reminder', label: 'Daily work-update reminder (manual projects)', group: 'Projects' },
  { type: 'brief_update', label: 'New brief update on your project', group: 'Brief' },
  { type: 'brief_clarification', label: 'A developer needs clarification', group: 'Brief' },
  { type: 'brief_clarified', label: 'Your question was answered', group: 'Brief' },
  { type: 'thread_mention', label: '@mentioned in a project thread', group: 'Projects' },
  { type: 'reminder', label: 'Reminders (yours and automatic)', group: 'Reminders' },
  { type: 'security_new_device', label: 'Sign-in from a new device', group: 'Security' },
  { type: 'vault_break_glass', label: 'A CEO revealed a secret on your project', group: 'Security' },
  { type: 'vault_access_revoked', label: 'Your Env access was revoked', group: 'Security' },
];

const TITLES: Record<string, string> = Object.fromEntries(NOTIFICATION_TYPES.map((t) => [t.type, t.label]));

export interface NotifyInput {
  users: Iterable<number>;
  actorId: number | null;
  type: string;
  body: string;
  link?: string | null;
  title?: string;
  entity?: { type: string; id: string | number } | null;
  projectId?: number | null;
}

/** /projects/12/… → 12 */
export function projectIdFromLink(link: string | null | undefined): number | null {
  const m = /^\/projects\/(\d+)(?:\/|\?|$)/.exec(link || '');
  return m ? Number(m[1]) : null;
}

export function recipients(users: Iterable<number>, actorId: number | null): number[] {
  return Array.from(new Set(Array.from(users).map(Number))).filter((id) => Number.isFinite(id) && id > 0 && id !== actorId);
}

export async function notify(n: NotifyInput): Promise<void> {
  const ids = recipients(n.users, n.actorId);
  if (!ids.length) return;
  const body = n.body.slice(0, 1000);
  const link = n.link ?? null;
  try {
    const prefs = await query<{ user_id: string; channel: Channel }>(
      `SELECT user_id, channel FROM notification_prefs WHERE type = $1 AND user_id = ANY($2::bigint[])`, [n.type, ids]
    );
    const channel = new Map(prefs.map((p) => [Number(p.user_id), p.channel]));
    const wanted = ids.filter((id) => channel.get(id) !== 'off');
    if (!wanted.length) return;

    const inserted = await query<{ id: string; user_id: string }>(
      `INSERT INTO notifications_inbox (user_id, type, title, body, link, entity_type, entity_id, project_id, actor_id)
       SELECT u, $2::varchar, $3::varchar, $4::text, $5::text, $6::varchar, $7::varchar, $8::int, $9::bigint FROM unnest($1::bigint[]) u
        WHERE NOT EXISTS (
          SELECT 1 FROM notifications_inbox x
           WHERE x.user_id = u AND x.type = $2::varchar AND x.body = $4::text AND x.link IS NOT DISTINCT FROM $5::text
             AND x.read_at IS NULL AND x.created_at > NOW() - INTERVAL '1 minute')
       RETURNING id, user_id`,
      [wanted, n.type, (n.title || TITLES[n.type] || null)?.slice(0, 200) ?? null, body, link,
        n.entity?.type ?? null, n.entity ? String(n.entity.id) : null, n.projectId ?? projectIdFromLink(link), n.actorId]
    );

    const emailIds = inserted.filter((r) => channel.get(Number(r.user_id)) === 'email');
    if (emailIds.length) await emailNow(emailIds.map((r) => ({ id: Number(r.id), user_id: Number(r.user_id) })), n.title || TITLES[n.type] || 'Notification', body, link);
  } catch (err) {
    // Notifications never break the action that triggered them.
    console.error('[notify]', (err as Error)?.message);
  }
}

async function emailNow(rows: { id: number; user_id: number }[], subject: string, body: string, link: string | null) {
  const users = await query<{ id: string; email_address: string | null }>(
    `SELECT id, email_address FROM users WHERE id = ANY($1::bigint[]) AND COALESCE(is_active, true)`, [rows.map((r) => r.user_id)]
  );
  for (const u of users) {
    if (!u.email_address) continue;
    const href = link ? appUrl(link) : null;
    const sent = await sendEmail({
      to: u.email_address,
      subject,
      text: `${body}${href ? `\n\n${href}` : ''}`,
      html: `<p>${escapeHtml(body)}</p>${href ? `<p><a href="${escapeHtml(href)}">Open</a></p>` : ''}`,
    });
    if (sent) {
      const ids = rows.filter((r) => r.user_id === Number(u.id)).map((r) => r.id);
      await query(`UPDATE notifications_inbox SET emailed_at = NOW() WHERE id = ANY($1::bigint[])`, [ids]);
    }
  }
}

/** Claim a "send once" key; false if it was already used. */
export async function once(key: string): Promise<boolean> {
  const r = await query(`INSERT INTO notification_once (key) VALUES ($1) ON CONFLICT (key) DO NOTHING RETURNING key`, [key.slice(0, 120)]);
  return r.length > 0;
}
