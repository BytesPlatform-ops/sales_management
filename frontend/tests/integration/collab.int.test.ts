/**
 * Collaboration & scoped access, end to end: help requests with temporary access,
 * ticket/file/vault shares, revocation and expiry, handoff notes, review round-robin,
 * out of office, guest developers — and that search never leaks outside grants.
 */
import { randomBytes } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { assertSafeDb, resetDb, tokenFor } from './db';

assertSafeDb();
process.env.MEDIA_STORAGE = 'local';
process.env.VAULT_MASTER_KEY = process.env.VAULT_MASTER_KEY || randomBytes(32).toString('base64');

import { pool, query, queryOne } from '@/lib/db';
import { expireGrants } from '@/lib/collab/expiry';
import * as projectRoute from '@/app/api/projects/[id]/route';
import * as projectsList from '@/app/api/projects/route';
import * as projectTickets from '@/app/api/projects/[id]/tickets/route';
import * as bulk from '@/app/api/projects/[id]/tickets/bulk/route';
import * as ticketRoute from '@/app/api/tickets/[id]/route';
import * as comments from '@/app/api/tickets/[id]/comments/route';
import * as assignees from '@/app/api/tickets/[id]/assignees/route';
import * as helpCreate from '@/app/api/tickets/[id]/help/route';
import * as collab from '@/app/api/tickets/[id]/collab/route';
import * as reviewsCreate from '@/app/api/tickets/[id]/reviews/route';
import * as reviewDecide from '@/app/api/reviews/[id]/route';
import * as helpList from '@/app/api/help-requests/route';
import * as helpAct from '@/app/api/help-requests/[id]/route';
import * as shares from '@/app/api/shares/route';
import * as shareOne from '@/app/api/shares/[id]/route';
import * as shareApprove from '@/app/api/shares/[id]/approve/route';
import * as profile from '@/app/api/profile/route';
import * as availability from '@/app/api/profile/availability/route';
import * as hrDevProfile from '@/app/api/hr/developers/[id]/profile/route';
import * as milestones from '@/app/api/projects/[id]/milestones/route';
import * as messages from '@/app/api/projects/[id]/messages/route';
import * as envList from '@/app/api/projects/[id]/env/route';
import * as envValue from '@/app/api/projects/[id]/env/[secretId]/value/route';
import * as search from '@/app/api/search/route';
import * as uploadUrl from '@/app/api/media/upload-url/route';
import * as complete from '@/app/api/media/[id]/complete/route';
import * as mediaUrl from '@/app/api/media/[id]/url/route';
import * as localMedia from '@/app/api/media/local/route';

const NO_CTX = {} as any;
type Who = 'hr' | 'agent' | 'dev' | 'lead' | 'dev2' | 'helper' | 'other' | 'guest';
const U = {} as Record<Who, number>;
const T = {} as Record<Who, string>;
let P = 0;
const SECRET: Record<string, number> = {};

