/** Security alerts for CEO accounts. */
import { queryOne } from '@/lib/db';
import { notify } from '@/lib/notifications';
import { appUrl, escapeHtml, sendEmail } from '@/lib/email';

/** In-app + email (always email, whatever the preference: it's a security alert). */
export async function notifyNewDevice(userId: number, userAgent: string | null, ip: string | null) {
  const when = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Karachi', dateStyle: 'medium', timeStyle: 'short' });
  const body = `New sign-in to your CEO account on ${when} PKT from ${ip || 'an unknown address'} (${(userAgent || 'unknown browser').slice(0, 120)}). If this wasn't you, open Security and sign out everywhere.`;
  await notify({ users: [userId], actorId: null, type: 'security_new_device', body, link: '/ceo/security' });
  const u = await queryOne<{ email_address: string | null }>(`SELECT email_address FROM users WHERE id = $1`, [userId]);
  if (u?.email_address) {
    await sendEmail({
      to: u.email_address,
      subject: 'New sign-in to your Bytes Platform CEO account',
      text: `${body}\n\n${appUrl('/ceo/security')}`,
      html: `<p>${escapeHtml(body)}</p><p><a href="${escapeHtml(appUrl('/ceo/security'))}">Review sessions</a></p>`,
    });
  }
}
