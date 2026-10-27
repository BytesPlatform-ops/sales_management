/**
 * Project Env routes end to end against an in-memory stand-in for Postgres:
 * who can list, read, write and download, and that values never leak into
 * list responses, the audit log, or the project thread.
 */
import { randomBytes } from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// ------------------------------------------------------------ fake database
const state = vi.hoisted(() => ({
  users: new Map<number, { role: 'hr' | 'agent' | 'developer'; name: string }>(),
  members: new Map<string, string>(),           // `${projectId}:${userId}` -> member_role
  projects: new Map<number, { id: number; ticket_no: string; created_by: number }>(),
  keys: new Map<number, any>(),
  secrets: [] as any[],
  audit: [] as any[],
  thread: [] as string[],
  nextId: 1,
}));

vi.mock('@/lib/db', () => {
  const run = async (sql: string, p: any[] = []): Promise<any[]> => {
    const s = sql.replace(/\s+/g, ' ');
    if (s.includes('SELECT member_role FROM project_members')) {
      const r = state.members.get(`${p[0]}:${p[1]}`);
      return r ? [{ member_role: r }] : [];
    }
    if (s.includes('FROM vault_project_keys')) return state.keys.has(p[0]) ? [state.keys.get(p[0])] : [];
    if (s.startsWith('INSERT INTO vault_project_keys')) {
      if (!state.keys.has(p[0])) state.keys.set(p[0], { enc_key: p[1], iv: p[2], tag: p[3] });
      return [];
    }
    if (s.startsWith('INSERT INTO vault_secrets')) {
      const [project_id, environment, key_name, ciphertext, iv, tag, note, by] = p;
      const ex = state.secrets.find((x) => x.project_id === project_id && x.environment === environment && x.key_name === key_name);
      if (ex) { Object.assign(ex, { ciphertext, iv, tag, note: note ?? ex.note, updated_by: by }); return [{ id: ex.id, created: false }]; }
      const row = { id: state.nextId++, project_id, environment, key_name, ciphertext, iv, tag, note, created_by: by, updated_by: by, created_at: 'now', updated_at: 'now' };
      state.secrets.push(row);
      return [{ id: row.id, created: true }];
    }
    if (s.includes('FROM vault_secrets WHERE id = $1 AND project_id = $2')) {
      return state.secrets.filter((x) => x.id === p[0] && x.project_id === p[1]);
    }
    if (s.includes('FROM vault_secrets s LEFT JOIN users')) {
      return state.secrets.filter((x) => x.project_id === p[0] && x.environment === p[1])
        .map(({ id, key_name, note, created_at, updated_at }) => ({ id, key_name, note, created_at, updated_at, created_by_name: 'x', updated_by_name: 'x' }));
    }
    if (s.includes('FROM vault_secrets WHERE project_id = $1 AND environment = $2')) {
      return state.secrets.filter((x) => x.project_id === p[0] && x.environment === p[1]);
    }
    if (s.startsWith('UPDATE vault_secrets SET key_name')) {
      const row = state.secrets.find((x) => x.id === p[0]);
      Object.assign(row, { key_name: p[1], note: p[2] }, p[3] ? { ciphertext: p[3], iv: p[4], tag: p[5] } : {});
      return [];
    }
    if (s.startsWith('DELETE FROM vault_secrets')) { state.secrets = state.secrets.filter((x) => x.id !== p[0]); return []; }
    if (s.startsWith('INSERT INTO vault_audit')) {
      state.audit.push({ user_id: p[0], project_id: p[1], secret_id: p[2], key_name: p[3], environment: p[4], action: p[5] });
      return [];
    }
    throw new Error(`fake db: unhandled SQL: ${s.slice(0, 80)}`);
  };
  return { query: run, queryOne: async (sql: string, p?: any[]) => (await run(sql, p))[0] ?? null };
});