function req(who: Who, url: string, method = 'GET', body?: unknown) {
  return new NextRequest(`http://test${url}`, {
    method,
    headers: { authorization: `Bearer ${T[who]}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
async function call(res: Promise<Response> | Response) {
  const r = await res;
  return { status: r.status, body: await r.json().catch(() => null) };
}
const p = (id: number) => ({ params: { id: String(id) } });
const getProject = (who: Who) => call(projectRoute.GET(req(who, `/api/projects/${P}`), p(P)));
const getTicket = (who: Who, id: number) => call(ticketRoute.GET(req(who, `/api/tickets/${id}`), p(id)));
const comment = (who: Who, id: number) => call(comments.POST(req(who, `/api/tickets/${id}/comments`, 'POST', { body: 'hello' }), p(id)));
const envGet = (who: Who, env: string) => call(envList.GET(req(who, `/api/projects/${P}/env?environment=${env}`), p(P)));
const reveal = (who: Who, sid: number) =>
  call(envValue.POST(req(who, `/api/projects/${P}/env/${sid}/value`, 'POST', { action: 'reveal' }), { params: { id: String(P), secretId: String(sid) } }));
const searchQ = (who: Who, q: string) => call(search.GET(req(who, `/api/search?q=${encodeURIComponent(q)}&limit=50`), NO_CTX));
const notes = (user: number, type: string) => query(`SELECT body FROM notifications_inbox WHERE user_id = $1 AND type = $2`, [user, type]);
const newTicket = async (who: Who, title: string) => (await call(projectTickets.POST(req(who, `/api/projects/${P}/tickets`, 'POST', { title }), p(P)))).body.data;
const share = (who: Who, body: any) => call(shares.POST(req(who, '/api/shares', 'POST', body), NO_CTX));

afterAll(() => pool.end());

beforeAll(async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-secret';
  await resetDb();
  const roles: [Who, string][] = [['hr', 'hr'], ['agent', 'agent'], ['dev', 'developer'], ['lead', 'developer'], ['dev2', 'developer'],
    ['helper', 'developer'], ['other', 'developer'], ['guest', 'developer']];
  for (const [k, role] of roles) {
    const row = await queryOne<{ id: string }>(`INSERT INTO users (username, full_name, role) VALUES ($1, $2, $3) RETURNING id`, [k, `${k} name`, role]);
    U[k] = Number(row!.id);
    T[k] = await tokenFor({ id: U[k], username: k, role });
  }
  P = (await queryOne<{ id: number }>(`INSERT INTO projects (title, client_name, created_by, supervisor_id) VALUES ('Zeta shop', 'Zeta', $1, $2) RETURNING id`, [U.agent, U.hr]))!.id;
  await query(`INSERT INTO project_members (project_id, user_id, member_role) VALUES ($1, $2, 'developer'), ($1, $3, 'lead_developer'), ($1, $4, 'developer')`,
    [P, U.dev, U.lead, U.dev2]);
  await query(`INSERT INTO developer_profiles (user_id, skills) VALUES ($1, '{react,node}'), ($2, '{php}'), ($3, '{react}')`, [U.helper, U.other, U.guest]);
  await query(`UPDATE developer_profiles SET is_guest = true WHERE user_id = $1`, [U.guest]);
  for (const env of ['development', 'staging', 'production']) {
    const r = await call(envList.POST(req('hr', `/api/projects/${P}/env`, 'POST', { environment: env, key: `${env.toUpperCase()}_DB`, value: `${env}-secret-value` }), p(P)));
    SECRET[env] = r.body.data.id;
  }
});

describe('help requests give temporary, limited access', () => {
  let ticket: any;
  let helpId = 0;

  it('a developer outside the project sees nothing beforehand', async () => {
    ticket = await newTicket('dev', 'Checkout bug');
    expect((await getProject('helper')).status).toBe(404);
    expect((await getTicket('helper', ticket.id)).status).toBe(404);
  });

  it('asking by skill notifies matching developers, never guests or people without the skill', async () => {
    const r = await call(helpCreate.POST(req('dev', `/api/tickets/${ticket.id}/help`, 'POST', { message: 'React state issue', skills: ['React'] }), p(ticket.id)));
    expect(r.status).toBe(200);
    helpId = r.body.data.id;
    expect(r.body.data.asked).toEqual([U.helper]);
    expect((await notes(U.helper, 'help_request')).length).toBe(1);
    expect((await notes(U.other, 'help_request')).length).toBe(0);
    expect((await notes(U.guest, 'help_request')).length).toBe(0);
    const forHelper = await call(helpList.GET(req('helper', '/api/help-requests'), NO_CTX));
    expect(forHelper.body.data.map((h: any) => h.id)).toContain(helpId);
    const forOther = await call(helpList.GET(req('other', '/api/help-requests'), NO_CTX));
    expect(forOther.body.data.map((h: any) => h.id)).not.toContain(helpId);
  });

  it('agents and outsiders cannot ask for help; others cannot accept', async () => {
    expect((await call(helpCreate.POST(req('agent', `/api/tickets/${ticket.id}/help`, 'POST', { message: 'x', skills: ['react'] }), p(ticket.id)))).status).toBe(403);
    expect((await call(helpAct.POST(req('other', `/api/help-requests/${helpId}`, 'POST', { action: 'accept' }), p(helpId)))).status).toBe(403);
  });

  it('the helper who accepts reads the project and Development secrets, and can comment', async () => {
    const r = await call(helpAct.POST(req('helper', `/api/help-requests/${helpId}`, 'POST', { action: 'accept' }), p(helpId)));
    expect(r.status).toBe(200);
    expect(r.body.data.grant_id).toBeTruthy();
    const proj = await getProject('helper');
    expect(proj.status).toBe(200);
    expect(proj.body.data.permissions.grant.level).toBe('comment');
    expect(proj.body.data.permissions.env).toEqual({ development: true, staging: false, production: false });
    expect((await getTicket('helper', ticket.id)).status).toBe(200);
    expect((await comment('helper', ticket.id)).status).toBe(200);
    expect((await call(messages.POST(req('helper', `/api/projects/${P}/messages`, 'POST', { body: 'looking now' }), p(P)))).status).toBe(200);
    expect((await envGet('helper', 'development')).status).toBe(200);
    expect((await reveal('helper', SECRET.development)).body.data.value).toBe('development-secret-value');
    const audit = await queryOne<{ grant_id: number }>(`SELECT grant_id FROM vault_audit WHERE user_id = $1 AND action = 'reveal'`, [U.helper]);
    expect(audit!.grant_id).toBe(r.body.data.grant_id);
  });

  it('…but never Staging/Production secrets, and can change nothing', async () => {
    expect((await envGet('helper', 'staging')).status).toBe(403);
    expect((await reveal('helper', SECRET.staging)).status).toBe(403);
    expect((await reveal('helper', SECRET.production)).status).toBe(403);
    expect((await call(envList.POST(req('helper', `/api/projects/${P}/env`, 'POST', { environment: 'development', key: 'X', value: 'y' }), p(P)))).status).toBe(403);
    expect((await call(ticketRoute.PATCH(req('helper', `/api/tickets/${ticket.id}`, 'PATCH', { status: 'in_progress' }), p(ticket.id)))).status).toBe(403);
    expect((await call(projectTickets.POST(req('helper', `/api/projects/${P}/tickets`, 'POST', { title: 'new' }), p(P)))).status).toBe(403);
    expect((await call(milestones.POST(req('helper', `/api/projects/${P}/milestones`, 'POST', { title: 'M', due_date: '2026-12-01' }), p(P)))).status).toBe(403);
  });

  it('search covers the project only while access lasts', async () => {
    const r = await searchQ('helper', 'Checkout');
    expect(JSON.stringify(r.body)).toContain('Checkout bug');
  });

  it('the lead (not the requester or helper) can extend it', async () => {
    expect((await call(helpAct.POST(req('helper', `/api/help-requests/${helpId}`, 'POST', { action: 'extend' }), p(helpId)))).status).toBe(403);
    const r = await call(helpAct.POST(req('lead', `/api/help-requests/${helpId}`, 'POST', { action: 'extend', days: 2 }), p(helpId)));
    expect(r.status).toBe(200);
  });

  it('when the time runs out, access stops by itself; the job closes the request and tells people', async () => {
    await query(`UPDATE access_grants SET expires_at = NOW() - INTERVAL '1 minute' WHERE grantee_id = $1`, [U.helper]);
    expect((await getProject('helper')).status).toBe(404);
    expect((await getTicket('helper', ticket.id)).status).toBe(404);
    expect((await envGet('helper', 'development')).status).toBe(404);
    expect((await reveal('helper', SECRET.development)).status).toBe(404);
    expect(JSON.stringify((await searchQ('helper', 'Checkout')).body)).not.toContain('Checkout bug');
    const list = await call(projectsList.GET(req('helper', '/api/projects?view=all'), NO_CTX));
    expect(JSON.stringify(list.body)).not.toContain('Zeta shop');
    expect(await expireGrants()).toBeGreaterThan(0);
    expect((await queryOne<{ status: string }>(`SELECT status FROM help_requests WHERE id = $1`, [helpId]))!.status).toBe('expired');
    expect((await notes(U.helper, 'access_expired')).length).toBe(1);
    expect(await expireGrants()).toBe(0); // marked once
  });
});

describe('sharing one ticket gives that ticket only', () => {
  let t1: any, t2: any, shareId = 0, fileId = '';

  it('shares a ticket (view) — other tickets and the project stay hidden', async () => {
    t1 = await newTicket('dev', 'Visible ticket');
    t2 = await newTicket('dev', 'Hidden ticket');
    // a file on the shared ticket
    const up = await call(uploadUrl.POST(req('dev', '/api/media/upload-url', 'POST',
      { entity_type: 'ticket', entity_id: t1.id, file_name: 'a.png', mime_type: 'image/png', size_bytes: 3, description: 'shot' }), NO_CTX));
    await localMedia.PUT(new NextRequest(`http://test${up.body.data.upload.url}`, { method: 'PUT', body: new Uint8Array([1, 2, 3]) }), NO_CTX);
    await complete.POST(req('dev', `/api/media/${up.body.data.id}/complete`, 'POST', {}), { params: { id: up.body.data.id } });
    fileId = up.body.data.id;

    const r = await share('dev', { resource_type: 'ticket', resource_id: t1.id, grantee_id: U.other, level: 'view' });
    expect(r.status).toBe(200);
    shareId = r.body.data.id;
    expect((await getTicket('other', t1.id)).status).toBe(200);
    expect((await getTicket('other', t2.id)).status).toBe(404);
    expect((await getProject('other')).status).toBe(404);
    expect((await call(projectTickets.GET(req('other', `/api/projects/${P}/tickets`), p(P)))).status).toBe(404);
    expect((await call(mediaUrl.GET(req('other', `/api/media/${fileId}/url`), { params: { id: fileId } }))).status).toBe(200);
    expect(JSON.stringify((await searchQ('other', 'Hidden')).body)).not.toContain('Hidden ticket');
  });

  it('view level cannot comment or edit; agents cannot be given shares', async () => {
    expect((await comment('other', t1.id)).status).toBe(403);
    expect((await call(ticketRoute.PATCH(req('other', `/api/tickets/${t1.id}`, 'PATCH', { title: 'x' }), p(t1.id)))).status).toBe(403);
    expect((await share('dev', { resource_type: 'ticket', resource_id: t1.id, grantee_id: U.agent })).status).toBe(400);
  });

  it('a recipient cannot re-share, and nobody can share more than they have', async () => {
    expect((await share('other', { resource_type: 'ticket', resource_id: t1.id, grantee_id: U.helper })).status).toBe(403);
    expect((await share('agent', { resource_type: 'ticket', resource_id: t2.id, grantee_id: U.other, level: 'edit' })).status).toBe(403);
  });

  it('revoking takes effect immediately', async () => {
    expect((await call(shareOne.DELETE(req('dev', `/api/shares/${shareId}`, 'DELETE'), p(shareId)))).status).toBe(200);
    expect((await getTicket('other', t1.id)).status).toBe(404);
    expect((await call(mediaUrl.GET(req('other', `/api/media/${fileId}/url`), { params: { id: fileId } }))).status).toBe(404);
  });

  it('a shared file opens alone', async () => {
    const r = await share('dev', { resource_type: 'file', resource_id: fileId, grantee_id: U.other });
    expect(r.status).toBe(200);
    expect((await call(mediaUrl.GET(req('other', `/api/media/${fileId}/url`), { params: { id: fileId } }))).status).toBe(200);
    expect((await getTicket('other', t1.id)).status).toBe(404);
  });
});

