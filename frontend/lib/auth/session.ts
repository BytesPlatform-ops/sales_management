/**
 * The one place every API request is authenticated.
 *
 *   verifyRequest(request) → AuthCtx
 *
 * Rules enforced here, for every route (new and legacy):
 *   - Token signed with JWT_SECRET; "purpose" tokens (recording/media links) are not logins.
 *   - Read-only "view as" tokens may only GET/HEAD/OPTIONS.
 *   - CEO tokens must belong to a live session (user_sessions); HR tokens too when they
 *     carry a session id. Agent/developer tokens skip the DB check (they're short and
 *     numerous) — revoking their sessions takes effect at token expiry.
 *   - A CEO may read anything; a CEO write needs Admin mode (admin_until in the token),
 *     except a few personal/security actions (ADMIN_FREE_WRITES). Every Admin-mode write
 *     is recorded in ceo_audit_log.
 *
 * Route code sees `effectiveRole`: a CEO acts with HR's permissions (writes only reach a
 * route at all when Admin mode is on). `role` stays the real one for CEO-only rules
 * (vault break-glass, logs).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomUUID } from 'crypto';
import { SignJWT, jwtVerify } from 'jose';
import { query, queryOne } from '@/lib/db';
import { jwtSecret } from '@/lib/jwt-secret';

export type RealRole = 'hr' | 'agent' | 'developer' | 'ceo';
export type EffectiveRole = 'hr' | 'agent' | 'developer';

export class AuthError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface TokenClaims {
  userId: number | string;
  username?: string;
  role: RealRole;
  sid?: string;
  readonly?: boolean;
  view_as_by?: number;
  view_as_sid?: string;
  admin_until?: number; // epoch seconds
  purpose?: string;
}

export interface AuthCtx {
  userId: number;
  username: string;
  role: RealRole;
  effectiveRole: EffectiveRole;
  sid: string | null;
  readonly: boolean;
  viewAsBy: number | null;
  adminUntil: number | null;
  adminActive: boolean;
  isWrite: boolean;
}

export const effectiveRole = (r: string): EffectiveRole => (r === 'ceo' || r === 'hr' ? 'hr' : r === 'developer' ? 'developer' : 'agent');
export const isWriteMethod = (m: string) => !['GET', 'HEAD', 'OPTIONS'].includes(m.toUpperCase());

/** CEO writes that don't need Admin mode: their own security, sign-in, notifications, break-glass. */
const ADMIN_FREE_WRITES: RegExp[] = [
  /^\/api\/auth\//,
  /^\/api\/ceo\/view-as$/,
  /^\/api\/ceo\/sessions/,
  /^\/api\/ceo\/vault-revocations$/,           // revoking is protective (POST); restoring needs Admin mode (DELETE below)
  /^\/api\/projects\/\d+\/env\/\d+\/value$/,     // break-glass has its own TOTP + reason gate
  /^\/api\/inbox\//,
  /^\/api\/notices/,
  /^\/api\/reminders(\/|$)/,                   // own reminders; reminding someone else still needs Admin mode (checked in the route)
];

export function adminFreeWrite(method: string, path: string): boolean {
  if (/^\/api\/ceo\/vault-revocations$/.test(path) && method.toUpperCase() !== 'POST') return false;
  return ADMIN_FREE_WRITES.some((re) => re.test(path));
}

export function bearer(request: NextRequest | Request): string | null {
  const h = request.headers.get('authorization');
  return h && h.startsWith('Bearer ') ? h.slice(7) : null;
}

export function clientIp(request: NextRequest | Request): string | null {
  const fwd = request.headers.get('x-forwarded-for');
  return (fwd ? fwd.split(',')[0].trim() : (request as NextRequest).ip) || null;
}

export async function readClaims(token: string): Promise<TokenClaims> {
  let payload: any;
  try {
    payload = (await jwtVerify(token, jwtSecret())).payload;
  } catch {
    throw new AuthError(401, 'Invalid or expired token');
  }
  if (payload.purpose || payload.userId === undefined || !payload.role) throw new AuthError(401, 'Invalid or expired token');
  return payload as TokenClaims;
}

async function sessionLive(sid: string, userId: number): Promise<boolean> {
  const s = await queryOne<{ id: string; stale: boolean }>(
    `SELECT id, last_seen_at < NOW() - INTERVAL '5 minutes' AS stale FROM user_sessions
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > NOW()`,
    [sid, userId]
  );
  if (!s) return false;
  if (s.stale) await query(`UPDATE user_sessions SET last_seen_at = NOW() WHERE id = $1`, [sid]).catch(() => {});
  return true;
}

const cache = new WeakMap<object, Promise<AuthCtx>>();

/** Authenticate and apply the cross-cutting rules. Cached per request object. */
export function verifyRequest(request: NextRequest | Request): Promise<AuthCtx> {
  let p = cache.get(request);
  if (!p) {
    p = doVerify(request);
    cache.set(request, p);
  }
  return p;
}

