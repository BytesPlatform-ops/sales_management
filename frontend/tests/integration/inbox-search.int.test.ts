/**
 * Notification inbox (prefs, email, de-dupe, snooze, digest, due-tomorrow) and
 * global search permission filtering, through the real routes and SQL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { assertSafeDb, resetDb, tokenFor } from './db';

assertSafeDb();

import { pool, query, queryOne } from '@/lib/db';
import { setEmailSender, EmailMessage } from '@/lib/email';
import { notify } from '@/lib/notifications';
import { dueTomorrow, sendDigests, pktDate } from '@/lib/notifications-daily';
import * as inbox from '@/app/api/inbox/route';
import * as inboxRead from '@/app/api/inbox/read/route';
import * as inboxSnooze from '@/app/api/inbox/snooze/route';
import * as inboxPrefs from '@/app/api/inbox/prefs/route';
import * as search from '@/app/api/search/route';
import * as members from '@/app/api/projects/[id]/members/route';
import * as status from '@/app/api/projects/[id]/status/route';

const NO_CTX = {} as any;
const U: Record<string, number> = {};
const T: Record<string, string> = {};
let P1 = 0, P2 = 0;
const sent: EmailMessage[] = [];

function req(who: string, url: string, method = 'GET', body?: unknown) {
  return new NextRequest(`http://test${url}`, {
    method,
    headers: { authorization: `Bearer ${T[who]}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
const json = async (r: Response | Promise<Response>) => { const x = await r; return { status: x.status, body: await x.json() }; };
const getInbox = (who: string, qs = 'tab=all') => json(inbox.GET(req(who, `/api/inbox?${qs}`), NO_CTX));
const doSearch = (who: string, q: string) => json(search.GET(req(who, `/api/search?q=${encodeURIComponent(q)}&limit=20`), NO_CTX));
const kinds = (r: any) => Object.fromEntries(r.body.data.groups.map((g: any) => [g.kind, g.hits.map((h: any) => h.title)]));

beforeAll(async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-secret';
  await resetDb();
  setEmailSender(async (m) => { sent.push(m); return true; });
  for (const [k, role] of [['hr', 'hr'], ['agentA', 'agent'], ['agentB', 'agent'], ['dev', 'developer'], ['outsider', 'developer']]) {
    const r = await queryOne<{ id: string }>(
      `INSERT INTO users (username, full_name, role, email_address) VALUES ($1, $2, $3, $4) RETURNING id`, [k.toLowerCase(), k, role, `${k.toLowerCase()}@test.local`]
    );
    U[k] = Number(r!.id);
    T[k] = await tokenFor({ id: U[k], username: k.toLowerCase(), role });
  }
  P1 = (await queryOne<{ id: number }>(`INSERT INTO projects (title, client_name, created_by, supervisor_id, description) VALUES ('Zebra dental site', 'Zebra Dental', $1, $2, 'needs a booking widget') RETURNING id`, [U.agentA, U.hr]))!.id;
  P2 = (await queryOne<{ id: number }>(`INSERT INTO projects (title, client_name, created_by, supervisor_id) VALUES ('Yak bakery shop', 'Yak Bakery', $1, $2) RETURNING id`, [U.agentB, U.hr]))!.id;
  await query(`INSERT INTO project_members (project_id, user_id, member_role) VALUES ($1, $2, 'developer')`, [P1, U.dev]);
  const tomorrow = pktDate(new Date(), 1);
  for (const [pid, no, n, title, due] of [[P1, 'PRJ-0001', 1, 'Zebra booking widget', tomorrow], [P2, 'PRJ-0002', 1, 'Yak booking secret sauce', null]] as const) {
    const t = await queryOne<{ id: number }>(
      `INSERT INTO tickets (project_id, number, key, title, description, status, created_by, due_date) VALUES ($1, $2, $3, $4, 'booking flow', 'in_progress', $5, $6) RETURNING id`,
      [pid, n, `${no}-T${n}`, title, U.hr, due]
    );
    if (pid === P1) await query(`INSERT INTO ticket_assignees (ticket_id, user_id) VALUES ($1, $2)`, [t!.id, U.dev]);
  }
  await query(`INSERT INTO project_messages (project_id, user_id, body) VALUES ($1, $2, 'Client says the zebra logo is final'), ($3, $4, 'Yak recipe is confidential')`, [P1, U.agentA, P2, U.agentB]);
  await query(`INSERT INTO media_files (project_id, entity_type, entity_id, storage_path, file_name, mime_type, size_bytes, description, status, uploaded_by)
               VALUES ($1, 'project', $5, 'p1/a', 'zebra-logo.png', 'image/png', 10, 'final logo', 'ready', $2),
                      ($3, 'project', $6, 'p2/a', 'yak-contract.pdf', 'application/pdf', 10, 'signed contract', 'ready', $4)`, [P1, U.agentA, P2, U.agentB, String(P1), String(P2)]);
});
afterAll(async () => { setEmailSender(null); await pool.end(); });

describe('notify()', () => {
  it('skips the actor and de-dupes the same unread notification within a minute', async () => {
    await notify({ users: [U.dev, U.hr], actorId: U.hr, type: 'ticket_status', body: 'Same thing', link: `/projects/${P1}` });
    await notify({ users: [U.dev], actorId: U.hr, type: 'ticket_status', body: 'Same thing', link: `/projects/${P1}` });
    const rows = await query(`SELECT user_id, project_id FROM notifications_inbox WHERE body = 'Same thing'`);
    expect(rows).toEqual([{ user_id: String(U.dev), project_id: P1 }]);
  });

  it('honours preferences: off = nothing, email = inbox + email', async () => {
    await json(inboxPrefs.PUT(req('dev', '/api/inbox/prefs', 'PUT', { prefs: { ticket_comment: 'off', mention: 'email' } }), NO_CTX));
    await notify({ users: [U.dev], actorId: null, type: 'ticket_comment', body: 'muted', link: null });
    await notify({ users: [U.dev], actorId: null, type: 'mention', body: 'you were mentioned', link: `/projects/${P1}` });
    expect(await query(`SELECT 1 FROM notifications_inbox WHERE body = 'muted'`)).toHaveLength(0);
    expect(sent.map((m) => m.to)).toEqual(['dev@test.local']);
    expect((await queryOne<{ emailed_at: string | null }>(`SELECT emailed_at FROM notifications_inbox WHERE body = 'you were mentioned'`))!.emailed_at).not.toBeNull();
  });

  it('rejects unknown types and channels in preferences', async () => {
    expect((await json(inboxPrefs.PUT(req('dev', '/api/inbox/prefs', 'PUT', { prefs: { nope: 'email' } }), NO_CTX))).status).toBe(400);
    expect((await json(inboxPrefs.PUT(req('dev', '/api/inbox/prefs', 'PUT', { prefs: { mention: 'sms' } }), NO_CTX))).status).toBe(400);
    const p = await json(inboxPrefs.GET(req('dev', '/api/inbox/prefs'), NO_CTX));
    expect(p.body.data.types.find((t: any) => t.type === 'mention').channel).toBe('email');
  });
});

describe('inbox', () => {
  it('shows inbox and training notifications together, with an unread count', async () => {
    await query(`INSERT INTO training_notifications (user_id, type, body) VALUES ($1, 'lesson', 'Training thing')`, [U.dev]);
    const r = await getInbox('dev');
    const bodies = r.body.data.items.map((i: any) => i.body);
    expect(bodies).toEqual(expect.arrayContaining(['Same thing', 'you were mentioned', 'Training thing']));
    expect(r.body.data.unread_count).toBe(3);
    expect((await getInbox('dev', 'tab=mentions')).body.data.items.map((i: any) => i.body)).toEqual(['you were mentioned']);
    expect((await getInbox('dev', `tab=all&project_id=${P1}`)).body.data.items.every((i: any) => i.project_id === P1)).toBe(true);
  });

  it('only shows your own notifications', async () => {
    const r = await getInbox('outsider');
    expect(r.body.data.items).toEqual([]);
  });

  it('marks read / unread / all read; cannot touch someone else’s', async () => {
    const items = (await getInbox('dev')).body.data.items;
    const one = items.find((i: any) => i.body === 'Same thing');
    await json(inboxRead.POST(req('outsider', '/api/inbox/read', 'POST', { ids: [one.id] }), NO_CTX));
    expect((await getInbox('dev', 'tab=unread')).body.data.unread_count).toBe(3);
    await json(inboxRead.POST(req('dev', '/api/inbox/read', 'POST', { ids: [one.id] }), NO_CTX));
    expect((await getInbox('dev')).body.data.unread_count).toBe(2);
    await json(inboxRead.POST(req('dev', '/api/inbox/read', 'POST', { ids: [one.id], unread: true }), NO_CTX));
    expect((await getInbox('dev')).body.data.unread_count).toBe(3);
    await json(inboxRead.POST(req('dev', '/api/inbox/read', 'POST', {}), NO_CTX));
    expect((await getInbox('dev')).body.data.unread_count).toBe(0);
  });

  it('snooze hides a notification until its time, then it comes back unread', async () => {
    await notify({ users: [U.dev], actorId: null, type: 'ticket_done', body: 'Snooze me', link: null });
    const item = (await getInbox('dev', 'tab=unread')).body.data.items.find((i: any) => i.body === 'Snooze me');
    const until = new Date(Date.now() + 3600_000).toISOString();
    expect((await json(inboxSnooze.POST(req('outsider', '/api/inbox/snooze', 'POST', { id: item.id, until }), NO_CTX))).status).toBe(404);
    expect((await json(inboxSnooze.POST(req('dev', '/api/inbox/snooze', 'POST', { id: item.id, until: '2000-01-01' }), NO_CTX))).status).toBe(400);
    expect((await json(inboxSnooze.POST(req('dev', '/api/inbox/snooze', 'POST', { id: item.id, until }), NO_CTX))).status).toBe(200);
    let r = await getInbox('dev', 'tab=unread');
    expect(r.body.data.items.some((i: any) => i.body === 'Snooze me')).toBe(false);
    expect(r.body.data.snoozed_count).toBe(1);
    await query(`UPDATE notifications_inbox SET snoozed_until = NOW() - INTERVAL '1 second' WHERE body = 'Snooze me'`);
    r = await getInbox('dev', 'tab=unread');
    expect(r.body.data.items.some((i: any) => i.body === 'Snooze me')).toBe(true);
  });
});

describe('scheduled notifications', () => {
  it('due tomorrow: notifies the assignee once per ticket per day', async () => {
    expect(await dueTomorrow()).toBe(1);
    expect(await dueTomorrow()).toBe(0);
    expect(await query(`SELECT 1 FROM notifications_inbox WHERE user_id = $1 AND type = 'ticket_due'`, [U.dev])).toHaveLength(1);
  });

  it('daily digest: emails opted-in users their unread items, once a day', async () => {
    sent.length = 0;
    await json(inboxPrefs.PUT(req('dev', '/api/inbox/prefs', 'PUT', { digest_enabled: true }), NO_CTX));
    expect(await sendDigests()).toBe(1);
    expect(sent[0].to).toBe('dev@test.local');
    expect(sent[0].html).toContain('due tomorrow');
    expect(await sendDigests()).toBe(0);
  });
});

describe('project notifications', () => {
  it('a developer added to a project is told; the agent hears about status changes', async () => {
    await json(members.POST(req('hr', `/api/projects/${P2}/members`, 'POST', { user_id: U.outsider }), { params: { id: String(P2) } }));
    expect(await query(`SELECT 1 FROM notifications_inbox WHERE user_id = $1 AND type = 'project_assigned'`, [U.outsider])).toHaveLength(1);
    await json(status.POST(req('hr', `/api/projects/${P1}/status`, 'POST', { status: 'in_progress' }), { params: { id: String(P1) } }));
    expect(await query(`SELECT 1 FROM notifications_inbox WHERE user_id = $1 AND type = 'project_status'`, [U.agentA])).toHaveLength(1);
    await query(`DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`, [P2, U.outsider]);
  });
});

describe('global search never shows what you can’t see', () => {
  it('agent A finds their own client’s items, not agent B’s', async () => {
    const a = kinds(await doSearch('agentA', 'booking'));
    expect(a.ticket).toEqual(['PRJ-0001-T1 Zebra booking widget']);
    expect(JSON.stringify(a)).not.toMatch(/Yak/);
    expect(JSON.stringify(kinds(await doSearch('agentA', 'yak')))).toBe('{}');
    expect(JSON.stringify(kinds(await doSearch('agentA', 'confidential contract recipe')))).toBe('{}');
  });

  it('a developer sees only projects they are on; an outsider sees nothing', async () => {
    expect(kinds(await doSearch('dev', 'zebra'))).toMatchObject({ project: ['PRJ-0001 Zebra dental site'], file: ['zebra-logo.png'] });
    expect(JSON.stringify(kinds(await doSearch('dev', 'yak')))).toBe('{}');
    expect(JSON.stringify(kinds(await doSearch('outsider', 'booking')))).toBe('{}');
  });

  it('HR sees everything', async () => {
    expect(kinds(await doSearch('hr', 'booking')).ticket).toHaveLength(2);
    expect(kinds(await doSearch('hr', 'signed contract')).file).toEqual(['yak-contract.pdf']);
  });

  it('jumping to a ticket key only works for tickets you can see', async () => {
    expect((await doSearch('dev', 'PRJ-0001-T1')).body.data.jump).toBe(`/projects/${P1}/tickets/PRJ-0001-T1`);
    const hidden = await doSearch('dev', 'PRJ-0002-T1');
    expect(hidden.body.data.jump).toBeNull();
    expect(hidden.body.data.groups).toEqual([]);
  });

  it('filters work and stay permission-filtered', async () => {
    expect(kinds(await doSearch('dev', 'assignee:me')).ticket).toEqual(['PRJ-0001-T1 Zebra booking widget']);
    expect(kinds(await doSearch('hr', 'status:"In progress" project:PRJ-0002')).ticket).toEqual(['PRJ-0002-T1 Yak booking secret sauce']);
    expect(JSON.stringify(kinds(await doSearch('agentA', 'project:PRJ-0002 status:in_progress')))).toBe('{}');
    expect(kinds(await doSearch('dev', 'due:tomorrow')).ticket).toHaveLength(1);
  });
});
