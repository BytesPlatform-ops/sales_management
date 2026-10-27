/** Creating CEO accounts (API and scripts/create-ceo.ts share this). */
import { createHash, randomBytes } from 'crypto';
import { queryOne } from '@/lib/db';
import { HttpError } from '@/lib/training/http';
import { appUrl, escapeHtml, sendEmail } from '@/lib/email';
import { createInvite, INVITE_HOURS } from './invites';
import bcrypt from 'bcryptjs';

export async function createCeoAccount(input: { username: string; full_name: string; email: string }, createdBy: number | null) {
  const username = input.username.trim();
  const fullName = input.full_name.trim();
  const email = input.email.trim();
  if (!/^[A-Za-z0-9_.-]{3,50}$/.test(username)) throw new HttpError(400, 'Username: 3–50 letters, numbers, _ . -');
  if (!fullName || fullName.length > 100) throw new HttpError(400, 'Full name is required');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'A valid email is required');
  if (await queryOne(`SELECT 1 FROM users WHERE username = $1`, [username])) throw new HttpError(400, 'Username already exists');
  // Nobody knows this password; the invite link sets the real one.
  const unusable = await bcrypt.hash(randomBytes(32).toString('hex'), 10);
  const extension = `CEO-${createHash('md5').update(username).digest('hex').slice(0, 12)}`;
  const u = await queryOne<{ id: string }>(
    `INSERT INTO users (username, password, full_name, extension_number, role, base_salary, is_active, email_address)
     VALUES ($1, $2, $3, $4, 'ceo', 1, true, $5) RETURNING id`,
    [username, unusable, fullName, extension, email]
  );
  const inviteUrl = await sendCeoInvite(Number(u!.id), createdBy);
  return { id: Number(u!.id), username, invite_url: inviteUrl };
}

export async function sendCeoInvite(userId: number, createdBy: number | null): Promise<string> {
  const u = await queryOne<{ full_name: string; email_address: string | null }>(`SELECT full_name, email_address FROM users WHERE id = $1`, [userId]);
  const token = await createInvite(userId, createdBy);
  const url = appUrl(`/invite/${token}`);
  if (u?.email_address) {
    await sendEmail({
      to: u.email_address,
      subject: 'Your Bytes Platform CEO account',
      text: `Hi ${u.full_name},\n\nSet your password here (valid ${INVITE_HOURS} hours, single use): ${url}\nYou'll then set up an authenticator app.`,
      html: `<p>Hi ${escapeHtml(u.full_name)},</p><p><a href="${escapeHtml(url)}">Set your password</a> (valid ${INVITE_HOURS} hours, single use). You'll then set up an authenticator app.</p>`,
    }).catch(() => false);
  }
  return url;
}