vi.mock('@/lib/projects/core', async () => {
  const { HttpError } = await import('@/lib/training/http');
  return {
    getViewer: async (req: NextRequest) => {
      const id = Number(req.headers.get('x-test-user'));
      const u = state.users.get(id);
      if (!u) throw new HttpError(401, 'Account not active');
      return { userId: id, role: u.role, name: u.name };
    },
    // Same visibility as the real loadProject: HR all, developer if member, agent if creator.
    loadProject: async (id: number, v: { userId: number; role: string }) => {
      const pr = state.projects.get(id);
      const visible = pr && (v.role === 'hr' || (v.role === 'developer' && state.members.has(`${id}:${v.userId}`)) || (v.role === 'agent' && pr.created_by === v.userId));
      if (!visible) throw new HttpError(404, 'Project not found');
      return pr;
    },
    systemMessage: async (_id: number, body: string) => { state.thread.push(body); },
  };
});

import * as listRoute from '@/app/api/projects/[id]/env/route';
import * as itemRoute from '@/app/api/projects/[id]/env/[secretId]/route';
import * as valueRoute from '@/app/api/projects/[id]/env/[secretId]/value/route';
import * as exportRoute from '@/app/api/projects/[id]/env/export/route';

// ------------------------------------------------------------ helpers
const HR = 1, AGENT = 2, DEV = 3, LEAD = 4, OUTSIDER = 5;
const P = 10;

