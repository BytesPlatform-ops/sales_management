/**
 * Phase 3 end to end: brief timeline (permissions, versions, marks, convert,
 * search) and the project thread (drafts with files, voice, edit/delete windows,
 * HR overrides, pins, forwards, read receipts) through the real routes.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { assertSafeDb, resetDb, tokenFor } from './db';

assertSafeDb();
process.env.MEDIA_STORAGE = 'local';

import { pool, query, queryOne } from '@/lib/db';
import * as briefRoute from '@/app/api/projects/[id]/brief/route';
import * as entryRoute from '@/app/api/brief/[entryId]/route';
import * as restoreRoute from '@/app/api/brief/[entryId]/restore/route';
import * as versionsRoute from '@/app/api/brief/[entryId]/versions/route';
import * as marksRoute from '@/app/api/brief/[entryId]/marks/route';
import * as convertRoute from '@/app/api/brief/[entryId]/convert/route';
import * as messagesRoute from '@/app/api/projects/[id]/messages/route';
import * as messageRoute from '@/app/api/projects/[id]/messages/[msgId]/route';
import * as publishRoute from '@/app/api/projects/[id]/messages/[msgId]/publish/route';
import * as pinRoute from '@/app/api/projects/[id]/messages/[msgId]/pin/route';
import * as forwardRoute from '@/app/api/projects/[id]/messages/[msgId]/forward/route';
import * as toBriefRoute from '@/app/api/projects/[id]/messages/[msgId]/brief/route';
import * as pinnedRoute from '@/app/api/projects/[id]/messages/pinned/route';
import * as uploadUrl from '@/app/api/media/upload-url/route';
import * as complete from '@/app/api/media/[id]/complete/route';
import * as mediaList from '@/app/api/media/route';
import * as localMedia from '@/app/api/media/local/route';
import * as searchRoute from '@/app/api/search/route';
import * as summaryRoute from '@/app/api/projects/summary/route';

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
const ep = (id: number) => ({ params: { entryId: String(id) } });
const mp = (msgId: number, pid = P) => ({ params: { id: String(pid), msgId: String(msgId) } });
const notes = (user: number, type: string) => query(`SELECT body FROM notifications_inbox WHERE user_id = $1 AND type = $2`, [user, type]);

const addEntry = (who: Who, body: any) => call(briefRoute.POST(req(who, `/api/projects/${P}/brief`, 'POST', body), pp(P)));
const listBrief = (who: Who, qs = '') => call(briefRoute.GET(req(who, `/api/projects/${P}/brief?${qs}`), pp(P)));
const post = (who: Who, body: any, pid = P) => call(messagesRoute.POST(req(who, `/api/projects/${pid}/messages`, 'POST', body), pp(pid)));
const poll = (who: Who, qs = '', pid = P) => call(messagesRoute.GET(req(who, `/api/projects/${pid}/messages${qs}`), pp(pid)));

async function upload(who: Who, target: { entity_type: string; entity_id: number }, extra: any = {}) {
  const r = await call(uploadUrl.POST(req(who, '/api/media/upload-url', 'POST',
    { ...target, file_name: 'note.webm', mime_type: 'audio/webm;codecs=opus', size_bytes: 4, description: 'x', ...extra }), NO_CTX));
  if (r.status !== 200) return r;
  await localMedia.PUT(new NextRequest(`http://test${r.body.data.upload.url}`, { method: 'PUT', body: new Uint8Array([1, 2, 3, 4]) }), NO_CTX);
  await complete.POST(req(who, `/api/media/${r.body.data.id}/complete`, 'POST', {}), { params: { id: r.body.data.id } });
  return r;
}

beforeAll(async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-secret';
  await resetDb();
  for (const [k, role] of [['hr', 'hr'], ['agent', 'agent'], ['otherAgent', 'agent'], ['dev', 'developer'], ['lead', 'developer'], ['outsider', 'developer']] as const) {
    const row = await queryOne<{ id: string }>(`INSERT INTO users (username, full_name, role) VALUES ($1, $2, $3) RETURNING id`, [k.toLowerCase(), k, role]);
    U[k] = Number(row!.id);
    T[k] = await tokenFor({ id: U[k], username: k.toLowerCase(), role });
  }
  P = (await queryOne<{ id: number }>(`INSERT INTO projects (title, client_name, description, created_by, supervisor_id) VALUES ('Acme', 'Acme', 'Five pages', $1, $2) RETURNING id`, [U.agent, U.hr]))!.id;
  P2 = (await queryOne<{ id: number }>(`INSERT INTO projects (title, client_name, created_by, supervisor_id) VALUES ('Other', 'Other', $1, $2) RETURNING id`, [U.otherAgent, U.hr]))!.id;
  await query(`INSERT INTO project_members (project_id, user_id, member_role) VALUES ($1, $2, 'developer'), ($1, $3, 'lead_developer')`, [P, U.dev, U.lead]);
});
afterAll(() => pool.end());

describe('brief timeline', () => {
  let entryId = 0;

  it('has the project description as its original version 1', async () => {
    const r = await listBrief('dev');
    expect(r.status).toBe(200);
    const orig = r.body.data.entries.find((e: any) => e.is_original);
    expect(orig.body).toBe('Five pages');
    expect(r.body.data.can).toEqual({ add: false, mark: true, restore: false });
  });

  it('only HR and the client’s agent add; outsiders can’t even read', async () => {
    expect((await addEntry('dev', { type: 'requirement', body: 'x' })).status).toBe(403);
    expect((await addEntry('otherAgent', { type: 'requirement', body: 'x' })).status).toBe(404);
    expect((await listBrief('outsider')).status).toBe(404);
    const r = await addEntry('agent', { type: 'change', body: 'Add a blog with three categories', tags: ['waiting_on_client'] });
    expect(r.status).toBe(200);
    entryId = r.body.data.id;
  });

  it('a new entry posts to the thread, notifies the developers and counts as activity', async () => {
    const sys = await query<{ body: string }>(`SELECT body FROM project_messages WHERE project_id = $1 AND kind = 'system' ORDER BY id DESC LIMIT 1`, [P]);
    expect(sys[0].body).toMatch(/added a brief update \(Change\)/);
    expect((await notes(U.dev, 'brief_update')).length).toBe(1);
    expect((await notes(U.lead, 'brief_update')).length).toBe(1);
    expect((await queryOne<{ a: string | null }>(`SELECT last_activity_at AS a FROM projects WHERE id = $1`, [P]))!.a).not.toBeNull();
  });

  it('brief files need a description and only the adders can attach', async () => {
    expect((await upload('agent', { entity_type: 'brief_entry', entity_id: entryId }, { description: '' })).body.message).toMatch(/description/);
    expect((await upload('dev', { entity_type: 'brief_entry', entity_id: entryId })).status).toBe(403);
    expect((await upload('agent', { entity_type: 'brief_entry', entity_id: entryId }, { file_name: 'logo.png', mime_type: 'image/png', description: 'Client logo' })).status).toBe(200);
    const s = await listBrief('dev', 'q=client%20logo');
    expect(s.body.data.entries.map((e: any) => e.id)).toContain(entryId);
  });

  it('edits within 24h stay the same version; older ones become a new version; history is kept', async () => {
    const patch = (who: Who, body: any) => call(entryRoute.PATCH(req(who, `/api/brief/${entryId}`, 'PATCH', body), ep(entryId)));
    expect((await patch('dev', { body: 'x' })).status).toBe(403);
    expect((await patch('agent', { body: 'Add a blog with four categories' })).body.data).toMatchObject({ version: 1, mode: 'in_place' });
    await query(`UPDATE brief_entries SET created_at = NOW() - INTERVAL '2 days' WHERE id = $1`, [entryId]);
    expect((await patch('agent', { body: 'Add a blog with five categories' })).body.data).toMatchObject({ version: 2, mode: 'new_version' });
    const v = await call(versionsRoute.GET(req('dev', `/api/brief/${entryId}/versions`), ep(entryId)));
    expect(v.body.data.map((x: any) => x.body)).toEqual(['Add a blog with four categories', 'Add a blog with three categories']);
  });

  it('developers mark seen / ask; the agent is notified and answers', async () => {
    const mark = (who: Who, body: any) => call(marksRoute.POST(req(who, `/api/brief/${entryId}/marks`, 'POST', body), ep(entryId)));
    expect((await mark('agent', { kind: 'seen' })).status).toBe(403);
    expect((await mark('dev', { kind: 'seen' })).status).toBe(200);
    expect((await mark('dev', { kind: 'seen' })).status).toBe(200);
    const q = await mark('dev', { kind: 'need_clarification', comment: 'Which categories?' });
    expect((await notes(U.agent, 'brief_clarification')).length).toBe(1);
    expect((await mark('dev', { kind: 'resolve', mark_id: q.body.data.id, resolution: 'News, tips, offers' })).status).toBe(403);
    expect((await mark('agent', { kind: 'resolve', mark_id: q.body.data.id, resolution: 'News, tips, offers' })).status).toBe(200);
    expect((await notes(U.dev, 'brief_clarified')).length).toBe(1);
    const e = (await listBrief('dev')).body.data.entries.find((x: any) => x.id === entryId);
    expect(e.marks.filter((m: any) => m.kind === 'seen').length).toBe(1);
  });

  it('a Change entry converts once into a change request in Triage', async () => {
    const conv = () => call(convertRoute.POST(req('agent', `/api/brief/${entryId}/convert`, 'POST', {}), ep(entryId)));
    const r = await conv();
    expect(r.status).toBe(200);
    const t = await queryOne<any>(`SELECT type, status, cr_status, created_via, source_brief_entry_id FROM tickets WHERE id = $1`, [r.body.data.id]);
    expect(t).toMatchObject({ type: 'change_request', status: 'triage', cr_status: 'pending', created_via: 'brief', source_brief_entry_id: entryId });
    expect((await conv()).status).toBe(409);
  });

  it('soft delete by the author; only HR restores; the original can’t be deleted', async () => {
    const del = (who: Who, id: number) => call(entryRoute.DELETE(req(who, `/api/brief/${id}`, 'DELETE'), ep(id)));
    const orig = (await listBrief('agent')).body.data.entries.find((e: any) => e.is_original);
    expect((await del('agent', orig.id)).status).toBe(400);
    expect((await del('agent', entryId)).status).toBe(200);
    expect((await listBrief('dev')).body.data.entries.some((e: any) => e.id === entryId)).toBe(false);
    expect((await call(restoreRoute.POST(req('agent', `/api/brief/${entryId}/restore`, 'POST'), ep(entryId)))).status).toBe(403);
    expect((await call(restoreRoute.POST(req('hr', `/api/brief/${entryId}/restore`, 'POST'), ep(entryId)))).status).toBe(200);
  });

  it('is searchable, but never from a project you can’t see', async () => {
    const s = (who: Who) => call(searchRoute.GET(req(who, '/api/search?q=categories'), NO_CTX));
    const kinds = (r: any) => (r.body.data.groups || []).map((g: any) => g.kind);
    expect(kinds(await s('dev'))).toContain('brief');
    expect(kinds(await s('outsider'))).not.toContain('brief');
  });
});

describe('project thread', () => {
  it('outsiders can’t read or post', async () => {
    expect((await poll('outsider')).status).toBe(404);
    expect((await post('otherAgent', { body: 'hi' })).status).toBe(404);
  });

  it('messages with files are drafts until published; nobody else sees a draft', async () => {
    const before = (await poll('agent')).body.data.messages.length;
    const d = await post('dev', { kind: 'media', body: 'Screens', draft: true });
    expect(d.body.data.draft).toBe(true);
    // Only the author may attach to their draft.
    expect((await upload('agent', { entity_type: 'message', entity_id: d.body.data.id })).status).toBe(403);
    // Publishing with nothing attached is refused.
    expect((await call(publishRoute.POST(req('dev', '/', 'POST', {}), mp(d.body.data.id)))).status).toBe(400);
    await upload('dev', { entity_type: 'message', entity_id: d.body.data.id }, { file_name: 'shot.png', mime_type: 'image/png' });
    expect((await poll('agent')).body.data.messages.length).toBe(before);
    expect((await call(mediaList.GET(req('agent', `/api/media?entity_type=message&entity_id=${d.body.data.id}`), NO_CTX))).status).toBe(404);
    const pub = await call(publishRoute.POST(req('dev', '/', 'POST', {}), mp(d.body.data.id)));
    expect(pub.status).toBe(200);
    expect(pub.body.data.id).toBeGreaterThan(d.body.data.id);
    expect(pub.body.data.media.map((f: any) => f.file_name)).toEqual(['shot.png']);
    const after = await poll('agent', `?after=${d.body.data.id - 1}`);
    expect(after.body.data.messages.some((m: any) => m.id === pub.body.data.id)).toBe(true);
    // The Media tab lists it.
    const media = await call(mediaList.GET(req('agent', `/api/media?project_id=${P}&entity_types=message`), NO_CTX));
    expect(media.body.data.map((f: any) => f.file_name)).toContain('shot.png');
  });

  it('voice notes: ≤ 5 minutes, one recording, stored as kind voice', async () => {
    expect((await post('dev', { kind: 'voice', draft: true, meta: { duration: 400 } })).status).toBe(400);
    const d = await post('dev', { kind: 'voice', draft: true, meta: { duration: 3.2, peaks: [0.1, 0.9] } });
    await upload('dev', { entity_type: 'message', entity_id: d.body.data.id }, { kind: 'voice' });
    const pub = await call(publishRoute.POST(req('dev', '/', 'POST', {}), mp(d.body.data.id)));
    expect(pub.body.data.kind).toBe('voice');
    expect(pub.body.data.media[0].kind).toBe('voice');
    expect(pub.body.data.media[0].mime_type).toBe('audio/webm');
    expect(pub.body.data.meta).toEqual({ duration: 3.2, peaks: [0.1, 0.9] });
  });

  it('edit/delete your own within 15 minutes; HR can delete any time; others never', async () => {
    const m = (await post('dev', { body: 'typo here' })).body.data;
    const edit = (who: Who, id: number) => call(messageRoute.PATCH(req(who, '/', 'PATCH', { body: 'fixed' }), mp(id)));
    const del = (who: Who, id: number) => call(messageRoute.DELETE(req(who, '/', 'DELETE'), mp(id)));
    expect((await edit('agent', m.id)).status).toBe(403);
    expect((await edit('dev', m.id)).body.data.body).toBe('fixed');
    await query(`UPDATE project_messages SET created_at = NOW() - INTERVAL '20 minutes' WHERE id = $1`, [m.id]);
    expect((await edit('dev', m.id)).body.message).toMatch(/15 minutes/);
    expect((await del('dev', m.id)).status).toBe(403);
    expect((await del('hr', m.id)).status).toBe(200);
    const row = (await poll('agent')).body.data.messages.find((x: any) => x.id === m.id);
    expect(row.deleted_at).not.toBeNull();
    expect(row.body).toBe('');
  });

  it('edits and deletes reach other people’s polling via `since`', async () => {
    const m = (await post('dev', { body: 'first' })).body.data;
    const p1 = (await poll('agent')).body.data;
    const last = p1.messages[p1.messages.length - 1].id;
    await new Promise((r) => setTimeout(r, 20));
    await messageRoute.PATCH(req('dev', '/', 'PATCH', { body: 'second' }), mp(m.id));
    const p2 = await poll('agent', `?after=${last}&since=${encodeURIComponent(p1.now)}`);
    expect(p2.body.data.changed.map((x: any) => x.body)).toContain('second');
  });

  it('anyone in the thread pins; pinned list shows it', async () => {
    const m = (await post('agent', { body: 'Client call on Friday 3pm EST' })).body.data;
    expect((await call(pinRoute.POST(req('dev', '/', 'POST', { pinned: true }), mp(m.id)))).body.data.pinned_at).not.toBeNull();
    const pinned = await call(pinnedRoute.GET(req('agent', '/'), pp(P)));
    expect(pinned.body.data.map((x: any) => x.id)).toContain(m.id);
  });

  it('only HR forwards (files copied); agents add messages to the brief', async () => {
    const m = (await post('agent', { body: 'Please use the new logo' })).body.data;
    const fwd = (who: Who) => call(forwardRoute.POST(req(who, '/', 'POST', { project_id: P2 }), mp(m.id)));
    expect((await fwd('agent')).status).toBe(403);
    const r = await fwd('hr');
    expect(r.status).toBe(200);
    const other = (await poll('otherAgent', '', P2)).body.data.messages.find((x: any) => x.id === r.body.data.id);
    expect(other.forwarded_from.ticket_no).toBeTruthy();
    expect(other.body).toBe('Please use the new logo');

    expect((await call(toBriefRoute.POST(req('dev', '/', 'POST', { type: 'feedback' }), mp(m.id)))).status).toBe(403);
    const b = await call(toBriefRoute.POST(req('agent', '/', 'POST', { type: 'feedback' }), mp(m.id)));
    expect(b.status).toBe(200);
    expect((await queryOne<{ source_message_id: number }>(`SELECT source_message_id FROM brief_entries WHERE id = $1`, [b.body.data.id]))!.source_message_id).toBe(m.id);
  });

  it('read receipts: each participant’s read pointer, and the viewer’s pointer before this read', async () => {
    const m = (await post('dev', { body: 'read me' })).body.data;
    const first = (await poll('lead')).body.data;
    expect(first.participants.map(Number).sort()).toEqual([U.hr, U.agent, U.dev, U.lead].sort());
    const again = (await poll('lead')).body.data;
    expect(again.last_read).toBeGreaterThanOrEqual(m.id);
    const lead = again.reads.find((r: any) => Number(r.user_id) === U.lead);
    expect(Number(lead.last_read)).toBeGreaterThanOrEqual(m.id);
  });

  it('unread counts ignore drafts and deleted messages', async () => {
    await poll('agent');
    const d = await post('dev', { kind: 'media', draft: true });
    const s = await call(summaryRoute.GET(req('agent', '/api/projects/summary'), NO_CTX));
    expect(s.body.data.unread).toBe(0);
    await call(messageRoute.DELETE(req('dev', '/', 'DELETE'), mp(d.body.data.id)));
    expect(await queryOne(`SELECT 1 FROM project_messages WHERE id = $1`, [d.body.data.id])).toBeNull();
  });

  it('@mentions in the thread notify', async () => {
    await post('dev', { body: 'ping @agent' });
    expect((await notes(U.agent, 'thread_mention')).length).toBeGreaterThan(0);
  });
});
