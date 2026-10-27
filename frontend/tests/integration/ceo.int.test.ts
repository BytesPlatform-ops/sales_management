/**
 * CEO role, end to end through the real routes: 2FA login, sessions, Admin mode,
 * read-only view-as, vault break-glass and revocation, HR can't touch CEO accounts,
 * privacy notice, sensitive-read log.
 */
import { randomBytes } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { assertSafeDb, resetDb } from './db';

assertSafeDb();
process.env.MEDIA_STORAGE = 'local';
// These tests cover the 2FA flows, which are off by default.
process.env.CEO_REQUIRE_2FA = 'true';
process.env.VAULT_MASTER_KEY = process.env.VAULT_MASTER_KEY || randomBytes(32).toString('base64');

import bcrypt from 'bcryptjs';
import { pool, query, queryOne } from '@/lib/db';
import { issueSession } from '@/lib/auth/session';
import { totpAt } from '@/lib/auth/totp';
import { ceoCanSeeDMs } from '@/lib/auth/ceo';
import { middleware } from '@/middleware';
import * as login from '@/app/api/auth/login/route';
import * as totp from '@/app/api/auth/totp/route';
import * as enroll from '@/app/api/auth/totp/enroll/route';
import * as adminMode from '@/app/api/auth/admin-mode/route';
import * as sessions from '@/app/api/auth/sessions/route';
import * as logout from '@/app/api/auth/logout/route';
import * as me from '@/app/api/auth/me/route';
import * as invite from '@/app/api/auth/invite/[token]/route';
import * as viewAs from '@/app/api/ceo/view-as/route';
import * as ceoUsers from '@/app/api/ceo/users/route';
import * as accessLog from '@/app/api/ceo/access-log/route';
import * as revocations from '@/app/api/ceo/vault-revocations/route';
import * as privacy from '@/app/api/ceo/privacy/route';
import * as notices from '@/app/api/notices/route';
import * as hrDevelopers from '@/app/api/hr/developers/route';
import * as hrDeveloper from '@/app/api/hr/developers/[id]/route';
import * as hrAgent from '@/app/api/hr/agents/[id]/route';
import * as hrSettings from '@/app/api/hr/settings/route';
import * as projectRoute from '@/app/api/projects/[id]/route';
import * as projectTickets from '@/app/api/projects/[id]/tickets/route';
import * as messages from '@/app/api/projects/[id]/messages/route';
import * as uploadUrl from '@/app/api/media/upload-url/route';
import * as envList from '@/app/api/projects/[id]/env/route';
import * as envValue from '@/app/api/projects/[id]/env/[secretId]/value/route';
import * as envExport from '@/app/api/projects/[id]/env/export/route';
import * as attendance from '@/app/api/attendance/route';

const NO_CTX = {} as any;
const PW = { hr: 'hr-password-1', ceo: 'ceo-password-1', agent: 'agent-password-1' };
const U: Record<string, number> = {};
let P = 0;
let SECRET_ID = 0;
let PROD_SECRET_ID = 0;
let ceoToken = '';
let hrToken = '';
const tokens: Record<string, string> = {};