function req(user: number, url: string, method = 'GET', body?: unknown) {
  return new NextRequest(`http://test${url}`, {
    method,
    headers: { 'x-test-user': String(user), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}
const json = async (r: Response) => ({ status: r.status, body: await r.json() });

const list = (u: number, env = 'development') => listRoute.GET(req(u, `/api/projects/${P}/env?environment=${env}`), { params: { id: String(P) } });
const add = (u: number, body: any) => listRoute.POST(req(u, `/api/projects/${P}/env`, 'POST', body), { params: { id: String(P) } });
const value = (u: number, id: number, action = 'copy') =>
  valueRoute.POST(req(u, `/api/projects/${P}/env/${id}/value`, 'POST', { action }), { params: { id: String(P), secretId: String(id) } });
const exportEnv = (u: number, env: string) => exportRoute.GET(req(u, `/api/projects/${P}/env/export?environment=${env}`), { params: { id: String(P) } });

beforeEach(() => {
  process.env.VAULT_MASTER_KEY = randomBytes(32).toString('base64');
  state.users = new Map([
    [HR, { role: 'hr', name: 'Hina' }], [AGENT, { role: 'agent', name: 'Asad' }],
    [DEV, { role: 'developer', name: 'Dani' }], [LEAD, { role: 'developer', name: 'Laila' }],
    [OUTSIDER, { role: 'developer', name: 'Omar' }],
  ]);
  state.projects = new Map([[P, { id: P, ticket_no: 'PRJ-0010', created_by: AGENT }]]);
  state.members = new Map([[`${P}:${DEV}`, 'developer'], [`${P}:${LEAD}`, 'lead_developer'], [`${P}:${AGENT}`, 'watcher']]);
  state.keys = new Map(); state.secrets = []; state.audit = []; state.thread = []; state.nextId = 1;
});

async function seed() {
  expect((await add(HR, { environment: 'development', key: 'DB_URL', value: 'postgres://dev-secret' })).status).toBe(200);
  expect((await add(HR, { environment: 'production', key: 'STRIPE_KEY', value: 'sk_live_prod_secret' })).status).toBe(200);
  return {
    dev: state.secrets.find((s) => s.key_name === 'DB_URL').id as number,
    prod: state.secrets.find((s) => s.key_name === 'STRIPE_KEY').id as number,
  };
}

// ------------------------------------------------------------ tests
describe('Project Env access', () => {
  it('stores values encrypted, never in plain text', async () => {
    await seed();
    for (const s of state.secrets) {
      expect(s.ciphertext.toString('utf8')).not.toMatch(/dev-secret|prod_secret/);
    }
  });

  it('an agent cannot list, read, add or download — even the agent who opened the project', async () => {
    const { dev } = await seed();
    expect((await list(AGENT)).status).toBe(403);
    expect((await value(AGENT, dev, 'reveal')).status).toBe(403);
    expect((await add(AGENT, { environment: 'development', key: 'X', value: 'y' })).status).toBe(403);
    expect((await exportEnv(AGENT, 'development')).status).toBe(403);
  });

  it('a developer not on the project gets nothing', async () => {
    const { dev } = await seed();
    expect((await list(OUTSIDER)).status).toBe(404);
    expect((await value(OUTSIDER, dev)).status).toBe(404);
  });

  it('a project developer can copy Development but not Production', async () => {
    const { dev, prod } = await seed();
    const r = await json(await value(DEV, dev));
    expect(r.status).toBe(200);
    expect(r.body.data.value).toBe('postgres://dev-secret');
    expect((await value(DEV, prod)).status).toBe(403);
    expect((await list(DEV, 'production')).status).toBe(403);
    expect((await exportEnv(DEV, 'production')).status).toBe(403);
  });

  it('the lead developer can use Production', async () => {
    const { prod } = await seed();
    const r = await json(await value(LEAD, prod, 'reveal'));
    expect(r.body.data.value).toBe('sk_live_prod_secret');
  });

  it('removing a developer from the project cuts access on the very next request', async () => {
    const { dev } = await seed();
    expect((await value(DEV, dev)).status).toBe(200);
    state.members.delete(`${P}:${DEV}`);
    expect((await value(DEV, dev)).status).toBe(404);
    expect((await list(DEV)).status).toBe(404);
  });

  it('a deactivated user is refused', async () => {
    const { dev } = await seed();
    state.users.delete(DEV);
    expect((await value(DEV, dev)).status).toBe(401);
  });
});

describe('Project Env never leaks values', () => {
  it('the list returns names and notes only', async () => {
    await seed();
    const r = await json(await list(HR));
    expect(r.body.data.secrets.map((s: any) => s.key_name)).toEqual(['DB_URL']);
    expect(JSON.stringify(r.body)).not.toContain('dev-secret');
    expect(Object.keys(r.body.data.secrets[0])).not.toContain('ciphertext');
  });

  it('every copy, reveal and download is audited, and neither audit nor thread holds a value', async () => {
    const { dev } = await seed();
    await value(DEV, dev, 'copy');
    await value(DEV, dev, 'reveal');
    await exportEnv(DEV, 'development');
    expect(state.audit.filter((a) => a.user_id === DEV).map((a) => a.action)).toEqual(['copy', 'reveal', 'download']);
    const blob = JSON.stringify(state.audit) + state.thread.join('\n');
    expect(blob).not.toMatch(/dev-secret|prod_secret/);
    expect(state.thread.join('\n')).toContain('DB_URL');
  });
});

describe('Project Env editing', () => {
  it('imports a pasted .env with a dry-run preview first', async () => {
    await seed();
    const dotenv = 'DB_URL=postgres://dev-secret\nNEW_KEY=1\n';
    const preview = await json(await add(DEV, { environment: 'development', dotenv: dotenv + 'DB_URL=changed\n', dry_run: true }));
    expect(preview.body.data.plan).toEqual([{ key: 'NEW_KEY', status: 'new' }, { key: 'DB_URL', status: 'changed' }]);
    expect(state.secrets.length).toBe(2); // nothing saved by the preview
    expect(JSON.stringify(preview.body)).not.toContain('dev-secret');

    const done = await json(await add(DEV, { environment: 'development', dotenv }));
    expect(done.body.data).toMatchObject({ created: 1, updated: 0, unchanged: 1 });
  });

  it('a renamed variable still decrypts (it is re-encrypted under its new name)', async () => {
    const { dev } = await seed();
    const r = await itemRoute.PATCH(req(DEV, `/api/projects/${P}/env/${dev}`, 'PATCH', { key: 'DATABASE_URL' }), { params: { id: String(P), secretId: String(dev) } });
    expect(r.status).toBe(200);
    expect((await json(await value(DEV, dev))).body.data).toEqual({ key: 'DATABASE_URL', value: 'postgres://dev-secret' });
  });

  it('the .env download contains the values for an allowed user', async () => {
    await seed();
    const r = await exportEnv(DEV, 'development');
    expect(r.headers.get('Content-Disposition')).toContain('PRJ-0010.development.env');
    expect(await r.text()).toContain('DB_URL=postgres://dev-secret');
  });

  it('refuses to work without VAULT_MASTER_KEY', async () => {
    delete process.env.VAULT_MASTER_KEY;
    const r = await json(await add(HR, { environment: 'development', key: 'A', value: 'b' }));
    expect(r.status).toBe(503);
    expect(r.body.message).toMatch(/VAULT_MASTER_KEY/);
  });
});
