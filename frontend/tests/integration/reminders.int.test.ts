/**
 * Reminders end to end: permissions, exactly-once delivery (even with concurrent
 * runners), snooze, repeat, done, automatic reminders, and the CEO Admin-mode rule.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { assertSafeDb, resetDb } from './db';

assertSafeDb();

import { pool, query, queryOne } from '@/lib/db';
import { issueSession } from '@/lib/auth/session';
import { runReminders } from '@/lib/reminders/runner';
import { runAutoReminders } from '@/lib/reminders/auto';
import { runSearch } from '@/lib/search/sources';
import { parseSearch } from '@/lib/search/query';
import * as reminders from '@/app/api/reminders/route';
import * as reminderItem from '@/app/api/reminders/[id]/route';
import * as reminderDone from '@/app/api/reminders/[id]/done/route';
import * as reminderSnooze from '@/app/api/reminders/[id]/snooze/route';
import * as assignees from '@/app/api/reminders/assignees/route';
import * as settings from '@/app/api/projects/[id]/reminder-settings/route';
import * as marks from '@/app/api/brief/[entryId]/marks/route';
import * as adminMode from '@/app/api/auth/admin-mode/route';

const NO_CTX = {} as any;
const U: Record<string, number> = {};
const T: Record<string, string> = {};
let P = 0;
let TICKET = 0;
const PW = 'ceo-password-1';

function req(who: string, url: string, method = 'GET', body?: unknown) {
  return new NextRequest(`http://test${url}`, {
    method,
    headers: { authorization: `Bearer ${T[who]}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
async function call(r: Promise<Response> | Response) {
  const res = await r;
  return { status: res.status, body: await res.json() };
}
const create = (who: string, body: any) => call(reminders.POST(req(who, '/api/reminders', 'POST', body), NO_CTX));
const idCtx = (id: number | string) => ({ params: { id: String(id) } });
const reminderNotes = (userId: number, reminderId?: number) =>
  query<{ id: string; body: string }>(
    `SELECT id, body FROM notifications_inbox WHERE user_id = $1 AND type = 'reminder' ${reminderId ? `AND entity_id = '${reminderId}'` : ''} ORDER BY id`, [userId]);
/** Pretend time passed: make the reminder's current moment be in the past. */
const makeDue = (id: number) => query(`UPDATE reminders SET due_at = LEAST(due_at, NOW() - INTERVAL '1 second'),
  snoozed_until = CASE WHEN snoozed_until IS NULL THEN NULL ELSE NOW() - INTERVAL '1 second' END WHERE id = $1`, [id]);
/** How many times the runner actually delivered it (notifications dedupe identical ones, so count fires). */
const fires = async (id: number) => (await queryOne<{ n: number }>(`SELECT fire_count AS n FROM reminders WHERE id = $1`, [id]))!.n;
const inFuture = (mins = 60) => new Date(Date.now() + mins * 60_000).toISOString();

beforeAll(async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-secret';
  await resetDb();
  for (const [k, role] of [['hr', 'hr'], ['ceo', 'ceo'], ['agent', 'agent'], ['otherAgent', 'agent'], ['dev', 'developer'], ['lead', 'developer'], ['outsider', 'developer']] as const) {
    const r = await queryOne<{ id: string }>(
      `INSERT INTO users (username, password, full_name, role) VALUES ($1, $2, $3, $4) RETURNING id`,
      [k.toLowerCase(), bcrypt.hashSync(PW, 4), `${k} name`, role]
    );
    U[k] = Number(r!.id);
    T[k] = (await issueSession({ id: U[k], username: k.toLowerCase(), role, full_name: k }, new NextRequest('http://test/'))).token;
  }
  P = (await queryOne<{ id: number }>(
    `INSERT INTO projects (title, client_name, created_by, supervisor_id, project_type, recurrence) VALUES ('Acme', 'Acme', $1, $2, 'recurring', 'monthly') RETURNING id`,
    [U.agent, U.hr]))!.id;
  await query(`INSERT INTO project_members (project_id, user_id, member_role) VALUES ($1, $2, 'developer'), ($1, $3, 'lead_developer')`, [P, U.dev, U.lead]);
  TICKET = (await queryOne<{ id: number }>(
    `INSERT INTO tickets (project_id, number, key, title, status, created_by) VALUES ($1, 1, 'PRJ-0001-T1', 'Booking page', 'open', $2) RETURNING id`,
    [P, U.dev]))!.id;
});
afterAll(() => pool.end());

