/**
 * Phase 2 end to end: bulk edit, board settings, quick-add, ranking, list filters,
 * calendar ticket layer, and saved-view permissions — through the real routes.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { assertSafeDb, resetDb, tokenFor } from './db';

assertSafeDb();

import { pool, query, queryOne } from '@/lib/db';
import * as projectTickets from '@/app/api/projects/[id]/tickets/route';
import * as bulkRoute from '@/app/api/projects/[id]/tickets/bulk/route';
import * as ticketRoute from '@/app/api/tickets/[id]/route';
import * as relationsRoute from '@/app/api/tickets/[id]/relations/route';
import * as boardRoute from '@/app/api/projects/[id]/board-settings/route';
import * as viewsRoute from '@/app/api/saved-views/route';
import * as viewRoute from '@/app/api/saved-views/[id]/route';
import * as calendarRoute from '@/app/api/projects/calendar/route';
import * as searchRoute from '@/app/api/search/route';

type Who = 'hr' | 'agent' | 'otherAgent' | 'dev' | 'lead' | 'outsider';
const U: Record<Who, number> = { hr: 0, agent: 0, otherAgent: 0, dev: 0, lead: 0, outsider: 0 };
const T: Record<Who, string> = { hr: '', agent: '', otherAgent: '', dev: '', lead: '', outsider: '' };
let P = 0, P2 = 0;
const NO_CTX = {} as any;

function req(who: Who, url: string, method = 'GET', body?: unknown) {
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
const pp = (id: number) => ({ params: { id: String(id) } });
const create = (who: Who, body: any, pid = P) => call(projectTickets.POST(req(who, `/api/projects/${pid}/tickets`, 'POST', body), pp(pid)));
const list = (who: Who, qs: string, pid = P) => call(projectTickets.GET(req(who, `/api/projects/${pid}/tickets?${qs}`), pp(pid)));
const bulk = (who: Who, ids: number[], changes: any) => call(bulkRoute.PATCH(req(who, `/api/projects/${P}/tickets/bulk`, 'PATCH', { ids, changes }), pp(P)));
const patch = (who: Who, id: number, body: any) => call(ticketRoute.PATCH(req(who, `/api/tickets/${id}`, 'PATCH', body), pp(id)));
const status = async (id: number) => (await queryOne<{ status: string }>(`SELECT status FROM tickets WHERE id = $1`, [id]))!.status;

beforeAll(async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-secret';
  await resetDb();
  for (const [k, role] of [['hr', 'hr'], ['agent', 'agent'], ['otherAgent', 'agent'], ['dev', 'developer'], ['lead', 'developer'], ['outsider', 'developer']] as const) {
    const row = await queryOne<{ id: string }>(`INSERT INTO users (username, full_name, role) VALUES ($1, $2, $3) RETURNING id`, [k.toLowerCase(), k, role]);
    U[k] = Number(row!.id);
    T[k] = await tokenFor({ id: U[k], username: k.toLowerCase(), role });
  }
  P = (await queryOne<{ id: number }>(`INSERT INTO projects (title, client_name, created_by, supervisor_id) VALUES ('Acme', 'Acme', $1, $2) RETURNING id`, [U.agent, U.hr]))!.id;
  P2 = (await queryOne<{ id: number }>(`INSERT INTO projects (title, client_name, created_by, supervisor_id) VALUES ('Other', 'Other', $1, $2) RETURNING id`, [U.otherAgent, U.hr]))!.id;
  await query(`INSERT INTO project_members (project_id, user_id, member_role) VALUES ($1, $2, 'developer'), ($1, $3, 'lead_developer'), ($4, $5, 'developer')`,
    [P, U.dev, U.lead, P2, U.outsider]);
});
afterAll(() => pool.end());

describe('bulk edit [TEST]', () => {
  it('an agent cannot bulk-change status; every ticket reports why and nothing moves', async () => {
    const a = (await create('dev', { title: 'A' })).body.data;
    const b = (await create('dev', { title: 'B' })).body.data;
    const r = await bulk('agent', [a.id, b.id], { status: 'in_progress' });
    expect(r.status).toBe(200);
    expect(r.body.data.ok_count).toBe(0);
    expect(r.body.data.results.every((x: any) => x.status === 403)).toBe(true);
    expect([await status(a.id), await status(b.id)]).toEqual(['open', 'open']);
  });

  it('applies per ticket: CR gate and blocked tickets are reported, not forced', async () => {
    const plain = (await create('dev', { title: 'Plain' })).body.data;
    const cr = (await create('dev', { title: 'CR', type: 'change_request' })).body.data;
    const blocker = (await create('dev', { title: 'Blocker' })).body.data;
    const blocked = (await create('dev', { title: 'Blocked' })).body.data;
    await call(relationsRoute.POST(req('dev', `/api/tickets/${blocker.id}/relations`, 'POST', { relation: 'blocks', key: blocked.key }), pp(blocker.id)));
    const other = (await create('outsider', { title: 'Other project' }, P2)).body.data;

    const r = await bulk('dev', [plain.id, cr.id, blocked.id, other.id], { status: 'in_progress' });
    const by = Object.fromEntries(r.body.data.results.map((x: any) => [x.id, x]));
    expect(by[plain.id].ok).toBe(true);
    expect(by[cr.id]).toMatchObject({ ok: false, status: 400 });
    expect(by[cr.id].error).toMatch(/HR approval/);
    expect(by[blocked.id]).toMatchObject({ ok: false, status: 409 });
    expect(by[other.id]).toMatchObject({ ok: false, status: 404 });
    expect(await status(plain.id)).toBe('in_progress');
    expect(await status(cr.id)).toBe('open');
    expect(await status(blocked.id)).toBe('open');
    expect(await status(other.id)).toBe('open');
  });

  it('labels add/remove and assignees merge per ticket', async () => {
    const l1 = (await queryOne<{ id: number }>(`INSERT INTO labels (project_id, name) VALUES ($1, 'urgent-fix') RETURNING id`, [P]))!.id;
    const l2 = (await queryOne<{ id: number }>(`INSERT INTO labels (project_id, name) VALUES ($1, 'design') RETURNING id`, [P]))!.id;
    const a = (await create('dev', { title: 'L1', label_ids: [l2], assignee_ids: [U.lead] })).body.data;
    const b = (await create('dev', { title: 'L2' })).body.data;
    expect((await bulk('dev', [a.id, b.id], { label_add: [l1], label_remove: [l2] })).body.data.ok_count).toBe(2);
    expect((await bulk('dev', [a.id, b.id], { assignees: { mode: 'add', user_ids: [U.dev] } })).body.data.ok_count).toBe(2);
    const labels = (id: number) => query<{ label_id: number }>(`SELECT label_id FROM ticket_labels WHERE ticket_id = $1`, [id]).then((r) => r.map((x) => x.label_id));
    const people = (id: number) => query<{ user_id: string }>(`SELECT user_id FROM ticket_assignees WHERE ticket_id = $1 ORDER BY user_id`, [id]).then((r) => r.map((x) => Number(x.user_id)));
    expect(await labels(a.id)).toEqual([l1]);
    expect(await labels(b.id)).toEqual([l1]);
    expect(await people(a.id)).toEqual([U.dev, U.lead].sort((x, y) => x - y));
    expect(await people(b.id)).toEqual([U.dev]);
    // A developer not on the project can't be assigned: the whole request fails.
    expect((await bulk('dev', [a.id], { assignees: { mode: 'add', user_ids: [U.outsider] } })).status).toBe(400);
  });

  it('only HR can bulk delete', async () => {
    const a = (await create('dev', { title: 'Del' })).body.data;
    expect((await bulk('dev', [a.id], { delete: true })).body.data.results[0].status).toBe(403);
    expect((await bulk('hr', [a.id], { delete: true })).body.data.ok_count).toBe(1);
    expect((await queryOne(`SELECT deleted_at FROM tickets WHERE id = $1`, [a.id]))!.deleted_at).not.toBeNull();
  });

  it('a developer outside the project cannot bulk edit it at all', async () => {
    const a = (await create('dev', { title: 'Mine' })).body.data;
    expect((await bulk('outsider', [a.id], { priority: 'high' })).status).toBe(404);
  });
});

describe('board', () => {
  it('WIP limits: developers set them (sanitised), agents cannot', async () => {
    const put = (who: Who, wip: any) => call(boardRoute.PUT(req(who, `/api/projects/${P}/board-settings`, 'PUT', { wip_limits: wip }), pp(P)));
    expect((await put('agent', { in_progress: 2 })).status).toBe(403);
    expect((await put('dev', { in_progress: 2, done: 0, bogus: 5 })).body.data.wip_limits).toEqual({ in_progress: 2 });
    expect((await call(boardRoute.GET(req('agent', `/api/projects/${P}/board-settings`), pp(P)))).body.data.wip_limits).toEqual({ in_progress: 2 });
    expect((await call(boardRoute.GET(req('outsider', `/api/projects/${P}/board-settings`), pp(P)))).status).toBe(404);
  });

  it('quick-add creates straight into a column for developers; agents still go to Triage', async () => {
    expect((await create('dev', { title: 'Quick', status: 'in_progress' })).body.data.status).toBe('in_progress');
    expect((await create('agent', { title: 'Agent quick', status: 'in_progress' })).body.data.status).toBe('triage');
    expect((await create('dev', { title: 'CR quick', type: 'change_request', status: 'in_progress' })).body.message).toMatch(/HR approval/);
    const d = (await create('dev', { title: 'Done already', status: 'done' })).body.data;
    expect((await queryOne(`SELECT done_at FROM tickets WHERE id = $1`, [d.id]))!.done_at).not.toBeNull();
  });

  it('reorders within a column via move, and moves across columns with a position', async () => {
    const x = (await create('dev', { title: 'R1' })).body.data;
    const y = (await create('dev', { title: 'R2' })).body.data;
    const z = (await create('dev', { title: 'R3' })).body.data;
    expect((await patch('dev', z.id, { move: { after_id: null, before_id: x.id } })).status).toBe(200);
    const order = (await list('dev', 'view=work')).body.data.map((t: any) => t.id).filter((id: number) => [x.id, y.id, z.id].includes(id));
    expect(order).toEqual([z.id, x.id, y.id]);
    expect((await patch('agent', x.id, { move: { after_id: z.id, before_id: null } })).status).toBe(403);
    const moved = await patch('dev', y.id, { status: 'in_review', move: { after_id: null, before_id: null } });
    expect(moved.body.data.status).toBe('in_review');
  });
});

describe('list filters and backlog', () => {
  it('filters by creator, blocked, missing estimate, due range; backlog excludes triage/done/subtasks', async () => {
    const mine = (await create('agent', { title: 'Agent made' })).body.data;
    const est = (await create('dev', { title: 'Estimated', estimate_hours: 2, due_date: '2026-11-10' })).body.data;
    const done = (await create('dev', { title: 'Finished', status: 'done' })).body.data;
    const parent = (await create('dev', { title: 'Parent' })).body.data;
    const sub = (await create('dev', { title: 'Sub', parent_id: parent.id })).body.data;
    const ids = (r: any) => r.body.data.map((t: any) => t.id);
    const byAgent = (await list('agent', 'view=all&created_by=me')).body.data;
    expect(byAgent.map((t: any) => t.id)).toContain(mine.id);
    expect(byAgent.every((t: any) => Number(t.created_by) === U.agent)).toBe(true);
    expect(ids(await list('dev', 'view=all&no_estimate=1'))).not.toContain(est.id);
    expect(ids(await list('dev', 'view=all&due_from=2026-11-01&due_to=2026-11-30'))).toEqual([est.id]);
    const backlog = ids(await list('dev', 'view=backlog'));
    expect(backlog).toContain(est.id);
    expect(backlog).not.toContain(done.id);
    expect(backlog).not.toContain(mine.id); // still in triage
    expect(backlog).not.toContain(sub.id);
    const blockedIds = ids(await list('dev', 'view=all&blocked=1'));
    expect(blockedIds.length).toBeGreaterThan(0);
    expect(blockedIds).not.toContain(est.id);
  });
});

describe('calendar ticket layer', () => {
  it('shows only tickets from projects the viewer can see; "mine" = assigned (agents: opened)', async () => {
    const t = (await create('dev', { title: 'Cal', due_date: '2026-11-12', assignee_ids: [U.lead] })).body.data;
    const cal = (who: Who, layer: string) => call(calendarRoute.GET(req(who, `/api/projects/calendar?from=2026-11-01&to=2026-11-30&tickets=${layer}`), NO_CTX))
      .then((r) => r.body.data.filter((e: any) => e.type === 'ticket').map((e: any) => e.extra));
    expect(await cal('lead', 'mine')).toContain(t.key);
    expect(await cal('dev', 'mine')).not.toContain(t.key);
    expect(await cal('dev', 'all')).toContain(t.key);
    expect(await cal('outsider', 'all')).not.toContain(t.key);
    expect(await cal('otherAgent', 'all')).not.toContain(t.key);
  });
});

describe('saved views [TEST]', () => {
  const make = (who: Who, body: any) => call(viewsRoute.POST(req(who, '/api/saved-views', 'POST', body), NO_CTX));
  const listViews = (who: Who, qs = '') => call(viewsRoute.GET(req(who, `/api/saved-views${qs}`), NO_CTX)).then((r) => r.body.data.map((v: any) => v.name));
  const one = (who: Who, id: number) => call(viewRoute.GET(req(who, `/api/saved-views/${id}`), pp(id)));

  it('personal views are private; shared project views follow project access', async () => {
    const personal = (await make('dev', { name: 'Dev personal', view_type: 'board', project_id: P, config: { filters: { assignee: 'me' } } })).body.data;
    const shared = (await make('dev', { name: 'Team bugs', view_type: 'list', project_id: P, scope: 'shared', pinned: true, config: { filters: { type: 'bug' } } })).body.data;
    expect(await listViews('dev')).toEqual(expect.arrayContaining(['Dev personal', 'Team bugs']));
    expect(await listViews('lead')).toContain('Team bugs');
    expect(await listViews('lead')).not.toContain('Dev personal');
    expect(await listViews('agent')).toContain('Team bugs'); // agent owns the project
    expect(await listViews('outsider')).not.toContain('Team bugs');
    expect(await listViews('otherAgent')).not.toContain('Team bugs');
    expect((await one('outsider', shared.id)).status).toBe(404);
    expect((await one('lead', personal.id)).status).toBe(404);
    expect(await listViews('lead', '?pinned=1')).toEqual(['Team bugs']);
  });

  it('project-less shared views are for developers and HR, not agents', async () => {
    await make('lead', { name: 'All my work', view_type: 'my_work', scope: 'shared', config: { filters: { blocked: '1' } } });
    expect(await listViews('outsider')).toContain('All my work');
    expect(await listViews('hr')).toContain('All my work');
    expect(await listViews('agent')).not.toContain('All my work');
  });

  it('only the owner or HR can change or delete; config is sanitised', async () => {
    const v = (await make('dev', { name: 'Edit me', view_type: 'board', project_id: P, scope: 'shared', config: { filters: { q: 'x', evil: 'y' }, junk: 1 } })).body.data;
    const stored = (await queryOne<{ config: any }>(`SELECT config FROM saved_views WHERE id = $1`, [v.id]))!.config;
    expect(stored).toEqual({ filters: { q: 'x' } });
    const upd = (who: Who) => call(viewRoute.PATCH(req(who, `/api/saved-views/${v.id}`, 'PATCH', { name: `by ${who}` }), pp(v.id)));
    expect((await upd('lead')).status).toBe(403);
    expect((await upd('agent')).status).toBe(403);
    expect((await upd('hr')).status).toBe(200);
    expect((await call(viewRoute.DELETE(req('lead', `/api/saved-views/${v.id}`, 'DELETE'), pp(v.id)))).status).toBe(403);
    expect((await call(viewRoute.DELETE(req('dev', `/api/saved-views/${v.id}`, 'DELETE'), pp(v.id)))).status).toBe(200);
  });

  it('cannot save a view on a project you can’t see', async () => {
    expect((await make('outsider', { name: 'Sneaky', view_type: 'board', project_id: P, scope: 'shared' })).status).toBe(404);
  });

  it('global search finds saved views only for people who can see them', async () => {
    await make('dev', { name: 'Zebra launch board', view_type: 'board', project_id: P, scope: 'shared' });
    await make('dev', { name: 'Zebra private notes', view_type: 'board', project_id: P });
    const hits = async (who: Who) => {
      const r = await call(searchRoute.GET(req(who, '/api/search?q=zebra'), NO_CTX));
      const g = (r.body.data.groups || r.body.data).find?.((x: any) => x.kind === 'view');
      return (g?.hits || []).map((h: any) => h.title);
    };
    expect(await hits('dev')).toEqual(expect.arrayContaining(['Zebra launch board', 'Zebra private notes']));
    expect(await hits('lead')).toEqual(['Zebra launch board']);
    expect(await hits('outsider')).toEqual([]);
  });
});
