/**
 * Linking a developer's GitHub account (OAuth through our GitHub App). The state
 * is a short signed token bound to the user, so the callback — a plain browser
 * redirect with no Authorization header — knows who is linking and can't be forged.
 */
import { SignJWT, jwtVerify } from 'jose';
import { randomBytes } from 'crypto';
import { query, queryOne } from '@/lib/db';
import { HttpError } from '@/lib/training/http';
import { jwtSecret } from '@/lib/jwt-secret';
import { github } from './client';

const PURPOSE = 'github-link';

export async function linkState(userId: number): Promise<string> {
  return new SignJWT({ purpose: PURPOSE, uid: userId, n: randomBytes(8).toString('hex') })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('10m').sign(jwtSecret());
}

export async function readLinkState(state: string): Promise<number> {
  try {
    const { payload } = await jwtVerify(state, jwtSecret());
    if (payload.purpose !== PURPOSE || typeof payload.uid !== 'number') throw new Error('bad state');
    return payload.uid;
  } catch {
    throw new HttpError(400, 'The GitHub link expired or was tampered with — start again from your profile');
  }
}

export function callbackUrl(origin: string): string {
  return `${(process.env.APP_BASE_URL || origin).replace(/\/$/, '')}/api/profile/github/callback`;
}

/** Store the link; one GitHub account per person. */
export async function saveLink(userId: number, gh: { id: number; login: string }) {
  const other = await queryOne<{ user_id: string }>(`SELECT user_id FROM developer_github WHERE github_user_id = $1 AND user_id <> $2`, [gh.id, userId]);
  if (other) throw new HttpError(409, `GitHub account ${gh.login} is already linked to someone else`);
  await query(
    `INSERT INTO developer_github (user_id, github_user_id, github_login) VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET github_user_id = EXCLUDED.github_user_id, github_login = EXCLUDED.github_login, linked_at = NOW()`,
    [userId, gh.id, gh.login]
  );
}

export async function completeLink(state: string, code: string, origin: string) {
  const userId = await readLinkState(state);
  const token = await github().oauthExchange(code, callbackUrl(origin));
  const gh = await github().getAuthenticatedUser(token); // the user token is used once and never stored
  await saveLink(userId, gh);
  return { userId, login: gh.login };
}