describe('who can set reminders', () => {
  it('a developer reminds themselves about a ticket, but nobody else', async () => {
    const mine = await create('dev', { entity_type: 'ticket', entity_id: TICKET, title: 'Check the fix', preset: '1h' });
    expect(mine.status).toBe(200);
    expect(Number(mine.body.data.assigned_to)).toBe(U.dev);
    const other = await create('dev', { entity_type: 'ticket', entity_id: TICKET, title: 'x', preset: '1h', assigned_to: U.lead });
    expect(other.status).toBe(403);
  });

  it('an agent can remind a project developer, not someone who can’t see the project', async () => {
    const ok = await create('agent', { entity_type: 'ticket', entity_id: TICKET, title: 'Ask the client', preset: '1h', assigned_to: U.dev });
    expect(ok.status).toBe(200);
    const bad = await create('agent', { entity_type: 'ticket', entity_id: TICKET, title: 'x', preset: '1h', assigned_to: U.outsider });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/can’t see/);
  });

  it('nobody can set a reminder about something they can’t see', async () => {
    expect((await create('outsider', { entity_type: 'ticket', entity_id: TICKET, title: 'x', preset: '1h' })).status).toBe(404);
    expect((await create('otherAgent', { entity_type: 'project', entity_id: P, title: 'x', preset: '1h' })).status).toBe(404);
  });

  it('standalone reminders are personal (except HR)', async () => {
    expect((await create('agent', { title: 'Call back', preset: '1h' })).status).toBe(200);
    expect((await create('agent', { title: 'x', preset: '1h', assigned_to: U.dev })).status).toBe(403);
    expect((await create('hr', { title: 'Payroll check', preset: '1h', assigned_to: U.agent })).status).toBe(200);
  });

  it('the assignee picker only offers people who can see the item', async () => {
    const a = await call(assignees.GET(req('agent', `/api/reminders/assignees?entity_type=ticket&entity_id=${TICKET}`), NO_CTX));
    const ids = a.body.data.users.map((u: any) => Number(u.id));
    expect(ids).toContain(U.dev);
    expect(ids).not.toContain(U.outsider);
    const d = await call(assignees.GET(req('dev', `/api/reminders/assignees?entity_type=ticket&entity_id=${TICKET}`), NO_CTX));
    expect(d.body.data.can_assign_others).toBe(false);
  });

  it('only the assignee or the person who set it can see a reminder', async () => {
    const r = (await create('lead', { entity_type: 'project', entity_id: P, title: 'Lead only', preset: '1h' })).body.data;
    expect((await call(reminderItem.GET(req('dev', `/api/reminders/${r.id}`), idCtx(r.id)))).status).toBe(404);
    expect((await call(reminderItem.GET(req('lead', `/api/reminders/${r.id}`), idCtx(r.id)))).status).toBe(200);
  });

  it('a CEO sets their own reminders without Admin mode, but needs it to remind someone else', async () => {
    expect((await create('ceo', { entity_type: 'project', entity_id: P, title: 'CEO note', preset: '1h' })).status).toBe(200);
    const blocked = await create('ceo', { entity_type: 'project', entity_id: P, title: 'x', preset: '1h', assigned_to: U.agent });
    expect(blocked.status).toBe(403);
    expect(blocked.body.message).toMatch(/Admin mode/);
    const admin = await call(adminMode.POST(req('ceo', '/api/auth/admin-mode', 'POST', { password: PW }), NO_CTX));
    const saved = T.ceo;
    T.ceo = admin.body.data.token;
    try {
      expect((await create('ceo', { entity_type: 'project', entity_id: P, title: 'For the agent', preset: '1h', assigned_to: U.agent })).status).toBe(200);
    } finally {
      T.ceo = saved;
    }
  });
});

