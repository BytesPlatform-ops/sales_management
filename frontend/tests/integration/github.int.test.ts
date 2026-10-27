/**
 * GitHub tracking, manual work updates, health and dashboards — end to end through
 * the real routes and SQL, with a fake GitHub client (no network).
 */
import { randomBytes } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { assertSafeDb, resetDb, tokenFor } from './db';

assertSafeDb();
process.env.MEDIA_STORAGE = 'local';
process.env.VAULT_MASTER_KEY = process.env.VAULT_MASTER_KEY || randomBytes(32).toString('base64');
process.env.GITHUB_WEBHOOK_SECRET = 'hook-secret';
process.env.GITHUB_CLIENT_ID = 'client-id';

import { pool, query, queryOne } from '@/lib/db';
import { setGitHubClient, GitHubClient } from '@/lib/github/client';
import { signBody } from '@/lib/github/rules';
import { runGithubQueue } from '@/lib/github/process';
import { syncAllRepoAccess } from '@/lib/github/access';
import { refreshHealth } from '@/lib/activity';
import { runWorkUpdateReminders } from '@/lib/work-updates';
import { linkState } from '@/lib/github/link';
import * as webhook from '@/app/api/github/webhook/route';
import * as repoRoute from '@/app/api/projects/[id]/repo/route';
import * as trackingRoute from '@/app/api/projects/[id]/tracking/route';
import * as activityRoute from '@/app/api/projects/[id]/activity/route';
import * as workUpdates from '@/app/api/projects/[id]/work-updates/route';
import * as members from '@/app/api/projects/[id]/members/route';
import * as projectTickets from '@/app/api/projects/[id]/tickets/route';
import * as ticketRoute from '@/app/api/tickets/[id]/route';
import * as triage from '@/app/api/tickets/[id]/triage/route';
import * as relations from '@/app/api/tickets/[id]/relations/route';
import * as connect from '@/app/api/profile/github/connect/route';
import * as callback from '@/app/api/profile/github/callback/route';
import * as overview from '@/app/api/overview/route';
import * as uploadUrl from '@/app/api/media/upload-url/route';

// ------------------------------------------------------------------ fake GitHub
const calls: string[] = [];
let nextRepoId = 9000;
const ghUsers: Record<string, { id: number; login: string }> = {};
const fake: GitHubClient = {
  configured: () => true,
  async createOrgRepo(name) { calls.push(`create:${name}`); const id = ++nextRepoId; return { id, full_name: `org/${name}`, html_url: `https://github.com/org/${name}`, default_branch: 'main' }; },
  async getRepo(full) { calls.push(`get:${full}`); return { id: ++nextRepoId, full_name: full, html_url: `https://github.com/${full}`, default_branch: 'main' }; },
  async addCollaborator(full, login, perm) { calls.push(`add:${full}:${login}:${perm}`); },
  async removeCollaborator(full, login) { calls.push(`remove:${full}:${login}`); },
  oauthAuthorizeUrl: (state) => `https://github.com/login/oauth/authorize?state=${state}`,
  async oauthExchange(code) { if (!ghUsers[code]) throw new Error('bad code'); return `tok-${code}`; },
  async getAuthenticatedUser(tok) { return ghUsers[tok.replace('tok-', '')]; },
};

type Who = 'hr' | 'agent' | 'otherAgent' | 'dev' | 'lead' | 'dev2' | 'helper' | 'manualDev';
const U = {} as Record<Who, number>;
const T = {} as Record<Who, string>;
const NO_CTX = {} as any;
let P = 0;         // GitHub-tracked project
let Q = 0;         // another project (its keys must never move P's tickets and vice versa)
let M = 0;         // manual-tracking project
let REPO_ID = 0;
let deliveries = 0;

