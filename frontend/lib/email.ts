/**
 * Outgoing system email (notifications, digest) via SendGrid.
 *
 * Needs SENDGRID_API_KEY and NOTIFY_FROM_EMAIL. Without them sending is skipped
 * (logged once), so the app works fine with in-app notifications only.
 * Tests swap the sender with setEmailSender() — nothing real is ever sent.
 */
export interface EmailMessage { to: string; subject: string; html: string; text?: string }
export type EmailSender = (m: EmailMessage) => Promise<boolean>;

let warned = false;

export function emailConfigured(): boolean {
  return !!(process.env.SENDGRID_API_KEY && process.env.NOTIFY_FROM_EMAIL);
}

const sendgrid: EmailSender = async (m) => {
  if (!emailConfigured()) {
    if (!warned) { warned = true; console.warn('[email] SENDGRID_API_KEY / NOTIFY_FROM_EMAIL not set; notification emails are skipped'); }
    return false;
  }
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.SENDGRID_API_KEY}` },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: m.to }], subject: m.subject }],
      from: { email: process.env.NOTIFY_FROM_EMAIL, name: process.env.NOTIFY_FROM_NAME || 'Bytes Platform' },
      content: [
        ...(m.text ? [{ type: 'text/plain', value: m.text }] : []),
        { type: 'text/html', value: m.html },
      ],
    }),
  });
  if (!res.ok) {
    // Status only: the response body could echo the message.
    console.error(`[email] SendGrid returned ${res.status}`);
    return false;
  }
  return true;
};

let sender: EmailSender = sendgrid;

export function setEmailSender(s: EmailSender | null) {
  sender = s ?? sendgrid;
}

export async function sendEmail(m: EmailMessage): Promise<boolean> {
  try {
    return await sender(m);
  } catch (err) {
    console.error('[email] send failed', (err as Error)?.message);
    return false;
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function appUrl(path: string): string {
  const base = (process.env.APP_BASE_URL || '').replace(/\/+$/, '');
  return base ? `${base}${path.startsWith('/') ? path : `/${path}`}` : path;
}