describe('delivery', () => {
  it('fires once when due, never twice', async () => {
    const r = (await create('dev', { entity_type: 'ticket', entity_id: TICKET, title: 'Fire once', preset: 'pick', until: inFuture() })).body.data;
    await runReminders();
    expect(await reminderNotes(U.dev, r.id)).toHaveLength(0); // not due yet
    await makeDue(r.id);
    expect(await runReminders()).toBeGreaterThanOrEqual(1);
    await runReminders();
    await runReminders();
    expect(await fires(r.id)).toBe(1);
    const n = await reminderNotes(U.dev, r.id);
    expect(n).toHaveLength(1);
    expect(n[0].body).toContain('Fire once');
  });

  it('several runners at the same moment deliver exactly one notification', async () => {
    const r = (await create('dev', { entity_type: 'ticket', entity_id: TICKET, title: 'Race', preset: 'pick', until: inFuture() })).body.data;
    await makeDue(r.id);
    await Promise.all(Array.from({ length: 6 }, () => runReminders()));
    await Promise.all(Array.from({ length: 6 }, () => runReminders()));
    expect(await fires(r.id)).toBe(1);
    expect(await reminderNotes(U.dev, r.id)).toHaveLength(1);
  });

  it('snoozed to tomorrow fires once at the new time, not twice', async () => {
    const r = (await create('dev', { entity_type: 'ticket', entity_id: TICKET, title: 'Snooze me', preset: 'pick', until: inFuture() })).body.data;
    await makeDue(r.id);
    await runReminders();
    expect(await reminderNotes(U.dev, r.id)).toHaveLength(1);

    const s = await call(reminderSnooze.POST(req('dev', `/api/reminders/${r.id}/snooze`, 'POST', { preset: 'tomorrow' }), idCtx(r.id)));
    expect(s.status).toBe(200);
    const until = new Date(s.body.data.snoozed_until);
    expect(until.getUTCHours()).toBe(5); // 10:00 PKT
    expect(until.getTime()).toBeGreaterThan(Date.now());
    await runReminders();
    expect(await fires(r.id)).toBe(1); // nothing before tomorrow

    await makeDue(r.id); // tomorrow 10:00 arrives
    await runReminders();
    await runReminders();
    expect(await fires(r.id)).toBe(2); // exactly one more
    expect(await reminderNotes(U.dev, r.id)).toHaveLength(2);
  });

  it('only the assignee can snooze', async () => {
    const r = (await create('agent', { entity_type: 'ticket', entity_id: TICKET, title: 'For dev', preset: '1h', assigned_to: U.dev })).body.data;
    expect((await call(reminderSnooze.POST(req('agent', `/api/reminders/${r.id}/snooze`, 'POST', { preset: '1h' }), idCtx(r.id)))).status).toBe(403);
  });

  it('a daily reminder fires once and moves to the next day', async () => {
    const r = (await create('dev', { entity_type: 'ticket', entity_id: TICKET, title: 'Daily standup note', preset: 'pick', until: inFuture(), repeat_rule: 'daily' })).body.data;
    await query(`UPDATE reminders SET due_at = NOW() - INTERVAL '10 minutes' WHERE id = $1`, [r.id]);
    const before = (await queryOne<{ due_at: Date }>(`SELECT due_at FROM reminders WHERE id = $1`, [r.id]))!.due_at;
    await runReminders();
    await runReminders();
    expect(await fires(r.id)).toBe(1);
    expect(await reminderNotes(U.dev, r.id)).toHaveLength(1);
    const after = (await queryOne<{ due_at: Date; status: string }>(`SELECT due_at, status FROM reminders WHERE id = $1`, [r.id]))!;
    expect(after.status).toBe('open');
    expect(after.due_at.getTime() - before.getTime()).toBe(86_400_000);
  });

  it('a reminder marked done never fires', async () => {
    const r = (await create('dev', { entity_type: 'ticket', entity_id: TICKET, title: 'Done early', preset: 'pick', until: inFuture() })).body.data;
    expect((await call(reminderDone.POST(req('dev', `/api/reminders/${r.id}/done`, 'POST', {}), idCtx(r.id)))).status).toBe(200);
    await makeDue(r.id);
    await runReminders();
    expect(await fires(r.id)).toBe(0);
    expect(await reminderNotes(U.dev, r.id)).toHaveLength(0);
  });

  it('lists my reminders, and the ones I set for others', async () => {
    const mine = await call(reminders.GET(req('dev', '/api/reminders?scope=mine'), NO_CTX));
    expect(mine.body.data.every((r: any) => Number(r.assigned_to) === U.dev)).toBe(true);
    const created = await call(reminders.GET(req('agent', '/api/reminders?scope=created'), NO_CTX));
    expect(created.body.data.some((r: any) => Number(r.assigned_to) === U.dev)).toBe(true);
  });

  it('search finds only my own reminders', async () => {
    await create('lead', { entity_type: 'project', entity_id: P, title: 'Zanzibar invoice follow-up', preset: '1h' });
    const viewer = (role: string, id: number) => ({ userId: id, role: role as any, name: 'x' });
    const leadHits = await runSearch(viewer('developer', U.lead), parseSearch('Zanzibar', new Date().toISOString().slice(0, 10)));
    expect(leadHits.find((g) => g.kind === 'reminder')?.hits.length).toBe(1);
    const devHits = await runSearch(viewer('developer', U.dev), parseSearch('Zanzibar', new Date().toISOString().slice(0, 10)));
    expect(devHits.find((g) => g.kind === 'reminder')).toBeUndefined();
  });
});

