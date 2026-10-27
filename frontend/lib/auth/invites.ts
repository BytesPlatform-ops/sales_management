/** Single-use, 72-hour invite links (CEO accounts). Only the SHA-256 of the token is stored. */
import { createHash, randomBytes } from 'crypto';
import { query, queryOne } from '@/lib/db';
import { HttpError } from '@/lib/training/http';
import bcrypt from 'bcryptjs';

export const INVITE_HOURS = 72;
const hash = (t: string) => createHash('sha256').update(t).digest('hex');

export async function createInvite(userId: number, createdBy: number | null): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await query(`UPDATE user_invites SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL`, [userId]); // old links stop working
  await query(
    `INSERT INTO user_invites (user_id, token_hash, created_by, expires_at) VALUES ($1, $2, $3, NOW() + ($4::int * INTERVAL '1 hour'))`,
    [userId, hash(token), createdBy, INVITE_HOURS]
  );
  return token;
}

export async function lookupInvite(token: string) {
  const r = await queryOne<{ id: number; user_id: string; username: string; full_name: string; role: string }>(
    `SELECT i.id, i.user_id, u.username, u.full_name, u.role FROM user_invites i JOIN users u ON u.id = i.user_id
      WHERE i.token_hash = $1 AND i.used_at IS NULL AND i.expires_at > NOW() AND COALESCE(u.is_active, true)`,
    [hash(String(token || ''))]
  );
  if (!r) throw new HttpError(404, 'This invite link is invalid, used or expired');
  return r;
}

export async function acceptInvite(token: string, password: string) {
  if (password.length < 10) throw new HttpError(400, 'Use at least 10 characters');
  const inv = await lookupInvite(token);
  const used = await query(`UPDATE user_invites SET used_at = NOW() WHERE id = $1 AND used_at IS NULL RETURNING id`, [inv.id]);
  if (!used.length) throw new HttpError(404, 'This invite link was already used');
  await query(`UPDATE users SET password = $2 WHERE id = $1`, [inv.user_id, await bcrypt.hash(password, 10)]);
  return { username: inv.username };
}