describe('sharing Env variables follows vault rules', () => {
  it('a Staging variable can be shared by a project developer; the recipient reads that one only and cannot write', async () => {
    const r = await share('dev', { resource_type: 'vault_item', resource_id: SECRET.staging, grantee_id: U.other });
    expect(r.status).toBe(200);
    expect((await reveal('other', SECRET.staging)).body.data.value).toBe('staging-secret-value');
    expect((await reveal('other', SECRET.development)).status).toBe(404);
    const list = await envGet('other', 'staging');
    expect(list.body.data.secrets.map((s: any) => s.id)).toEqual([SECRET.staging]);
    expect((await call(envList.POST(req('other', `/api/projects/${P}/env`, 'POST', { environment: 'staging', key: 'Y', value: 'z' }), p(P)))).status).toBe(403);
    expect((await queryOne(`SELECT 1 FROM vault_audit WHERE action = 'share' AND secret_id = $1`, [SECRET.staging]))).toBeTruthy();
  });

  it('a Production variable shared by the lead waits for HR approval', async () => {
    const r = await share('lead', { resource_type: 'vault_item', resource_id: SECRET.production, grantee_id: U.helper });
    expect(r.status).toBe(200);
    expect((await reveal('helper', SECRET.production)).status).toBe(404);
    expect((await call(shareApprove.POST(req('lead', `/api/shares/${r.body.data.id}/approve`, 'POST', {}), p(r.body.data.id)))).status).toBe(403);
    expect((await call(shareApprove.POST(req('hr', `/api/shares/${r.body.data.id}/approve`, 'POST', {}), p(r.body.data.id)))).status).toBe(200);
    expect((await reveal('helper', SECRET.production)).body.data.value).toBe('production-secret-value');
  });

  it('a plain developer cannot share Production at all (no access to it)', async () => {
    expect((await share('dev', { resource_type: 'vault_item', resource_id: SECRET.production, grantee_id: U.other })).status).toBe(403);
  });
});