describe('automatic reminders', () => {
  it('“Need clarification” schedules a reminder for the agent; answering cancels it', async () => {
    const e = (await queryOne<{ id: number }>(
      `INSERT INTO brief_entries (project_id, type, body, created_by) VALUES ($1, 'requirement', 'Logo files', $2) RETURNING id`, [P, U.agent]))!;
    const asked = await call(marks.POST(req('dev', `/api/brief/${e.id}/marks`, 'POST', { kind: 'need_clarification', comment: 'Which logo?' }), { params: { entryId: String(e.id) } }));
    expect(asked.status).toBe(200);
    const r = await queryOne<{ id: number; assigned_to: string; due_at: Date; status: string }>(
      `SELECT id, assigned_to, due_at, status FROM reminders WHERE auto_key = $1`, [`clarification:${asked.body.data.id}`]);
    expect(Number(r!.assigned_to)).toBe(U.agent);
    expect(Math.round((r!.due_at.getTime() - Date.now()) / 3600_000)).toBe(24);

    await call(marks.POST(req('agent', `/api/brief/${e.id}/marks`, 'POST', { kind: 'resolve', mark_id: asked.body.data.id, resolution: 'The blue one' }), { params: { entryId: String(e.id) } }));
    expect((await queryOne<{ status: string }>(`SELECT status FROM reminders WHERE id = $1`, [r!.id]))!.status).toBe('cancelled');
  });

  it('an unanswered clarification reaches the agent after the threshold', async () => {
    const e = (await queryOne<{ id: number }>(
      `INSERT INTO brief_entries (project_id, type, body, created_by) VALUES ($1, 'requirement', 'Pages', $2) RETURNING id`, [P, U.agent]))!;
    const asked = await call(marks.POST(req('dev', `/api/brief/${e.id}/marks`, 'POST', { kind: 'need_clarification', comment: 'How many pages?' }), { params: { entryId: String(e.id) } }));
    const r = (await queryOne<{ id: number }>(`SELECT id FROM reminders WHERE auto_key = $1`, [`clarification:${asked.body.data.id}`]))!;
    await makeDue(r.id);
    await runReminders();
    await runReminders();
    expect(await fires(r.id)).toBe(1);
    expect(await reminderNotes(U.agent, r.id)).toHaveLength(1);
  });

  it('client content pending for 3 days reminds the agent once; a follow-up cancels an unsent one', async () => {
    // Fresh projects: any newer brief update or message from the agent counts as a follow-up.
    const project = async () => (await queryOne<{ id: number }>(
      `INSERT INTO projects (title, client_name, created_by) VALUES ('Content', 'C', $1) RETURNING id`, [U.agent]))!.id;
    const P2 = await project();
    const e = (await queryOne<{ id: number }>(
      `INSERT INTO brief_entries (project_id, type, body, tags, created_by, created_at)
       VALUES ($1, 'requirement', 'Photos from client', '{waiting_on_client}', $2, NOW() - INTERVAL '4 days') RETURNING id`, [P2, U.agent]))!;
    // Not old enough yet on another project: no reminder.
    const P3 = await project();
    const young = (await queryOne<{ id: number }>(
      `INSERT INTO brief_entries (project_id, type, body, tags, created_by, created_at)
       VALUES ($1, 'requirement', 'Fonts', '{waiting_on_client}', $2, NOW() - INTERVAL '2 days') RETURNING id`, [P3, U.agent]))!;
    await runAutoReminders();
    await runAutoReminders();
    const rows = await query<{ id: number; assigned_to: string }>(`SELECT id, assigned_to FROM reminders WHERE auto_key = $1`, [`client_content:${e.id}`]);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].assigned_to)).toBe(U.agent);
    expect(await queryOne(`SELECT 1 FROM reminders WHERE auto_key = $1`, [`client_content:${young.id}`])).toBeNull();

    // The agent chases the client in the thread before the reminder fires → cancelled.
    await query(`INSERT INTO project_messages (project_id, user_id, kind, body) VALUES ($1, $2, 'message', 'Chased the client today')`, [P2, U.agent]);
    await runAutoReminders();
    expect((await queryOne<{ status: string }>(`SELECT status FROM reminders WHERE id = $1`, [rows[0].id]))!.status).toBe('cancelled');
  });

  it('a meeting that ended without notes reminds its organiser; adding notes cancels it', async () => {
    const m = (await queryOne<{ id: number }>(
      `INSERT INTO project_meetings (project_id, title, starts_at, duration_min, created_by)
       VALUES ($1, 'Kickoff', NOW() - INTERVAL '4 hours', 30, $2) RETURNING id`, [P, U.agent]))!;
    await runAutoReminders();
    const r = await queryOne<{ id: number; assigned_to: string }>(`SELECT id, assigned_to FROM reminders WHERE auto_key = $1`, [`meeting_notes:${m.id}`]);
    expect(Number(r!.assigned_to)).toBe(U.agent);
    await query(`UPDATE project_meetings SET outcome = 'Agreed scope' WHERE id = $1`, [m.id]);
    await runAutoReminders();
    expect((await queryOne<{ status: string }>(`SELECT status FROM reminders WHERE id = $1`, [r!.id]))!.status).toBe('cancelled');
  });

  it('a recurring cycle renewing within 7 days reminds the agent', async () => {
    const c = (await queryOne<{ id: number }>(
      `INSERT INTO project_cycles (project_id, cycle_no, period_start, period_end, deadline)
       VALUES ($1, 1, CURRENT_DATE - 25, CURRENT_DATE + 5, CURRENT_DATE + 5) RETURNING id`, [P]))!;
    await runAutoReminders();
    const r = await queryOne<{ assigned_to: string; auto_kind: string }>(`SELECT assigned_to, auto_kind FROM reminders WHERE auto_key = $1`, [`cycle_renewal:${c.id}`]);
    expect(Number(r!.assigned_to)).toBe(U.agent);
  });

  it('turning a kind off per project stops new ones; only HR/lead/agent-owner may change settings', async () => {
    expect((await call(settings.PUT(req('dev', `/api/projects/${P}/reminder-settings`, 'PUT', { meeting_notes_enabled: false }), idCtx(P)))).status).toBe(403);
    expect((await call(settings.PUT(req('lead', `/api/projects/${P}/reminder-settings`, 'PUT', { meeting_notes_enabled: false }), idCtx(P)))).status).toBe(200);
    const m = (await queryOne<{ id: number }>(
      `INSERT INTO project_meetings (project_id, title, starts_at, duration_min, created_by)
       VALUES ($1, 'Review', NOW() - INTERVAL '5 hours', 30, $2) RETURNING id`, [P, U.agent]))!;
    await runAutoReminders();
    expect(await queryOne(`SELECT 1 FROM reminders WHERE auto_key = $1`, [`meeting_notes:${m.id}`])).toBeNull();
    const bad = await call(settings.PUT(req('agent', `/api/projects/${P}/reminder-settings`, 'PUT', { client_content_days: 0 }), idCtx(P)));
    expect(bad.status).toBe(400);
  });

  it('automatic reminders can be done or snoozed, not edited', async () => {
    const r = (await queryOne<{ id: number }>(`SELECT id FROM reminders WHERE auto_kind = 'cycle_renewal' LIMIT 1`))!;
    expect((await call(reminderItem.PATCH(req('agent', `/api/reminders/${r.id}`, 'PATCH', { title: 'x' }), idCtx(r.id)))).status).toBe(400);
    expect((await call(reminderSnooze.POST(req('agent', `/api/reminders/${r.id}/snooze`, 'POST', { preset: '1h' }), idCtx(r.id)))).status).toBe(200);
  });
});