function req(token: string | null, url: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`http://test${url}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0',
      'x-forwarded-for': '10.1.2.3',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
async function call(r: Promise<Response> | Response) {
  const res = await r;
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}
const pctx = (id: number) => ({ params: { id: String(id) } });

async function ceoSession(id = U.ceo) {
  const u = await queryOne<any>(`SELECT * FROM users WHERE id = $1`, [id]);
  return (await issueSession(u, req(null, '/'))).token;
}
async function freshCode(userId: number) {
  await query(`UPDATE user_totp SET last_used_step = NULL WHERE user_id = $1`, [userId]);
  const r = await queryOne<{ secret_enc: Buffer; iv: Buffer; tag: Buffer }>(`SELECT secret_enc, iv, tag FROM user_totp WHERE user_id = $1`, [userId]);
  const { open, masterKey } = await import('@/lib/vault/crypto');
  return totpAt(open(masterKey(), { ciphertext: r!.secret_enc, iv: r!.iv, tag: r!.tag }, `totp:${userId}`).toString('utf8'));
}
async function adminToken(token: string, password = PW.ceo) {
  const r = await call(adminMode.POST(req(token, '/api/auth/admin-mode', 'POST', { password }), NO_CTX));
  return r.body.data?.token as string;
}

beforeAll(async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-secret';
  await resetDb();
  await query(`CREATE TABLE IF NOT EXISTS system_settings (key VARCHAR(100) PRIMARY KEY, value TEXT, description TEXT, updated_at TIMESTAMPTZ DEFAULT NOW())`);
  const hash = (p: string) => bcrypt.hashSync(p, 4);
  for (const [k, role, pw] of [['hr', 'hr', PW.hr], ['ceo', 'ceo', PW.ceo], ['ceo2', 'ceo', PW.ceo], ['agent', 'agent', PW.agent], ['dev', 'developer', 'x'], ['lead', 'developer', 'x']] as const) {
    const r = await queryOne<{ id: string }>(
      `INSERT INTO users (username, password, full_name, role, email_address) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [k, hash(pw), `${k} name`, role, `${k}@example.test`]
    );
    U[k] = Number(r!.id);
  }
  const p = await queryOne<{ id: number }>(`INSERT INTO projects (title, client_name, created_by, supervisor_id) VALUES ('Acme', 'Acme', $1, $2) RETURNING id`, [U.agent, U.hr]);
  P = p!.id;
  await query(`INSERT INTO project_members (project_id, user_id, member_role) VALUES ($1, $2, 'developer'), ($1, $3, 'lead_developer')`, [P, U.dev, U.lead]);
  const tok = async (id: number, username: string, role: string) => {
    const u = { id, username, role, full_name: username };
    return (await issueSession(u, req(null, '/'))).token;
  };
  hrToken = await tok(U.hr, 'hr', 'hr');
  tokens.agent = await tok(U.agent, 'agent', 'agent');
  tokens.dev = await tok(U.dev, 'dev', 'developer');
  tokens.lead = await tok(U.lead, 'lead', 'developer');
  const a = await call(envList.POST(req(hrToken, `/api/projects/${P}/env`, 'POST', { environment: 'development', key: 'DB_URL', value: 'postgres://dev-secret' }), pctx(P)));
  SECRET_ID = a.body.data.id;
  const b = await call(envList.POST(req(hrToken, `/api/projects/${P}/env`, 'POST', { environment: 'production', key: 'STRIPE', value: 'sk_live_prod' }), pctx(P)));
  PROD_SECRET_ID = b.body.data.id;
});
afterAll(() => pool.end());