describe('handoff notes', () => {
  let t: any;
  it('taking someone off an In-progress ticket needs a handoff note', async () => {
    t = await newTicket('dev', 'Payment page');
    await call(assignees.PUT(req('lead', `/api/tickets/${t.id}/assignees`, 'PUT', { user_ids: [U.dev] }), p(t.id)));
    await call(ticketRoute.PATCH(req('dev', `/api/tickets/${t.id}`, 'PATCH', { status: 'in_progress' }), p(t.id)));
    const no = await call(assignees.PUT(req('lead', `/api/tickets/${t.id}/assignees`, 'PUT', { user_ids: [U.dev2] }), p(t.id)));
    expect(no.status).toBe(400);
    expect(no.body.message).toMatch(/Handoff note required/);
    // Adding someone without removing anyone needs no note.
    expect((await call(assignees.PUT(req('lead', `/api/tickets/${t.id}/assignees`, 'PUT', { user_ids: [U.dev, U.dev2] }), p(t.id)))).status).toBe(200);
    const yes = await call(assignees.PUT(req('lead', `/api/tickets/${t.id}/assignees`, 'PUT',
      { user_ids: [U.dev2], handoff: { done: 'Form built', left: 'Stripe webhook', branch: 'feature/x', gotchas: 'test keys only' } }), p(t.id)));
    expect(yes.status).toBe(200);
    const c = await call(collab.GET(req('dev2', `/api/tickets/${t.id}/collab`), p(t.id)));
    expect(c.body.data.handoffs[0].left_todo).toBe('Stripe webhook');
  });

  it('bulk reports it instead of skipping silently', async () => {
    const r = await call(bulk.PATCH(req('lead', `/api/projects/${P}/tickets/bulk`, 'PATCH',
      { ids: [t.id], changes: { assignees: { mode: 'replace', user_ids: [U.dev] } } }), p(P)));
    expect(r.body.data.results[0].ok).toBe(false);
    expect(r.body.data.results[0].error).toMatch(/Handoff note required/);
  });
});

