/**
 * TOTP second factor: login challenges, enrolment, and one-off code checks
 * (vault break-glass). Secrets are encrypted with VAULT_MASTER_KEY; a code is
 * accepted once only (last_used_step).
 */
import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { HttpError } from '@/lib/training/http';
import { masterKey, open, seal, VaultConfigError } from '@/lib/vault/crypto';
import { issueSession } from './session';
import { newTotpSecret, otpauthUri, verifyTotp } from './totp';

export const MAX_ATTEMPTS = 5;
const aad = (userId: number) => `totp:${userId}`;

function mk(): Buffer {
  try {
    return masterKey();
  } catch (e) {
    if (e instanceof VaultConfigError) throw new HttpError(503, 'Two-factor sign-in is not configured on the server (VAULT_MASTER_KEY)');
    throw e;
  }
}

interface TotpRow { secret_enc: Buffer; iv: Buffer; tag: Buffer; enabled_at: string | null; last_used_step: string | null }

async function totpRow(userId: number) {
  return queryOne<TotpRow>(`SELECT secret_enc, iv, tag, enabled_at, last_used_step FROM user_totp WHERE user_id = $1`, [userId]);
}

function secretOf(userId: number, r: TotpRow): string {
  return open(mk(), { ciphertext: r.secret_enc, iv: r.iv, tag: r.tag }, aad(userId)).toString('utf8');
}

export async function totpEnabled(userId: number): Promise<boolean> {
  return !!(await totpRow(userId))?.enabled_at;
}

export async function startTotpChallenge(userId: number, remember: boolean) {
  const id = randomUUID();
  await query(`INSERT INTO auth_challenges (id, user_id, remember, expires_at) VALUES ($1, $2, $3, NOW() + INTERVAL '10 minutes')`, [id, userId, remember]);
  return { challenge: id, enrolled: await totpEnabled(userId) };
}

async function liveChallenge(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) throw new HttpError(400, 'Sign in again');
  const c = await queryOne<{ id: string; user_id: string; attempts: number; remember: boolean }>(
    `SELECT id, user_id, attempts, remember FROM auth_challenges WHERE id = $1 AND used_at IS NULL AND expires_at > NOW()`, [id]
  );
  if (!c) throw new HttpError(401, 'This sign-in expired — enter your password again');
  if (c.attempts >= MAX_ATTEMPTS) throw new HttpError(429, 'Too many wrong codes — enter your password again');
  return { ...c, user_id: Number(c.user_id) };
}

/** Start (or restart) enrolment during a login challenge. Only while 2FA isn't enabled yet. */
export async function enrollDuringChallenge(challengeId: string) {
  const c = await liveChallenge(challengeId);
  if (await totpEnabled(c.user_id)) throw new HttpError(400, 'Two-factor sign-in is already set up');
  const u = await queryOne<{ username: string }>(`SELECT username FROM users WHERE id = $1`, [c.user_id]);
  const secret = newTotpSecret();
  const s = seal(mk(), secret, aad(c.user_id));
  await query(
    `INSERT INTO user_totp (user_id, secret_enc, iv, tag) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE SET secret_enc = EXCLUDED.secret_enc, iv = EXCLUDED.iv, tag = EXCLUDED.tag, enabled_at = NULL, last_used_step = NULL`,
    [c.user_id, s.ciphertext, s.iv, s.tag]
  );
  return { secret, uri: otpauthUri(secret, u?.username || `user-${c.user_id}`) };
}

/**
 * Check a code for a user and burn its time step. Works for a pending enrolment
 * only when `allowPending` (the login challenge confirms enrolment).
 */
export async function checkUserCode(userId: number, code: string, allowPending = false): Promise<boolean> {
  const r = await totpRow(userId);
  if (!r || (!r.enabled_at && !allowPending)) return false;
  const step = verifyTotp(secretOf(userId, r), code);
  if (step === null) return false;
  // Atomic: only one request can use this step (or an earlier one).
  const used = await query(
    `UPDATE user_totp SET last_used_step = $2, enabled_at = COALESCE(enabled_at, NOW())
      WHERE user_id = $1 AND (last_used_step IS NULL OR last_used_step < $2) RETURNING user_id`,
    [userId, step]
  );
  return used.length === 1;
}

/** Finish a CEO login: right code → session + token. */
export async function completeChallenge(challengeId: string, code: string, request: NextRequest) {
  const c = await liveChallenge(challengeId);
  if (!(await checkUserCode(c.user_id, code, true))) {
    await query(`UPDATE auth_challenges SET attempts = attempts + 1 WHERE id = $1`, [c.id]);
    throw new HttpError(401, 'Wrong or already-used code');
  }
  const done = await query(`UPDATE auth_challenges SET used_at = NOW() WHERE id = $1 AND used_at IS NULL RETURNING id`, [c.id]);
  if (!done.length) throw new HttpError(401, 'This sign-in was already used');
  const user = await queryOne<any>(`SELECT * FROM users WHERE id = $1 AND COALESCE(is_active, true)`, [c.user_id]);
  if (!user) throw new HttpError(401, 'Account not active');
  const { token } = await issueSession(user, request, { remember: c.remember });
  const { password: _pw, ...rest } = user;
  return { token, user: rest };
}

/**
 * Whether CEO accounts must use an authenticator app (login + break-glass).
 * Off unless CEO_REQUIRE_2FA=true — turn it on before real use.
 */
export const ceoTwoFactorRequired = () => process.env.CEO_REQUIRE_2FA === 'true';

/** For break-glass and other sensitive confirmations: an enabled TOTP + a fresh code. */
export async function requireFreshCode(userId: number, code: unknown) {
  if (!(await totpEnabled(userId))) throw new HttpError(403, 'Set up two-factor sign-in first');
  if (!(await checkUserCode(userId, String(code || '')))) throw new HttpError(403, 'Wrong or already-used authenticator code');
}