function req(who: Who | null, url: string, method = 'GET', body?: unknown) {
  return new NextRequest(`http://test${url}`, {
    method,
    headers: { ...(who ? { authorization: `Bearer ${T[who]}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
async function call(res: Promise<Response> | Response) {
  const r = await res;
  return { status: r.status, body: await r.json().catch(() => null), headers: r.headers };
}
const p = (id: number) => ({ params: { id: String(id) } });
const ticketKey = (n: number, proj = P) => `PRJ-${String(proj).padStart(4, '0')}-T${n}`;
const status = async (id: number) => (await queryOne<{ status: string }>(`SELECT status FROM tickets WHERE id = $1`, [id]))!.status;
const projectStatus = async (id: number) => (await queryOne<{ status: string }>(`SELECT status FROM projects WHERE id = $1`, [id]))!.status;
const notes = (user: number, type: string) => query<{ body: string }>(`SELECT body FROM notifications_inbox WHERE user_id = $1 AND type = $2`, [user, type]);
const newTicket = async (who: Who, body: any, proj = P) => (await call(projectTickets.POST(req(who, `/api/projects/${proj}/tickets`, 'POST', body), p(proj)))).body.data;

function hook(event: string, payload: any, opts: { delivery?: string; sig?: string } = {}) {
  const raw = JSON.stringify(payload);
  const id = opts.delivery || `d-${++deliveries}`;
  return new NextRequest('http://test/api/github/webhook', {
    method: 'POST', body: raw,
    headers: { 'content-type': 'application/json', 'x-github-event': event, 'x-github-delivery': id,
      'x-hub-signature-256': opts.sig ?? signBody('hook-secret', raw) },
  });
}
const repo = () => ({ id: REPO_ID, full_name: 'org/repo', html_url: 'https://github.com/org/repo' });
const sender = { id: 501, login: 'dani-gh' };
async function deliver(event: string, payload: any, delivery?: string) {
  const r = await call(webhook.POST(hook(event, { repository: repo(), sender, ...payload }, { delivery })));
  expect(r.status).toBe(202);
  await runGithubQueue();
  return r;
}
async function waitFor(fn: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!fn() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
}

afterAll(async () => { setGitHubClient(null); await pool.end(); });

beforeAll(async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-secret';
  setGitHubClient(fake);
  await resetDb();
  const roles: [Who, string][] = [['hr', 'hr'], ['agent', 'agent'], ['otherAgent', 'agent'], ['dev', 'developer'], ['lead', 'developer'],
    ['dev2', 'developer'], ['helper', 'developer'], ['manualDev', 'developer']];
  for (const [k, role] of roles) {
    const row = await queryOne<{ id: string }>(`INSERT INTO users (username, full_name, role) VALUES ($1, $2, $3) RETURNING id`, [k.toLowerCase(), `${k} name`, role]);
    U[k] = Number(row!.id);
    T[k] = await tokenFor({ id: U[k], username: k.toLowerCase(), role });
  }
  const mk = async (title: string, agent: number) =>
    (await queryOne<{ id: number }>(`INSERT INTO projects (title, client_name, client_company, created_by, supervisor_id) VALUES ($1, 'Acme', 'Acme Dental', $2, $3) RETURNING id`, [title, agent, U.hr]))!.id;
  P = await mk('Acme site', U.agent);
  Q = await mk('Other site', U.otherAgent);
  M = await mk('Shopify store', U.agent);
  await query(`INSERT INTO project_members (project_id, user_id, member_role) VALUES ($1, $2, 'developer'), ($1, $3, 'lead_developer'), ($4, $2, 'developer'), ($5, $6, 'developer')`,
    [P, U.dev, U.lead, Q, M, U.manualDev]);
  // dev and dev2 have linked GitHub accounts; lead hasn't.
  await query(`INSERT INTO developer_github (user_id, github_user_id, github_login) VALUES ($1, 501, 'dani-gh'), ($2, 502, 'dev2-gh'), ($3, 503, 'helper-gh')`, [U.dev, U.dev2, U.helper]);
});

// ------------------------------------------------------------------ webhook
describe('webhook', () => {
  it('rejects a missing or wrong signature', async () => {
    expect((await call(webhook.POST(hook('push', { a: 1 }, { sig: 'sha256=deadbeef' })))).status).toBe(401);
    expect((await call(webhook.POST(hook('push', { a: 1 }, { sig: '' })))).status).toBe(401);
  });

  it('stores each delivery once: a redelivery is a no-op', async () => {
    const a = await call(webhook.POST(hook('push', { repository: { id: 1 } }, { delivery: 'same-1' })));
    const b = await call(webhook.POST(hook('push', { repository: { id: 1 } }, { delivery: 'same-1' })));
    expect(a.body.data).toEqual({ queued: true, duplicate: false });
    expect(b.body.data).toEqual({ queued: false, duplicate: true });
    expect((await query(`SELECT 1 FROM github_events WHERE delivery_id = 'same-1'`)).length).toBe(1);
  });

  it('ignores events it does not handle and repos it does not know', async () => {
    await call(webhook.POST(hook('issues', { repository: { id: 1 } }, { delivery: 'iss-1' })));
    expect((await queryOne<{ status: string }>(`SELECT status FROM github_events WHERE delivery_id = 'iss-1'`))!.status).toBe('ignored');
    await runGithubQueue();
    expect((await queryOne<{ status: string }>(`SELECT status FROM github_events WHERE delivery_id = 'same-1'`))!.status).toBe('ignored');
  });
});

// ------------------------------------------------------------------ repos & access
describe('repos and repo access', () => {
  it('only HR can create the repo; it is named after the project and client and linked developers get write access', async () => {
    expect((await call(repoRoute.POST(req('agent', `/api/projects/${P}/repo`, 'POST', { action: 'create' }), p(P)))).status).toBe(403);
    expect((await call(repoRoute.POST(req('dev', `/api/projects/${P}/repo`, 'POST', { action: 'create' }), p(P)))).status).toBe(403);
    const r = await call(repoRoute.POST(req('hr', `/api/projects/${P}/repo`, 'POST', { action: 'create' }), p(P)));
    expect(r.status).toBe(200);
    REPO_ID = r.body.data.repo.id;
    expect(calls).toContain(`create:${ticketKey(0).replace('-T0', '')}-acme-dental`);
    expect(calls).toContain(`add:${r.body.data.repo.full_name}:dani-gh:push`);
    expect(calls.some((c) => c.includes('lead'))).toBe(false); // lead has no linked account
    expect((await queryOne<{ tracking_source: string }>(`SELECT tracking_source FROM projects WHERE id = $1`, [P]))!.tracking_source).toBe('github');
    // A second repo for the same project is refused.
    expect((await call(repoRoute.POST(req('hr', `/api/projects/${P}/repo`, 'POST', { action: 'create' }), p(P)))).status).toBe(409);
  });

  it('adding and removing a member adds and removes repo access', async () => {
    calls.length = 0;
    await call(members.POST(req('hr', `/api/projects/${P}/members`, 'POST', { user_id: U.dev2 }), p(P)));
    await waitFor(() => calls.some((c) => c.includes('dev2-gh')));
    expect(calls.some((c) => c.endsWith(':dev2-gh:push'))).toBe(true);
    calls.length = 0;
    await call(members.DELETE(req('hr', `/api/projects/${P}/members?user_id=${U.dev2}`, 'DELETE'), p(P)));
    await waitFor(() => calls.some((c) => c.startsWith('remove:')));
    expect(calls.some((c) => c.startsWith('remove:') && c.endsWith(':dev2-gh'))).toBe(true);
  });

  it('a temporary helper gets read access, which goes away when the grant expires', async () => {
    calls.length = 0;
    const g = await queryOne<{ id: number }>(
      `INSERT INTO access_grants (grantee_id, resource_type, resource_id, project_id, level, scope, granted_by, source, expires_at)
       VALUES ($1, 'project', $2, $3, 'comment', '{}'::jsonb, $4, 'help_request', NOW() + INTERVAL '1 day') RETURNING id`, [U.helper, String(P), P, U.dev]
    );
    await syncAllRepoAccess();
    expect(calls.some((c) => c.endsWith(':helper-gh:pull'))).toBe(true);
    calls.length = 0;
    await query(`UPDATE access_grants SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [g!.id]);
    await syncAllRepoAccess();
    expect(calls.some((c) => c.startsWith('remove:') && c.endsWith(':helper-gh'))).toBe(true);
  });
});

// ------------------------------------------------------------------ automatic status
describe('GitHub moves tickets and the project forward only', () => {
  const t: Record<string, any> = {};

  beforeAll(async () => {
    t.a = await newTicket('dev', { title: 'Login page' });                        // T1
    t.b = await newTicket('dev', { title: 'Booking', assignee_ids: [U.lead] });    // T2 — blocked by T1
    t.triage = await newTicket('agent', { title: 'From the client' });            // T3 — in Triage
    t.hrDone = await newTicket('dev', { title: 'Already done by hand' });         // T4
    t.cr = await newTicket('agent', { title: 'Add a blog', type: 'change_request' }); // T5
    await call(triage.POST(req('lead', `/api/tickets/${t.cr.id}/triage`, 'POST', { action: 'accept' }), p(t.cr.id)));
    await call(relations.POST(req('dev', `/api/tickets/${t.a.id}/relations`, 'POST', { relation: 'blocks', key: t.b.key }), p(t.a.id)));
    await call(ticketRoute.PATCH(req('hr', `/api/tickets/${t.hrDone.id}`, 'PATCH', { status: 'done' }), p(t.hrDone.id)));
    t.q = await newTicket('dev', { title: 'Other project ticket' }, Q);
  });

  it('a push on a branch with the key moves the ticket to In progress and the project out of New', async () => {
    expect(await projectStatus(P)).toBe('new');
    await deliver('push', { ref: `refs/heads/feature/${t.a.key}-login`, commits: [{ id: 'c1', message: `Start ${t.a.key}` }], compare: 'https://github.com/org/repo/compare/x' });
    expect(await status(t.a.id)).toBe('in_progress');
    expect(await projectStatus(P)).toBe('in_progress');
    const h = await queryOne<{ user_id: string | null; source: string }>(`SELECT user_id, source FROM ticket_history WHERE ticket_id = $1 AND field = 'status' ORDER BY id DESC LIMIT 1`, [t.a.id]);
    expect(h).toEqual({ user_id: null, source: 'github' });
    const act = await call(activityRoute.GET(req('agent', `/api/projects/${P}/activity`), p(P)));
    expect(act.body.data[0].summary).toMatch(/^dev name saved 1 change on feature\//);
  });

  it('keys from another project are ignored', async () => {
    await deliver('push', { ref: 'refs/heads/main', commits: [{ id: 'c2', message: `Touches ${t.q.key}` }] });
    expect(await status(t.q.id)).toBe('open');
  });

  it('Triage tickets and tickets already moved further by a person are left alone', async () => {
    await deliver('create', { ref_type: 'branch', ref: `feature/${t.triage.key}-x` });
    expect(await status(t.triage.id)).toBe('triage');
    await deliver('create', { ref_type: 'branch', ref: `feature/${t.hrDone.key}-x` });
    expect(await status(t.hrDone.id)).toBe('done');
  });

  it('a PR moves the ticket to In review and the project to In review; merging moves it to Done and unblocks', async () => {
    await deliver('pull_request', { action: 'opened', pull_request: { title: `${t.a.key} Login page`, html_url: 'https://github.com/org/repo/pull/1', head: { ref: 'feature/x' } } });
    expect(await status(t.a.id)).toBe('in_review');
    expect(await projectStatus(P)).toBe('review');
    await deliver('pull_request', { action: 'closed', pull_request: { title: `${t.a.key} Login page`, merged: true, html_url: 'https://github.com/org/repo/pull/1', head: { ref: 'feature/x' } } });
    expect(await status(t.a.id)).toBe('done');
    expect((await notes(U.lead, 'ticket_unblocked')).some((n) => n.body.includes(t.b.key))).toBe(true);
    expect((await notes(U.dev, 'ticket_done')).length + (await notes(U.dev, 'ticket_status')).length).toBeGreaterThan(0);
  });

  it('a late "opened" after the merge does not reopen it, and the project is never auto-delivered', async () => {
    await deliver('pull_request', { action: 'reopened', pull_request: { title: `${t.a.key} again`, head: { ref: 'x' } } });
    expect(await status(t.a.id)).toBe('done');
    expect(await projectStatus(P)).toBe('review');
  });

  it('a change request without HR approval does not move, and says why', async () => {
    await deliver('pull_request', { action: 'closed', pull_request: { title: `${t.cr.key} blog`, merged: true, head: { ref: 'x' } } });
    expect(await status(t.cr.id)).toBe('open');
    expect((await query(`SELECT 1 FROM project_activity WHERE ticket_id = $1 AND kind = 'cr_waiting'`, [t.cr.id])).length).toBe(1);
  });

  it('On hold projects get no automatic changes (activity is still recorded)', async () => {
    const x = await newTicket('dev', { title: 'Paused work' });
    await query(`UPDATE projects SET status = 'on_hold' WHERE id = $1`, [P]);
    const before = (await query(`SELECT 1 FROM project_activity WHERE project_id = $1`, [P])).length;
    await deliver('push', { ref: `refs/heads/feature/${x.key}`, commits: [{ id: 'c3', message: 'wip' }] });
    expect(await status(x.id)).toBe('open');
    expect(await projectStatus(P)).toBe('on_hold');
    expect((await query(`SELECT 1 FROM project_activity WHERE project_id = $1`, [P])).length).toBe(before + 1);
    await query(`UPDATE projects SET status = 'review' WHERE id = $1`, [P]);
  });
});

// ------------------------------------------------------------------ deploys
describe('deployments', () => {
  it('a production deploy tells HR "ready to deliver" once per deployment, and never delivers', async () => {
    const body = { deployment: { id: 77, environment: 'Production' }, deployment_status: { state: 'success', environment: 'production', environment_url: 'https://acme.example' } };
    await deliver('deployment_status', body);
    await deliver('deployment_status', body); // GitHub re-sends with a new delivery id
    expect((await notes(U.hr, 'ready_to_deliver')).length).toBe(1);
    expect(await projectStatus(P)).toBe('review');
  });

  it('a staging deploy records the preview link', async () => {
    await deliver('deployment_status', { deployment: { id: 78, environment: 'staging' }, deployment_status: { state: 'success', environment: 'staging', environment_url: 'https://staging.acme.example' } });
    expect((await queryOne<{ staging_url: string }>(`SELECT staging_url FROM projects WHERE id = $1`, [P]))!.staging_url).toBe('https://staging.acme.example');
  });

  it('the production environment name is configurable', async () => {
    await call(trackingRoute.PATCH(req('hr', `/api/projects/${P}/tracking`, 'PATCH', { production_env_name: 'live' }), p(P)));
    await deliver('deployment_status', { deployment: { id: 79, environment: 'live' }, deployment_status: { state: 'success', environment: 'live' } });
    expect((await notes(U.hr, 'ready_to_deliver')).length).toBe(2);
    expect((await call(trackingRoute.PATCH(req('dev', `/api/projects/${P}/tracking`, 'PATCH', { tracking_source: 'manual' }), p(P)))).status).toBe(403);
  });
});

// ------------------------------------------------------------------ retries
describe('failed processing is retried with backoff, then marked failed', () => {
  it('backs off after an error and gives up after the last attempt', async () => {
    await query(`ALTER TABLE project_activity RENAME TO project_activity_off`);
    try {
      await call(webhook.POST(hook('push', { repository: repo(), sender, ref: 'refs/heads/main', commits: [] }, { delivery: 'boom-1' })));
      await runGithubQueue();
      let e = await queryOne<{ status: string; attempts: number; error: string; due: boolean }>(
        `SELECT status, attempts, error, next_attempt_at > NOW() AS due FROM github_events WHERE delivery_id = 'boom-1'`);
      expect(e).toMatchObject({ status: 'pending', attempts: 1, due: true });
      expect(e!.error).toMatch(/project_activity/);
      await query(`UPDATE github_events SET attempts = 5, next_attempt_at = NOW() WHERE delivery_id = 'boom-1'`);
      await runGithubQueue();
      e = await queryOne(`SELECT status, attempts FROM github_events WHERE delivery_id = 'boom-1'`);
      expect(e).toMatchObject({ status: 'failed', attempts: 6 });
    } finally {
      await query(`ALTER TABLE project_activity_off RENAME TO project_activity`);
    }
  });
});

// ------------------------------------------------------------------ health
describe('project health', () => {
  it('green → yellow → red with time; HR is told once when it turns red', async () => {
    await query(`UPDATE projects SET last_activity_at = NOW() - INTERVAL '4 days', deadline = NULL WHERE id = $1`, [Q]);
    await refreshHealth([Q]);
    expect((await queryOne<{ health: string }>(`SELECT health FROM projects WHERE id = $1`, [Q]))!.health).toBe('yellow');
    await query(`UPDATE projects SET last_activity_at = NOW() - INTERVAL '8 days' WHERE id = $1`, [Q]);
    await refreshHealth([Q]);
    await refreshHealth([Q]);
    expect((await queryOne<{ health: string }>(`SELECT health FROM projects WHERE id = $1`, [Q]))!.health).toBe('red');
    expect((await notes(U.hr, 'project_red')).filter((n) => n.body.includes('Other site')).length).toBe(1);
  });

  it('a project past its deadline is red even with fresh activity; new activity turns a quiet project green', async () => {
    await query(`UPDATE projects SET last_activity_at = NOW(), deadline = CURRENT_DATE - 2 WHERE id = $1`, [M]);
    await refreshHealth([M]);
    expect((await queryOne<{ health: string }>(`SELECT health FROM projects WHERE id = $1`, [M]))!.health).toBe('red');
    await query(`UPDATE projects SET deadline = NULL WHERE id = $1`, [M]);
    await query(`UPDATE projects SET last_activity_at = NOW() - INTERVAL '8 days' WHERE id = $1`, [Q]);
    await deliverToQ();
    expect((await queryOne<{ health: string }>(`SELECT health FROM projects WHERE id = $1`, [Q]))!.health).toBe('green');
  });
});

async function deliverToQ() {
  // A work update on Q counts as activity.
  await call(workUpdates.POST(req('dev', `/api/projects/${Q}/work-updates`, 'POST', { body: 'Fixed the menu' }), p(Q)));
}

// ------------------------------------------------------------------ manual tracking
describe('manual tracking', () => {
  it('only the project’s developers and HR post work updates; status moves follow ticket rules', async () => {
    expect((await call(workUpdates.POST(req('agent', `/api/projects/${M}/work-updates`, 'POST', { body: 'x' }), p(M)))).status).toBe(403);
    expect((await call(workUpdates.POST(req('dev', `/api/projects/${M}/work-updates`, 'POST', { body: 'x' }), p(M)))).status).toBe(404);
    const tk = await newTicket('manualDev', { title: 'Theme setup' }, M);
    const r = await call(workUpdates.POST(req('manualDev', `/api/projects/${M}/work-updates`, 'POST',
      { body: 'Installed the theme\nWaiting on logo', ticket_ids: [tk.id], status_moves: [{ ticket_id: tk.id, status: 'in_progress' }] }), p(M)));
    expect(r.status).toBe(200);
    expect(r.body.data.moves).toEqual([{ ticket_id: tk.id, ok: true }]);
    expect(await status(tk.id)).toBe('in_progress');
    const act = await call(activityRoute.GET(req('agent', `/api/projects/${M}/activity`), p(M)));
    expect(act.body.data.some((a: any) => a.summary === 'manualDev name posted an update: Installed the theme')).toBe(true);
    // Files on your own update only.
    const up = (who: Who) => call(uploadUrl.POST(req(who, '/api/media/upload-url', 'POST',
      { entity_type: 'work_update', entity_id: r.body.data.id, file_name: 'a.png', mime_type: 'image/png', size_bytes: 4 }), NO_CTX));
    expect((await up('manualDev')).status).toBe(200);
    expect((await up('hr')).status).toBe(200);
    expect((await up('agent')).status).toBe(403);
  });

  it('the 18:00 reminder goes only to developers on manual projects with no update today, once', async () => {
    await query(`DELETE FROM work_updates WHERE project_id = $1`, [M]);
    await query(`UPDATE projects SET tracking_source = 'manual', status = 'in_progress' WHERE id = $1`, [M]);
    const at = new Date(Date.now());
    expect(await runWorkUpdateReminders(at)).toBe(1);
    expect(await runWorkUpdateReminders(at)).toBe(0);
    expect((await notes(U.manualDev, 'work_update_reminder')).length).toBe(1);
    expect((await notes(U.dev, 'work_update_reminder')).length).toBe(0);   // P is a GitHub project
  });

  it('no reminder once you have posted today', async () => {
    await query(`DELETE FROM notification_once WHERE key LIKE 'work-update-reminder:%'`);
    await call(workUpdates.POST(req('manualDev', `/api/projects/${M}/work-updates`, 'POST', { body: 'Done for today' }), p(M)));
    expect(await runWorkUpdateReminders(new Date())).toBe(0);
  });
});

// ------------------------------------------------------------------ GitHub account linking
describe('linking a GitHub account', () => {
  it('returns an authorize URL with a signed state, and the callback links the account', async () => {
    ghUsers.goodcode = { id: 777, login: 'lead-gh' };
    const r = await call(connect.POST(req('lead', '/api/profile/github/connect', 'POST'), NO_CTX));
    const state = new URL(r.body.data.url).searchParams.get('state')!;
    const cb = await callback.GET(new NextRequest(`http://test/api/profile/github/callback?code=goodcode&state=${encodeURIComponent(state)}`));
    expect(cb.headers.get('location')).toMatch(/github=linked/);
    expect((await queryOne<{ github_login: string }>(`SELECT github_login FROM developer_github WHERE user_id = $1`, [U.lead]))!.github_login).toBe('lead-gh');
  });

  it('rejects a tampered or foreign state, and an account already linked to someone else', async () => {
    const state = await linkState(U.dev2);
    const tampered = state.slice(0, -2) + (state.endsWith('a') ? 'bb' : 'aa');
    const bad = await callback.GET(new NextRequest(`http://test/api/profile/github/callback?code=goodcode&state=${encodeURIComponent(tampered)}`));
    expect(bad.headers.get('location')).toMatch(/github=error/);
    ghUsers.taken = { id: 501, login: 'dani-gh' }; // already dev's
    const dup = await callback.GET(new NextRequest(`http://test/api/profile/github/callback?code=taken&state=${encodeURIComponent(state)}`));
    expect(dup.headers.get('location')).toMatch(/github=error.*already/);
    expect((await call(connect.POST(req('agent', '/api/profile/github/connect', 'POST'), NO_CTX))).status).toBe(403);
  });
});

// ------------------------------------------------------------------ dashboards
describe('role dashboards', () => {
  it('developer: my tasks and my projects only', async () => {
    const r = await call(overview.GET(req('dev', '/api/overview'), NO_CTX));
    expect(r.body.data.role).toBe('developer');
    expect(r.body.data.projects.map((x: any) => x.id).sort()).toEqual([P, Q].sort());
  });

  it('agent: only their clients’ projects, with the latest plain-language update', async () => {
    const r = await call(overview.GET(req('agent', '/api/overview'), NO_CTX));
    expect(r.body.data.projects.map((x: any) => x.id)).not.toContain(Q);
    const acme = r.body.data.projects.find((x: any) => x.id === P);
    expect(acme.latest.summary).toBeTruthy();
  });

  it('HR: every project by health, ready to deliver, change requests waiting, developer workload', async () => {
    await query(`UPDATE projects SET last_activity_at = NOW() - INTERVAL '9 days' WHERE id = $1`, [Q]);
    await refreshHealth([Q]);
    const r = await call(overview.GET(req('hr', '/api/overview'), NO_CTX));
    expect(r.body.data.role).toBe('hr');
    expect(r.body.data.ready_to_deliver.map((x: any) => x.id)).toContain(P);
    expect(r.body.data.change_requests.length).toBeGreaterThan(0);
    expect(r.body.data.workload.find((w: any) => Number(w.id) === U.lead).open_tickets).toBeGreaterThan(0);
    expect(r.body.data.projects[0].id).toBe(Q); // red first
    expect(r.body.data.projects[0].health).toBe('red');
  });
});
