/**
 * Tickets and media, end to end through the real route handlers and real SQL.
 * Every role is checked server-side: agent, project developer, lead, outsider, HR.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { assertSafeDb, resetDb, tokenFor } from './db';

assertSafeDb();
process.env.MEDIA_STORAGE = 'local';

import { pool, query, queryOne } from '@/lib/db';
import * as projectTickets from '@/app/api/projects/[id]/tickets/route';
import * as ticketRoute from '@/app/api/tickets/[id]/route';
import * as triageRoute from '@/app/api/tickets/[id]/triage/route';
import * as crRoute from '@/app/api/tickets/[id]/cr-decision/route';
import * as relationsRoute from '@/app/api/tickets/[id]/relations/route';
import * as assigneesRoute from '@/app/api/tickets/[id]/assignees/route';
import * as commentsRoute from '@/app/api/tickets/[id]/comments/route';
import * as myTasks from '@/app/api/my/tasks/route';
import * as uploadUrl from '@/app/api/media/upload-url/route';
import * as complete from '@/app/api/media/[id]/complete/route';
import * as mediaList from '@/app/api/media/route';
import * as mediaUrlRoute from '@/app/api/media/[id]/url/route';
import * as localMedia from '@/app/api/media/local/route';

const U = { hr: 0, agent: 0, otherAgent: 0, dev: 0, lead: 0, outsider: 0 };
const T: Record<keyof typeof U, string> = { hr: '', agent: '', otherAgent: '', dev: '', lead: '', outsider: '' };
let P = 0;
const NO_CTX = {} as any; // routes without URL params still take a context argument

function req(who: keyof typeof U, url: string, method = 'GET', body?: unknown) {
  return new NextRequest(`http://test${url}`, {
    method,
    headers: { authorization: `Bearer ${T[who]}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
async function call(res: Promise<Response> | Response) {
  const r = await res;
  return { status: r.status, body: await r.json() };
}
const create = (who: keyof typeof U, body: any) => call(projectTickets.POST(req(who, `/api/projects/${P}/tickets`, 'POST', body), { params: { id: String(P) } }));
const patch = (who: keyof typeof U, id: number, body: any) => call(ticketRoute.PATCH(req(who, `/api/tickets/${id}`, 'PATCH', body), { params: { id: String(id) } }));
const get = (who: keyof typeof U, id: number) => call(ticketRoute.GET(req(who, `/api/tickets/${id}`), { params: { id: String(id) } }));
const triage = (who: keyof typeof U, id: number, body: any) => call(triageRoute.POST(req(who, `/api/tickets/${id}/triage`, 'POST', body), { params: { id: String(id) } }));
const relate = (who: keyof typeof U, id: number, relation: string, key: string) =>
  call(relationsRoute.POST(req(who, `/api/tickets/${id}/relations`, 'POST', { relation, key }), { params: { id: String(id) } }));
const notes = (user: number) => query<{ type: string; body: string }>(`SELECT type, body FROM notifications_inbox WHERE user_id = $1 ORDER BY id`, [user]);

beforeAll(async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-secret';
  await resetDb();
  for (const [k, role] of [['hr', 'hr'], ['agent', 'agent'], ['otherAgent', 'agent'], ['dev', 'developer'], ['lead', 'developer'], ['outsider', 'developer']] as const) {
    const row = await queryOne<{ id: string }>(`INSERT INTO users (username, full_name, role) VALUES ($1, $2, $3) RETURNING id`, [k.toLowerCase(), k, role]);
    U[k] = Number(row!.id);
    T[k] = await tokenFor({ id: U[k], username: k.toLowerCase(), role });
  }
  const p = await queryOne<{ id: number }>(
    `INSERT INTO projects (title, client_name, created_by, supervisor_id, deadline) VALUES ('Acme site', 'Acme', $1, $2, '2026-11-30') RETURNING id`, [U.agent, U.hr]
  );
  P = p!.id;
  await query(`INSERT INTO project_members (project_id, user_id, member_role) VALUES ($1, $2, 'developer'), ($1, $3, 'lead_developer')`, [P, U.dev, U.lead]);
});

afterAll(() => pool.end());

describe('creating tickets', () => {
  it('agent tickets go to Triage with an SLA deadline; developer tickets start Open', async () => {
    const a = await create('agent', { title: 'Booking button', priority: 'urgent' });
    expect(a.status).toBe(200);
    expect(a.body.data.status).toBe('triage');
    const due = new Date(a.body.data.triage_due_at).getTime() - new Date(a.body.data.created_at).getTime();
    expect(Math.round(due / 3600_000)).toBe(4);
    const d = await create('dev', { title: 'Set up repo' });
    expect(d.body.data.status).toBe('open');
  });

  it('notifies the triage owner (lead) about new triage tickets', async () => {
    expect((await notes(U.lead)).some((n) => n.type === 'ticket_triage')).toBe(true);
  });

  it('another agent, and a developer not on the project, cannot create or see tickets', async () => {
    expect((await create('otherAgent', { title: 'x' })).status).toBe(404);
    expect((await create('outsider', { title: 'x' })).status).toBe(404);
    const t = await queryOne<{ id: number }>(`SELECT id FROM tickets WHERE project_id = $1 LIMIT 1`, [P]);
    expect((await get('outsider', t!.id)).status).toBe(404);
    expect((await get('otherAgent', t!.id)).status).toBe(404);
  });

  it('gives every ticket a unique number even when created at the same moment', async () => {
    const results = await Promise.all(Array.from({ length: 15 }, (_, i) => create('dev', { title: `Parallel ${i}` })));
    expect(results.every((r) => r.status === 200)).toBe(true);
    const keys = results.map((r) => r.body.data.key);
    expect(new Set(keys).size).toBe(15);
    const nums = (await query<{ number: number }>(`SELECT number FROM tickets WHERE project_id = $1 ORDER BY number`, [P])).map((r) => r.number);
    expect(nums).toEqual(nums.map((_, i) => i + 1));
  });
});

describe('triage', () => {
  it('only the lead/HR can triage; accept assigns and notifies', async () => {
    const t = (await create('agent', { title: 'Contact form' })).body.data;
    expect((await triage('agent', t.id, { action: 'accept' })).status).toBe(403);
    expect((await triage('dev', t.id, { action: 'accept' })).status).toBe(403);
    const r = await triage('lead', t.id, { action: 'accept', assignee_ids: [U.dev], estimate_hours: 2 });
    expect(r.body.data.status).toBe('open');
    expect((await notes(U.dev)).some((n) => n.type === 'ticket_assigned')).toBe(true);
    expect((await notes(U.agent)).some((n) => n.type === 'triage_accepted')).toBe(true);
  });

  it('need info → agent answers → back in the queue; decline needs a reason', async () => {
    const t = (await create('agent', { title: 'Vague request' })).body.data;
    await triage('lead', t.id, { action: 'need_info', question: 'Which page?' });
    expect((await get('agent', t.id)).body.data.ticket.triage_state).toBe('need_info');
    expect((await triage('agent', t.id, { action: 'info_given', note: 'The home page' })).status).toBe(200);
    expect((await get('agent', t.id)).body.data.ticket.triage_state).toBeNull();
    expect((await triage('lead', t.id, { action: 'decline' })).status).toBe(400);
    expect((await triage('lead', t.id, { action: 'decline', reason: 'Out of scope' })).body.data.status).toBe('declined');
  });

  it('merge marks a duplicate and links it', async () => {
    const orig = (await create('dev', { title: 'Logo update' })).body.data;
    const dup = (await create('agent', { title: 'New logo please' })).body.data;
    const r = await triage('hr', dup.id, { action: 'merge', into_key: orig.key });
    expect(r.body.data.duplicate_of).toBe(orig.key);
  });
});

describe('agents vs developers on a ticket', () => {
  it('agents cannot move status or assign; developers can', async () => {
    const t = (await create('dev', { title: 'Hero section' })).body.data;
    expect((await patch('agent', t.id, { status: 'in_progress' })).status).toBe(403);
    const asg = await call(assigneesRoute.PUT(req('agent', `/api/tickets/${t.id}/assignees`, 'PUT', { user_ids: [U.dev] }), { params: { id: String(t.id) } }));
    expect(asg.status).toBe(403);
    expect((await patch('dev', t.id, { status: 'in_progress' })).body.data.status).toBe('in_progress');
  });

  it('agents edit their own ticket only until work starts', async () => {
    const t = (await create('agent', { title: 'Typo on About' })).body.data;
    expect((await patch('agent', t.id, { title: 'Typo on About page' })).status).toBe(200);
    await triage('lead', t.id, { action: 'accept' });
    await patch('dev', t.id, { status: 'in_progress' });
    expect((await patch('agent', t.id, { title: 'changed' })).status).toBe(403);
  });

  it('only developers on the project can be assigned', async () => {
    const t = (await create('dev', { title: 'Footer' })).body.data;
    const r = await call(assigneesRoute.PUT(req('lead', `/api/tickets/${t.id}/assignees`, 'PUT', { user_ids: [U.outsider] }), { params: { id: String(t.id) } }));
    expect(r.status).toBe(400);
  });
});

describe('dependencies', () => {
  it('rejects circular blocking chains', async () => {
    const [a, b, c] = await Promise.all(['A', 'B', 'C'].map((x) => create('dev', { title: `Chain ${x}` }).then((r) => r.body.data)));
    expect((await relate('dev', a.id, 'blocks', b.key)).status).toBe(200);
    expect((await relate('dev', b.id, 'blocks', c.key)).status).toBe(200);
    const loop = await relate('dev', c.id, 'blocks', a.key);
    expect(loop.status).toBe(400);
    expect(loop.body.message).toMatch(/circular/);
    expect((await relate('dev', a.id, 'blocked_by', c.key)).status).toBe(400);
  });

  it('a blocked ticket needs confirmation to start, and its assignee hears when the blocker is done', async () => {
    const blocker = (await create('dev', { title: 'API endpoint' })).body.data;
    const blocked = (await create('dev', { title: 'UI using API', assignee_ids: [U.lead] })).body.data;
    await relate('dev', blocker.id, 'blocks', blocked.key);
    const r = await patch('dev', blocked.id, { status: 'in_progress' });
    expect(r.status).toBe(409);
    expect((await patch('dev', blocked.id, { status: 'in_progress', confirm_blocked: true })).status).toBe(200);
    await patch('dev', blocker.id, { status: 'done' });
    expect((await notes(U.lead)).some((n) => n.type === 'ticket_unblocked' && n.body.includes(blocked.key))).toBe(true);
  });
});

describe('change requests', () => {
  it('cannot start before HR approval; approval can move the project deadline', async () => {
    const cr = (await create('agent', { title: 'Add a blog', type: 'change_request' })).body.data;
    await triage('lead', cr.id, { action: 'accept' });
    expect((await patch('dev', cr.id, { status: 'in_progress' })).body.message).toMatch(/HR approval/);
    const dec = (who: keyof typeof U) => call(crRoute.POST(req(who, `/api/tickets/${cr.id}/cr-decision`, 'POST', { decision: 'approved', new_deadline: '2026-12-15' }), { params: { id: String(cr.id) } }));
    expect((await dec('lead')).status).toBe(403);
    expect((await dec('hr')).status).toBe(200);
    expect((await queryOne<{ d: string }>(`SELECT deadline::text AS d FROM projects WHERE id = $1`, [P]))!.d).toBe('2026-12-15');
    expect((await patch('dev', cr.id, { status: 'in_progress' })).status).toBe(200);
  });
});

describe('comments and My Tasks', () => {
  it('@mentions notify people on the project only', async () => {
    const t = (await create('dev', { title: 'Mentions' })).body.data;
    await call(commentsRoute.POST(req('dev', `/api/tickets/${t.id}/comments`, 'POST', { body: '@agent and @outsider please check' }), { params: { id: String(t.id) } }));
    expect((await notes(U.agent)).some((n) => n.type === 'mention')).toBe(true);
    expect((await notes(U.outsider)).some((n) => n.type === 'mention')).toBe(false);
  });

  it('My Tasks lists what is assigned to me', async () => {
    const r = await call(myTasks.GET(req('lead', '/api/my/tasks'), NO_CTX));
    expect(r.body.data.length).toBeGreaterThan(0);
    expect(r.body.data.every((t: any) => t.assignees.some((a: any) => Number(a.id) === U.lead))).toBe(true);
  });
});

describe('media', () => {
  let ticketId = 0;
  const upload = (who: keyof typeof U, body: any) => call(uploadUrl.POST(req(who, '/api/media/upload-url', 'POST', body), NO_CTX));

  it('needs a description on ticket files and enforces the 50 MB limit', async () => {
    ticketId = (await create('dev', { title: 'Has files' })).body.data.id;
    expect((await upload('agent', { entity_type: 'ticket', entity_id: ticketId, file_name: 'a.png', mime_type: 'image/png', size_bytes: 10 })).body.message).toMatch(/description/);
    expect((await upload('agent', { entity_type: 'ticket', entity_id: ticketId, file_name: 'big.mp4', mime_type: 'video/mp4', size_bytes: 51 * 1024 * 1024, description: 'x' })).body.message).toMatch(/50 MB/);
  });

  it('uploads, then the file is visible to people on the project only', async () => {
    const r = await upload('agent', { entity_type: 'ticket', entity_id: ticketId, file_name: 'shot.png', mime_type: 'image/png', size_bytes: 4, description: 'Screenshot' });
    expect(r.status).toBe(200);
    const put = new NextRequest(`http://test${r.body.data.upload.url}`, { method: 'PUT', body: new Uint8Array([1, 2, 3, 4]) });
    expect((await localMedia.PUT(put, NO_CTX)).status).toBe(200);
    expect((await call(complete.POST(req('agent', `/api/media/${r.body.data.id}/complete`, 'POST', {}), { params: { id: r.body.data.id } }))).status).toBe(200);

    const list = (who: keyof typeof U) => call(mediaList.GET(req(who, `/api/media?entity_type=ticket&entity_id=${ticketId}`), NO_CTX));
    expect((await list('dev')).body.data.map((f: any) => f.file_name)).toEqual(['shot.png']);
    expect((await list('outsider')).status).toBe(404);
    expect((await list('otherAgent')).status).toBe(404);
    expect((await call(mediaUrlRoute.GET(req('outsider', `/api/media/${r.body.data.id}/url`), { params: { id: r.body.data.id } }))).status).toBe(404);
  });

  it('removing a developer from the project removes their access to its tickets and files at once', async () => {
    const f = (await call(mediaList.GET(req('dev', `/api/media?entity_type=ticket&entity_id=${ticketId}`), NO_CTX))).body.data[0];
    await query(`DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`, [P, U.dev]);
    try {
      expect((await get('dev', ticketId)).status).toBe(404);
      expect((await call(mediaUrlRoute.GET(req('dev', `/api/media/${f.id}/url`), { params: { id: f.id } }))).status).toBe(404);
    } finally {
      await query(`INSERT INTO project_members (project_id, user_id, member_role) VALUES ($1, $2, 'developer')`, [P, U.dev]);
    }
  });

  it('serves SVG/HTML as downloads, never inline', async () => {
    const r = await upload('dev', { entity_type: 'ticket', entity_id: ticketId, file_name: 'x.svg', mime_type: 'image/svg+xml', size_bytes: 5, description: 'icon' });
    await localMedia.PUT(new NextRequest(`http://test${r.body.data.upload.url}`, { method: 'PUT', body: new Uint8Array([60, 115, 118, 103, 62]) }), NO_CTX);
    await complete.POST(req('dev', `/api/media/${r.body.data.id}/complete`, 'POST', {}), { params: { id: r.body.data.id } });
    const u = await call(mediaUrlRoute.GET(req('dev', `/api/media/${r.body.data.id}/url`), { params: { id: r.body.data.id } }));
    expect(u.body.data.inline).toBe(false);
    const dl = await localMedia.GET(new NextRequest(`http://test${u.body.data.url}`), NO_CTX);
    expect(dl.headers.get('content-disposition')).toMatch(/^attachment/);
    expect(dl.headers.get('content-type')).toBe('application/octet-stream');
  });
});