async function doVerify(request: NextRequest | Request): Promise<AuthCtx> {
  const token = bearer(request);
  if (!token) throw new AuthError(401, 'No token provided');
  const c = await readClaims(token);
  const userId = Number(c.userId);
  const method = (request.method || 'GET').toUpperCase();
  const write = isWriteMethod(method);
  const path = new URL(request.url).pathname;

  if (c.readonly) {
    if (write) throw new AuthError(403, 'Read-only view: changes are disabled');
    // The viewing CEO's own session must still be live.
    if (!c.view_as_sid || !c.view_as_by || !(await sessionLive(c.view_as_sid, Number(c.view_as_by)))) {
      throw new AuthError(401, 'View-as session ended');
    }
  }

  if (c.role === 'ceo') {
    if (!c.sid || !(await sessionLive(c.sid, userId))) throw new AuthError(401, 'Session ended — sign in again');
  } else if (c.role === 'hr' && c.sid && !c.readonly) {
    try {
      if (!(await sessionLive(c.sid, userId))) throw new AuthError(401, 'Session ended — sign in again');
    } catch (e) {
      if (e instanceof AuthError) throw e;
      // user_sessions missing (migration not applied yet): don't lock HR out.
    }
  }

  const adminUntil = c.admin_until ? Number(c.admin_until) : null;
  const adminActive = c.role === 'ceo' && !!adminUntil && adminUntil * 1000 > Date.now();
  if (c.role === 'ceo' && write) {
    if (!adminActive && !adminFreeWrite(method, path)) throw new AuthError(403, 'Turn on Admin mode to make changes');
    if (adminActive && !adminFreeWrite(method, path)) {
      const url = new URL(request.url);
      await query(
        `INSERT INTO ceo_audit_log (ceo_id, method, path, target, ip) VALUES ($1, $2, $3, $4, $5)`,
        [userId, method, path, url.search ? url.search.slice(0, 500) : null, clientIp(request)]
      );
    }
  }

  return {
    userId, username: String(c.username || ''), role: c.role, effectiveRole: effectiveRole(c.role),
    sid: c.sid ?? null, readonly: !!c.readonly, viewAsBy: c.view_as_by ? Number(c.view_as_by) : null,
    adminUntil, adminActive, isWrite: write,
  };
}

// ------------------------------------------------------------------ legacy routes

/**
 * For the older hand-written routes: returns `{ payload }` shaped like their old
 * jwtVerify result, with the CEO presented as HR (the rules above already ran).
 */
export async function legacyAuth(request: NextRequest | Request) {
  const a = await verifyRequest(request);
  return { payload: { userId: a.userId, username: a.username, role: a.effectiveRole, realRole: a.role } as any };
}

/** Wraps a legacy route handler so auth failures always answer 401/403 with a clear message. */
export function withAuth<A extends any[]>(fn: (request: any, ...rest: A) => Promise<Response> | Response) {
  return async (request: NextRequest, ...rest: A): Promise<Response> => {
    try {
      await verifyRequest(request);
    } catch (e) {
      if (e instanceof AuthError) return NextResponse.json({ status: 'error', message: e.message }, { status: e.status });
      throw e;
    }
    return fn(request, ...rest);
  };
}

// ------------------------------------------------------------------ issuing tokens

export const CEO_SESSION_HOURS = 12;

export function deviceHash(userAgent: string | null, ip: string | null): string {
  const ua = String(userAgent || '');
  const family = (ua.match(/(Edg|OPR|Chrome|Firefox|Safari)\/\d+/)?.[1] || 'other') + '|' +
    (ua.match(/(Windows|Mac OS X|Android|iPhone|iPad|Linux)/)?.[1] || 'other');
  const net = ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip) ? ip.split('.').slice(0, 3).join('.') : String(ip || '').split(':').slice(0, 4).join(':');
  return createHash('sha256').update(family + '|' + net).digest('hex');
}

export async function signToken(claims: Omit<TokenClaims, 'purpose'>, expiresAt: Date): Promise<string> {
  return new SignJWT(claims as any)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(jwtSecret());
}

export interface IssuedSession { token: string; sid: string | null; expiresAt: Date; newDevice: boolean }

/**
 * Start a session and sign its token. Every role gets a session row (so it can be listed
 * and revoked); CEOs get 12 h and a new-device alert.
 */
export async function issueSession(
  user: { id: number | string; username: string; role: string; full_name?: string },
  request: NextRequest | Request,
  opts: { remember?: boolean } = {},
): Promise<IssuedSession> {
  const role = user.role as RealRole;
  const hours = role === 'ceo' ? CEO_SESSION_HOURS : opts.remember ? 24 * 30 : 12;
  const expiresAt = new Date(Date.now() + hours * 3600_000);
  const ip = clientIp(request);
  const ua = request.headers.get('user-agent');
  const hash = deviceHash(ua, ip);
  let sid: string | null = randomUUID();
  let newDevice = false;
  try {
    const seen = await queryOne(
      `SELECT 1 FROM user_sessions WHERE user_id = $1 AND device_hash = $2 AND created_at > NOW() - INTERVAL '90 days' LIMIT 1`,
      [user.id, hash]
    );
    const any = await queryOne(`SELECT 1 FROM user_sessions WHERE user_id = $1 LIMIT 1`, [user.id]);
    newDevice = !seen && !!any;
    await query(
      `INSERT INTO user_sessions (id, user_id, expires_at, ip, user_agent, device_hash) VALUES ($1, $2, $3, $4, $5, $6)`,
      [sid, user.id, expiresAt, ip, ua?.slice(0, 500) ?? null, hash]
    );
  } catch (e) {
    if (role === 'ceo') throw e; // a CEO session must be recorded
    sid = null; // table not there yet: plain token as before
  }
  const token = await signToken({ userId: Number(user.id), username: user.username, role, ...(sid ? { sid } : {}) }, expiresAt);
  if (role === 'ceo' && newDevice) {
    const { notifyNewDevice } = await import('./alerts');
    await notifyNewDevice(Number(user.id), ua, ip).catch((err) => console.error('[auth] new-device alert', err));
  }
  return { token, sid, expiresAt, newDevice };
}

export async function sessionExpiry(sid: string): Promise<Date | null> {
  const r = await queryOne<{ expires_at: Date }>(`SELECT expires_at FROM user_sessions WHERE id = $1`, [sid]);
  return r ? new Date(r.expires_at) : null;
}