describe('reviews, out of office and guests', () => {
  it('round-robin skips the requester and anyone out of office', async () => {
    const t = await newTicket('dev', 'Review me');
    // lead is out of office today
    const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
    expect((await call(availability.POST(req('lead', '/api/profile/availability', 'POST', { starts_on: today, ends_on: today, note: 'Leave' }), NO_CTX))).status).toBe(200);
    const r1 = await call(reviewsCreate.POST(req('dev', `/api/tickets/${t.id}/reviews`, 'POST', { pr_url: 'https://github.com/x/y/pull/1' }), p(t.id)));
    expect(r1.body.data.reviewer_id).toBe(U.dev2);
    expect(r1.body.data.moved_to_review).toBe(true);
    const r2 = await call(reviewsCreate.POST(req('dev', `/api/tickets/${t.id}/reviews`, 'POST', {}), p(t.id)));
    expect(r2.body.data.reviewer_id).toBe(U.dev2); // the only one left
    // only the reviewer decides; changes need a comment
    expect((await call(reviewDecide.POST(req('dev', `/api/reviews/${r1.body.data.id}`, 'POST', { action: 'approve' }), p(r1.body.data.id)))).status).toBe(403);
    expect((await call(reviewDecide.POST(req('dev2', `/api/reviews/${r1.body.data.id}`, 'POST', { action: 'request_changes' }), p(r1.body.data.id)))).status).toBe(400);
    expect((await call(reviewDecide.POST(req('dev2', `/api/reviews/${r1.body.data.id}`, 'POST', { action: 'approve' }), p(r1.body.data.id)))).body.data.status).toBe('approved');
    // the OOO banner data
    await call(assignees.PUT(req('dev', `/api/tickets/${t.id}/assignees`, 'PUT', { user_ids: [U.lead] }), p(t.id)));
    const c = await call(collab.GET(req('dev', `/api/tickets/${t.id}/collab`), p(t.id)));
    expect(c.body.data.out_of_office.map((o: any) => o.id)).toEqual([U.lead]);
  });

  it('guests are never auto-picked and lose everything when their window ends', async () => {
    await query(`INSERT INTO project_members (project_id, user_id, member_role) VALUES ($1, $2, 'developer')`, [P, U.guest]);
    expect((await getProject('guest')).status).toBe(200); // explicitly assigned → visible
    await query(`DELETE FROM user_availability`); // everyone back
    await query(`DELETE FROM project_review_rotation`);
    const t = await newTicket('dev', 'Guest exclusion');
    const picks = new Set<number>();
    for (let i = 0; i < 4; i++) {
      const r = await call(reviewsCreate.POST(req('dev', `/api/tickets/${t.id}/reviews`, 'POST', {}), p(t.id)));
      picks.add(r.body.data.reviewer_id);
    }
    expect(picks.has(U.guest)).toBe(false);
    expect(picks.has(U.dev)).toBe(false);
    // only HR sets guest status; expiry locks the guest out everywhere
    expect((await call(hrDevProfile.PUT(req('lead', `/api/hr/developers/${U.guest}/profile`, 'PUT', { guest_expires_at: '2020-01-01' }), p(U.guest)))).status).toBe(403);
    expect((await call(hrDevProfile.PUT(req('hr', `/api/hr/developers/${U.guest}/profile`, 'PUT', { guest_expires_at: '2020-01-01T00:00:00Z' }), p(U.guest)))).status).toBe(200);
    expect((await getProject('guest')).status).toBe(401);
    expect((await call(profile.GET(req('guest', '/api/profile'), NO_CTX))).status).toBe(401);
  });

  it('agents are unaffected', async () => {
    expect((await getProject('agent')).status).toBe(200);
    expect((await call(shares.GET(req('agent', '/api/shares'), NO_CTX))).body.data).toEqual([]);
  });

  it('developers keep their own profile (skills, capacity) but cannot make themselves non-guests', async () => {
    expect((await call(profile.PUT(req('helper', '/api/profile', 'PUT', { skills: ['Vue', 'react'], weekly_capacity_hours: 30, is_guest: true }), NO_CTX))).status).toBe(200);
    const me = await call(profile.GET(req('helper', '/api/profile'), NO_CTX));
    expect(me.body.data.profile.skills).toEqual(['vue', 'react']);
    expect(me.body.data.profile.is_guest).toBe(false);
  });
});