describe('CEO sign-in needs a second factor', () => {
  let challenge = '';
  let secret = '';

  it('a password alone gives a TOTP challenge, not a token', async () => {
    const r = await call(login.POST(req(null, '/api/auth/login', 'POST', { username: 'ceo', password: PW.ceo })));
    expect(r.status).toBe(200);
    expect(r.body.data.token).toBeUndefined();
    expect(r.body.data.totp_required).toBe(true);
    expect(r.body.data.enrolled).toBe(false);
    challenge = r.body.data.challenge;
  });

  it('enrols an authenticator, rejects a wrong code, accepts the right one', async () => {
    const e = await call(enroll.POST(req(null, '/api/auth/totp/enroll', 'POST', { challenge }), NO_CTX));
    secret = e.body.data.secret;
    expect(e.body.data.uri).toMatch(/^otpauth:\/\/totp\//);
    const wrong = await call(totp.POST(req(null, '/api/auth/totp', 'POST', { challenge, code: '000000' }), NO_CTX));
    expect(wrong.status).toBe(401);
    const ok = await call(totp.POST(req(null, '/api/auth/totp', 'POST', { challenge, code: totpAt(secret) }), NO_CTX));
    expect(ok.status).toBe(200);
    ceoToken = ok.body.data.token;
    expect((await queryOne<{ n: number }>(`SELECT COUNT(*)::int AS n FROM user_sessions WHERE user_id = $1`, [U.ceo]))!.n).toBe(1);
  });

  it('the same code can’t be used twice, and a used challenge is dead', async () => {
    const r = await call(login.POST(req(null, '/api/auth/login', 'POST', { username: 'ceo', password: PW.ceo })));
    expect(r.body.data.enrolled).toBe(true);
    const reuse = await call(totp.POST(req(null, '/api/auth/totp', 'POST', { challenge: r.body.data.challenge, code: totpAt(secret) }), NO_CTX));
    expect(reuse.status).toBe(401);
    const again = await call(totp.POST(req(null, '/api/auth/totp', 'POST', { challenge, code: totpAt(secret) }), NO_CTX));
    expect(again.status).toBe(401);
  });

  it('locks a challenge after 5 wrong codes', async () => {
    const r = await call(login.POST(req(null, '/api/auth/login', 'POST', { username: 'ceo', password: PW.ceo })));
    const c = r.body.data.challenge;
    for (let i = 0; i < 5; i++) await totp.POST(req(null, '/api/auth/totp', 'POST', { challenge: c, code: '111111' }), NO_CTX);
    const locked = await call(totp.POST(req(null, '/api/auth/totp', 'POST', { challenge: c, code: await freshCode(U.ceo) }), NO_CTX));
    expect(locked.status).toBe(429);
  });

  it('other roles still sign in with a password, and get a session', async () => {
    const r = await call(login.POST(req(null, '/api/auth/login', 'POST', { username: 'hr', password: PW.hr })));
    expect(r.body.data.token).toBeTruthy();
    const s = await queryOne<{ n: number }>(`SELECT COUNT(*)::int AS n FROM user_sessions WHERE user_id = $1`, [U.hr]);
    expect(s!.n).toBeGreaterThan(0);
  });
});

describe('CEO reads everything; writes need Admin mode', () => {
  it('reads HR-only endpoints (new and legacy) and every project', async () => {
    expect((await call(hrDevelopers.GET(req(ceoToken, '/api/hr/developers'), NO_CTX))).status).toBe(200);
    expect((await call(hrSettings.GET(req(ceoToken, '/api/hr/settings')))).status).toBe(200);
    expect((await call(projectRoute.GET(req(ceoToken, `/api/projects/${P}`), pctx(P)))).status).toBe(200);
  });

  it('refuses writes without Admin mode — new and legacy routes', async () => {
    const t = await call(projectTickets.POST(req(ceoToken, `/api/projects/${P}/tickets`, 'POST', { title: 'x' }), pctx(P)));
    expect(t.status).toBe(403);
    expect(t.body.message).toMatch(/Admin mode/);
    const s = await call(hrSettings.PUT(req(ceoToken, '/api/hr/settings', 'PUT', { key: 'x', value: 'y' })));
    expect(s.status).toBe(403);
    expect(s.body.message).toMatch(/Admin mode/);
  });

  it('Admin mode needs the password, then writes work and are audited', async () => {
    expect(await adminToken(ceoToken, 'wrong')).toBeUndefined();
    const admin = await adminToken(ceoToken);
    expect(admin).toBeTruthy();
    const t = await call(projectTickets.POST(req(admin, `/api/projects/${P}/tickets`, 'POST', { title: 'From the CEO' }), pctx(P)));
    expect(t.status).toBe(200);
    const log = await query<{ path: string; method: string }>(`SELECT path, method FROM ceo_audit_log WHERE ceo_id = $1`, [U.ceo]);
    expect(log).toContainEqual({ path: `/api/projects/${P}/tickets`, method: 'POST' });
  });

  it('Admin mode can only be turned on by a CEO', async () => {
    const r = await call(adminMode.POST(req(hrToken, '/api/auth/admin-mode', 'POST', { password: PW.hr }), NO_CTX));
    expect(r.status).toBe(403);
  });
});

describe('view-as is read-only', () => {
  let asAgent = '';
  let asDev = '';
  it('starts a logged, read-only view of another user (never another CEO)', async () => {
    const r = await call(viewAs.POST(req(ceoToken, '/api/ceo/view-as', 'POST', { user_id: U.agent }), NO_CTX));
    expect(r.status).toBe(200);
    asAgent = r.body.data.token;
    asDev = (await call(viewAs.POST(req(ceoToken, '/api/ceo/view-as', 'POST', { user_id: U.dev }), NO_CTX))).body.data.token;
    expect((await call(viewAs.POST(req(ceoToken, '/api/ceo/view-as', 'POST', { user_id: U.ceo2 }), NO_CTX))).status).toBe(400);
    expect((await call(viewAs.POST(req(hrToken, '/api/ceo/view-as', 'POST', { user_id: U.agent }), NO_CTX))).status).toBe(403);
    const log = await query(`SELECT 1 FROM ceo_access_log WHERE ceo_id = $1 AND kind = 'view_as'`, [U.ceo]);
    expect(log.length).toBe(2);
  });

  it('sees what that user sees', async () => {
    const m = await call(me.GET(req(asAgent, '/api/auth/me')));
    expect(Number(m.body.data.id)).toBe(U.agent);
    expect(m.body.data.view_as.by_id).toBe(U.ceo);
    expect((await call(projectRoute.GET(req(asAgent, `/api/projects/${P}`), pctx(P)))).status).toBe(200);
  });

  it('every write is refused — tickets, messages, uploads, vault, legacy routes', async () => {
    const writes = [
      projectTickets.POST(req(asAgent, `/api/projects/${P}/tickets`, 'POST', { title: 'x' }), pctx(P)),
      messages.POST(req(asAgent, `/api/projects/${P}/messages`, 'POST', { body: 'hi' }), pctx(P)),
      uploadUrl.POST(req(asAgent, '/api/media/upload-url', 'POST', { entity_type: 'project', entity_id: P, file_name: 'a.txt', mime_type: 'text/plain', size_bytes: 3, description: 'x' }), NO_CTX),
      envList.POST(req(asDev, `/api/projects/${P}/env`, 'POST', { environment: 'development', key: 'X', value: 'y' }), pctx(P)),
      envValue.POST(req(asDev, `/api/projects/${P}/env/${SECRET_ID}/value`, 'POST', { action: 'reveal' }), { params: { id: String(P), secretId: String(SECRET_ID) } }),
      attendance.POST(req(asAgent, '/api/attendance', 'POST', {})),
      logout.POST(req(asAgent, '/api/auth/logout', 'POST', {}), NO_CTX),
    ];
    for (const w of writes) {
      const r = await call(w);
      expect(r.status).toBe(403);
    }
  });

  it('never shows vault values, even on GET (export)', async () => {
    const r = await call(envExport.GET(req(asDev, `/api/projects/${P}/env/export?environment=development`), pctx(P)));
    expect(r.status).toBe(403);
    const list = await call(envList.GET(req(asDev, `/api/projects/${P}/env?environment=development`), pctx(P)));
    expect(list.body.data.values_hidden).toBe(true);
  });

  it('the edge middleware also blocks read-only writes', async () => {
    const res = middleware(req(asAgent, '/api/projects/1/tickets', 'POST', {}));
    expect(res.status).toBe(403);
    expect(middleware(req(asAgent, '/api/projects/1', 'GET')).status).toBe(200);
  });

  it('ends when the CEO’s own session ends', async () => {
    const t = await ceoSession();
    const v = (await call(viewAs.POST(req(t, '/api/ceo/view-as', 'POST', { user_id: U.agent }), NO_CTX))).body.data.token;
    await sessions.POST(req(t, '/api/auth/sessions', 'POST', { all: false, id: (await queryOne<{ id: string }>(`SELECT id FROM user_sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [U.ceo]))!.id }), NO_CTX);
    expect((await call(me.GET(req(v, '/api/auth/me')))).status).toBe(401);
  });
});

describe('vault: break-glass and revocation', () => {
  const vctx = (id: number) => ({ params: { id: String(P), secretId: String(id) } });

  it('a CEO sees names but must give a fresh code + reason to see a value', async () => {
    const list = await call(envList.GET(req(ceoToken, `/api/projects/${P}/env?environment=production`), pctx(P)));
    expect(list.body.data.secrets.map((s: any) => s.key_name)).toEqual(['STRIPE']);
    expect(list.body.data.break_glass).toBe(true);
    expect((await call(envValue.POST(req(ceoToken, `/api/projects/${P}/env/${PROD_SECRET_ID}/value`, 'POST', { action: 'reveal' }), vctx(PROD_SECRET_ID)))).status).toBe(403);
    expect((await call(envValue.POST(req(ceoToken, `/api/projects/${P}/env/${PROD_SECRET_ID}/value`, 'POST', { action: 'reveal', reason: 'Client outage', totp_code: '123456' }), vctx(PROD_SECRET_ID)))).status).toBe(403);
    const code = await freshCode(U.ceo);
    const ok = await call(envValue.POST(req(ceoToken, `/api/projects/${P}/env/${PROD_SECRET_ID}/value`, 'POST', { action: 'reveal', reason: 'Client outage', totp_code: code }), vctx(PROD_SECRET_ID)));
    expect(ok.status).toBe(200);
    expect(ok.body.data.value).toBe('sk_live_prod');
    // the same code can't open it again
    expect((await call(envValue.POST(req(ceoToken, `/api/projects/${P}/env/${PROD_SECRET_ID}/value`, 'POST', { action: 'reveal', reason: 'Again please', totp_code: code }), vctx(PROD_SECRET_ID)))).status).toBe(403);
  });

  it('logs the break-glass and tells the lead developer', async () => {
    const a = await queryOne<{ reason: string }>(`SELECT reason FROM vault_audit WHERE action = 'break_glass' AND user_id = $1`, [U.ceo]);
    expect(a!.reason).toBe('Client outage');
    expect((await query(`SELECT 1 FROM ceo_access_log WHERE kind = 'vault_reveal' AND ceo_id = $1`, [U.ceo])).length).toBe(1);
    expect((await query(`SELECT 1 FROM notifications_inbox WHERE user_id = $1 AND type = 'vault_break_glass'`, [U.lead])).length).toBe(1);
  });

  it('the .env download is break-glass too (headers)', async () => {
    const code = await freshCode(U.ceo);
    const r = await envExport.GET(req(ceoToken, `/api/projects/${P}/env/export?environment=development`, 'GET', undefined,
      { 'x-totp-code': code, 'x-break-glass-reason': 'Audit check' }), pctx(P));
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('DB_URL=postgres://dev-secret');
  });

  it('revoking a developer cuts their Env access at once (no Admin mode needed)', async () => {
    expect((await call(envValue.POST(req(tokens.dev, `/api/projects/${P}/env/${SECRET_ID}/value`, 'POST', {}), vctx(SECRET_ID)))).status).toBe(200);
    const r = await call(revocations.POST(req(ceoToken, '/api/ceo/vault-revocations', 'POST', { user_id: U.dev, project_id: P, reason: 'Left' }), NO_CTX));
    expect(r.status).toBe(200);
    expect((await call(envValue.POST(req(tokens.dev, `/api/projects/${P}/env/${SECRET_ID}/value`, 'POST', {}), vctx(SECRET_ID)))).status).toBe(403);
    expect((await call(envList.GET(req(tokens.dev, `/api/projects/${P}/env?environment=development`), pctx(P)))).status).toBe(403);
    // HR can't revoke (CEO tool), and restoring needs Admin mode
    expect((await call(revocations.POST(req(hrToken, '/api/ceo/vault-revocations', 'POST', { user_id: U.lead }), NO_CTX))).status).toBe(403);
    expect((await call(revocations.DELETE(req(ceoToken, `/api/ceo/vault-revocations?id=${r.body.data.id}`, 'DELETE'), NO_CTX))).status).toBe(403);
  });
});

describe('CEO accounts are invisible to HR', () => {
  it('HR can’t read, edit or deactivate a CEO through HR routes', async () => {
    expect((await call(hrAgent.GET(req(hrToken, `/api/hr/agents/${U.ceo}`), { params: Promise.resolve({ id: String(U.ceo) }) } as any))).status).toBe(404);
    expect((await call(hrAgent.DELETE(req(hrToken, `/api/hr/agents/${U.ceo}`, 'DELETE'), { params: Promise.resolve({ id: String(U.ceo) }) } as any))).status).toBe(404);
    expect((await call(hrDeveloper.PATCH(req(hrToken, `/api/hr/developers/${U.ceo}`, 'PATCH', { password: 'reset-it-now' }), pctx(U.ceo)))).status).toBe(404);
    const devs = await call(hrDevelopers.GET(req(hrToken, '/api/hr/developers'), NO_CTX));
    expect(devs.body.data.some((u: any) => Number(u.id) === U.ceo)).toBe(false);
    expect((await call(ceoUsers.GET(req(hrToken, '/api/ceo/users'), NO_CTX))).status).toBe(403);
    expect((await queryOne<{ is_active: boolean }>(`SELECT is_active FROM users WHERE id = $1`, [U.ceo]))!.is_active).toBe(true);
  });

  it('a CEO in Admin mode creates another CEO with a single-use invite', async () => {
    expect((await call(ceoUsers.POST(req(ceoToken, '/api/ceo/users', 'POST', { username: 'cofounder', full_name: 'Co Founder', email: 'co@example.test' }), NO_CTX))).status).toBe(403);
    const admin = await adminToken(ceoToken);
    const r = await call(ceoUsers.POST(req(admin, '/api/ceo/users', 'POST', { username: 'cofounder', full_name: 'Co Founder', email: 'co@example.test' }), NO_CTX));
    expect(r.status).toBe(200);
    const token = r.body.data.invite_url.split('/invite/')[1];
    expect((await call(invite.GET(req(null, `/api/auth/invite/${token}`), { params: { token } }))).body.data.role).toBe('ceo');
    expect((await call(invite.POST(req(null, `/api/auth/invite/${token}`, 'POST', { password: 'a-long-password' }), { params: { token } }))).status).toBe(200);
    expect((await call(invite.POST(req(null, `/api/auth/invite/${token}`, 'POST', { password: 'another-password' }), { params: { token } }))).status).toBe(404);
    const l = await call(login.POST(req(null, '/api/auth/login', 'POST', { username: 'cofounder', password: 'a-long-password' })));
    expect(l.body.data.totp_required).toBe(true);
  });
});

describe('sessions', () => {
  it('“sign out everywhere” kills every CEO token at once', async () => {
    const t1 = await ceoSession(U.ceo2);
    const t2 = await ceoSession(U.ceo2);
    expect((await call(me.GET(req(t1, '/api/auth/me')))).status).toBe(200);
    expect((await call(sessions.POST(req(t2, '/api/auth/sessions', 'POST', { all: true }), NO_CTX))).body.data.revoked).toBe(2);
    expect((await call(me.GET(req(t1, '/api/auth/me')))).status).toBe(401);
    expect((await call(me.GET(req(t2, '/api/auth/me')))).status).toBe(401);
  });

  it('HR logout ends that HR session', async () => {
    const t = (await call(login.POST(req(null, '/api/auth/login', 'POST', { username: 'hr', password: PW.hr })))).body.data.token;
    expect((await call(hrDevelopers.GET(req(t, '/api/hr/developers'), NO_CTX))).status).toBe(200);
    await logout.POST(req(t, '/api/auth/logout', 'POST', {}), NO_CTX);
    expect((await call(hrDevelopers.GET(req(t, '/api/hr/developers'), NO_CTX))).status).toBe(401);
  });

  it('a CEO token without a live session is refused', async () => {
    const { signToken } = await import('@/lib/auth/session');
    const forged = await signToken({ userId: U.ceo, username: 'ceo', role: 'ceo' }, new Date(Date.now() + 3600_000));
    expect((await call(me.GET(req(forged, '/api/auth/me')))).status).toBe(401);
  });
});

describe('privacy and the sensitive-read log', () => {
  it('chat visibility takes effect only after the staff notice period', async () => {
    const admin = await adminToken(ceoToken);
    const r = await call(privacy.PUT(req(admin, '/api/ceo/privacy', 'PUT', { workplace_chat_visibility: true }), NO_CTX));
    expect(r.body.data.in_effect).toBe(false);
    expect(await ceoCanSeeDMs()).toBe(false);
    expect(await ceoCanSeeDMs(new Date(Date.now() + 25 * 3600_000))).toBe(true);
    const n = await call(notices.GET(req(tokens.agent, '/api/notices'), NO_CTX));
    expect(n.body.data[0].kind).toBe('workplace_chat_visibility');
    await notices.POST(req(tokens.agent, '/api/notices', 'POST', { id: n.body.data[0].id }), NO_CTX);
    expect((await call(notices.GET(req(tokens.agent, '/api/notices'), NO_CTX))).body.data.length).toBe(0);
  });

  it('logs a CEO opening one person’s pay, and every CEO can read the log', async () => {
    await hrAgent.GET(req(ceoToken, `/api/hr/agents/${U.agent}`), { params: Promise.resolve({ id: String(U.agent) }) } as any);
    const t2 = await ceoSession(U.ceo2);
    const log = await call(accessLog.GET(req(t2, '/api/ceo/access-log'), NO_CTX));
    const kinds = log.body.data.map((l: any) => l.kind);
    expect(kinds).toContain('payroll_person');
    expect(kinds).toContain('vault_reveal');
    expect((await call(accessLog.GET(req(hrToken, '/api/ceo/access-log'), NO_CTX))).status).toBe(403);
  });
});
