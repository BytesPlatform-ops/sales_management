/**
 * Sales chat end to end: DMs, groups, auto sales channels, replies, reactions,
 * edit/delete windows, read receipts — and that nobody reads a conversation
 * they are not in.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { assertSafeDb, resetDb, tokenFor } from './db';

assertSafeDb();

import { pool, query, queryOne } from '@/lib/db';
import { syncSalesChannels } from '@/lib/chat/core';
import * as chatList from '@/app/api/chat/route';
import * as chatOne from '@/app/api/chat/[id]/route';
import * as chatMessages from '@/app/api/chat/[id]/messages/route';
import * as chatRead from '@/app/api/chat/[id]/read/route';
import * as chatJoin from '@/app/api/chat/[id]/join/route';
import * as people from '@/app/api/chat/people/route';
import * as messageOne from '@/app/api/messages/[id]/route';
import * as react from '@/app/api/messages/[id]/react/route';

type Who = 'hr' | 'ali' | 'sara' | 'dev' | 'gone';
const U = {} as Record<Who, number>;
const T = {} as Record<Who, string>;

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
const p = (id: string | number) => ({ params: { id: String(id) } });
const list = (who: Who) => call(chatList.GET(req(who, '/api/chat')));
const send = (who: Who, c: string, body: unknown) => call(chatMessages.POST(req(who, `/api/chat/${c}/messages`, 'POST', body), p(c)));
const read = (who: Who, c: string) => call(chatMessages.GET(req(who, `/api/chat/${c}/messages`), p(c)));

beforeAll(async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-secret';
  await resetDb();
  for (const [k, role, active] of [['hr', 'hr', true], ['ali', 'agent', true], ['sara', 'agent', true], ['dev', 'developer', true], ['gone', 'agent', false]] as const) {
    const row = await queryOne<{ id: string }>(
      `INSERT INTO users (username, full_name, role, is_active) VALUES ($1, $2, $3, $4) RETURNING id`, [k, k.toUpperCase(), role, active]
    );
    U[k] = Number(row!.id);
    T[k] = await tokenFor({ id: U[k], username: k, role });
  }
});
afterAll(() => pool.end());

let DM = '';
let M1 = '';

describe('sales channels', () => {
  it('puts every active sales user in #sales-all, #help and #wins, and no developers', async () => {
    const r = await list('ali');
    expect(r.status).toBe(200);
    const names = r.body.data.conversations.map((c: any) => c.name).sort();
    expect(names).toEqual(['help', 'sales-all', 'wins']); // #leads is leads + HR only
    const all = r.body.data.conversations.find((c: any) => c.systemKey === 'sales-all');
    expect(all.memberCount).toBe(3); // hr, ali, sara — not the developer, not the inactive agent
    expect((await list('dev')).body.data.conversations).toEqual([]);
  });

  it('follows sales teams: moving an agent moves their team channel membership', async () => {
    const team = await queryOne<{ id: number }>(`INSERT INTO sales_teams (name, created_by) VALUES ('Team Alpha', $1) RETURNING id`, [U.hr]);
    await query(`INSERT INTO sales_team_members (team_id, user_id) VALUES ($1, $2)`, [team!.id, U.ali]);
    await syncSalesChannels(true);
    const ch = await queryOne<{ id: string; name: string }>(`SELECT id, name FROM conversations WHERE system_key = $1`, [`team-${team!.id}`]);
    expect(ch!.name).toBe('team-alpha');
    const members = async () => (await query<{ user_id: string }>(`SELECT user_id FROM conversation_members WHERE conversation_id = $1`, [ch!.id])).map((m) => Number(m.user_id)).sort();
    expect(await members()).toEqual([U.hr, U.ali].sort());

    await query(`UPDATE sales_team_members SET to_at = NOW() WHERE user_id = $1`, [U.ali]);
    await query(`INSERT INTO sales_team_members (team_id, user_id) VALUES ($1, $2)`, [team!.id, U.sara]);
    await syncSalesChannels(true);
    expect(await members()).toEqual([U.hr, U.sara].sort());
  });

  it('only HR and leads post in an announcement-only channel', async () => {
    const all = (await list('hr')).body.data.conversations.find((c: any) => c.systemKey === 'sales-all');
    expect((await call(chatOne.PATCH(req('ali', `/api/chat/${all.id}`, 'PATCH', { isAnnouncementOnly: true }), p(all.id)))).status).toBe(403);
    expect((await call(chatOne.PATCH(req('hr', `/api/chat/${all.id}`, 'PATCH', { isAnnouncementOnly: true }), p(all.id)))).status).toBe(200);
    expect((await send('ali', all.id, { body: 'hi all' })).status).toBe(403);
    expect((await send('hr', all.id, { body: 'Team meeting at 9' })).status).toBe(201);
  });
});

describe('direct messages', () => {
  it('creates one DM per pair', async () => {
    const a = await call(chatList.POST(req('ali', '/api/chat', 'POST', { type: 'dm', userId: U.sara })));
    expect(a.status).toBe(201);
    const b = await call(chatList.POST(req('sara', '/api/chat', 'POST', { type: 'dm', userId: U.ali })));
    expect(b.body.data.id).toBe(a.body.data.id);
    DM = a.body.data.id;
  });

  it('rejects bad DMs', async () => {
    expect((await call(chatList.POST(req('ali', '/api/chat', 'POST', { type: 'dm', userId: U.ali })))).status).toBe(400);
    expect((await call(chatList.POST(req('ali', '/api/chat', 'POST', { type: 'dm', userId: U.gone })))).status).toBe(400);
    expect((await call(chatList.POST(req('ali', '/api/chat', 'POST', { type: 'dm', userId: U.dev })))).status).toBe(403);
    expect((await call(chatList.POST(req('dev', '/api/chat', 'POST', { type: 'dm', userId: U.ali })))).status).toBe(403);
    expect((await call(chatList.POST(new NextRequest('http://test/api/chat', { method: 'POST', body: '{}' })))).status).toBe(401);
  });

  it('delivers, counts unread and shows the read receipt', async () => {
    const s = await send('ali', DM, { body: 'Kal ka target?' });
    expect(s.status).toBe(201);
    M1 = s.body.data.id;
    const sara = await list('sara');
    expect(sara.body.data.conversations.find((c: any) => c.id === DM).unread).toBe(1);

    let detail = await call(chatOne.GET(req('ali', `/api/chat/${DM}`), p(DM)));
    expect(detail.body.data.members.find((m: any) => m.id === U.sara).lastReadMessageId).toBe(0);
    await call(chatRead.POST(req('sara', `/api/chat/${DM}/read`, 'POST', {}), p(DM)));
    detail = await call(chatOne.GET(req('ali', `/api/chat/${DM}`), p(DM)));
    expect(String(detail.body.data.members.find((m: any) => m.id === U.sara).lastReadMessageId)).toBe(M1);
    expect((await list('sara')).body.data.conversations.find((c: any) => c.id === DM).unread).toBe(0);
  });

  it('replies and reactions', async () => {
    const r = await send('sara', DM, { body: '300 calls', replyToId: M1 });
    expect(r.status).toBe(201);
    expect((await call(react.POST(req('sara', `/api/messages/${M1}/react`, 'POST', { emoji: '👍' }), p(M1)))).body.data.reacted).toBe(true);
    expect((await call(react.POST(req('sara', `/api/messages/${M1}/react`, 'POST', { emoji: '💩' }), p(M1)))).status).toBe(400);
    const msgs = (await read('ali', DM)).body.data;
    expect(msgs.find((m: any) => m.id === r.body.data.id).replyTo.id).toBe(M1);
    expect(msgs.find((m: any) => m.id === M1).reactions).toEqual([{ emoji: '👍', count: 1, mine: false }]);
    // toggling removes it
    await call(react.POST(req('sara', `/api/messages/${M1}/react`, 'POST', { emoji: '👍' }), p(M1)));
    expect((await read('ali', DM)).body.data.find((m: any) => m.id === M1).reactions).toEqual([]);
  });

  it('rejects a reply to a message from another conversation', async () => {
    const other = await call(chatList.POST(req('ali', '/api/chat', 'POST', { type: 'dm', userId: U.hr })));
    const foreign = await send('ali', other.body.data.id, { body: 'hello HR' });
    expect((await send('ali', DM, { body: 'x', replyToId: foreign.body.data.id })).status).toBe(400);
  });

  it('blocks secret keys', async () => {
    expect((await send('ali', DM, { body: 'use sk_live_abcdefghijklmnopqrstu' })).status).toBe(422);
    expect((await send('ali', DM, { body: '-----BEGIN RSA PRIVATE KEY-----' })).status).toBe(422);
    expect((await send('ali', DM, { body: '   ' })).status).toBe(400);
    expect((await send('ali', DM, { body: 'x'.repeat(4001) })).status).toBe(400);
  });

  it('keeps outsiders out of messages, edits and reactions', async () => {
    for (const who of ['dev', 'hr'] as const) {
      expect((await read(who, DM)).status).toBe(404);
      expect((await send(who, DM, { body: 'hi' })).status).toBe(404);
      expect((await call(messageOne.PATCH(req(who, `/api/messages/${M1}`, 'PATCH', { body: 'x' }), p(M1)))).status).toBe(404);
      expect((await call(react.POST(req(who, `/api/messages/${M1}/react`, 'POST', { emoji: '👍' }), p(M1)))).status).toBe(404);
    }
    expect((await call(chatOne.GET(req('ali', '/api/chat/abc'), p('abc')))).status).toBe(404);
  });

  it('lets only the sender edit or delete, within 15 minutes', async () => {
    expect((await call(messageOne.PATCH(req('sara', `/api/messages/${M1}`, 'PATCH', { body: 'x' }), p(M1)))).status).toBe(403);
    expect((await call(messageOne.PATCH(req('ali', `/api/messages/${M1}`, 'PATCH', { body: 'Aaj ka target?' }), p(M1)))).status).toBe(200);
    expect((await call(messageOne.DELETE(req('sara', `/api/messages/${M1}`, 'DELETE'), p(M1)))).status).toBe(403);

    await query(`UPDATE messages SET created_at = NOW() - INTERVAL '16 minutes' WHERE id = $1`, [M1]);
    expect((await call(messageOne.PATCH(req('ali', `/api/messages/${M1}`, 'PATCH', { body: 'late' }), p(M1)))).status).toBe(403);
    expect((await call(messageOne.DELETE(req('ali', `/api/messages/${M1}`, 'DELETE'), p(M1)))).status).toBe(403);

    const fresh = await send('ali', DM, { body: 'oops' });
    expect((await call(messageOne.DELETE(req('ali', `/api/messages/${fresh.body.data.id}`, 'DELETE'), p(fresh.body.data.id)))).status).toBe(200);
    const gone = (await read('sara', DM)).body.data.find((m: any) => m.id === fresh.body.data.id);
    expect(gone).toMatchObject({ deleted: true, body: '' });
  });
});

describe('groups and channels', () => {
  it('groups: up to 20, developers only via HR or a lead', async () => {
    expect((await call(chatList.POST(req('ali', '/api/chat', 'POST', { type: 'group', name: 'Closers', memberIds: [U.sara, U.dev] })))).status).toBe(403);
    const g = await call(chatList.POST(req('hr', '/api/chat', 'POST', { type: 'group', name: 'Site help', memberIds: [U.ali, U.dev] })));
    expect(g.status).toBe(201);
    expect((await list('dev')).body.data.conversations.map((c: any) => c.name)).toContain('Site help');
    const many = Array.from({ length: 20 }, (_, i) => 10_000 + i);
    expect((await call(chatList.POST(req('ali', '/api/chat', 'POST', { type: 'group', name: 'Big', memberIds: many })))).status).toBe(400);
    // a member who isn't the admin can't rename
    expect((await call(chatOne.PATCH(req('ali', `/api/chat/${g.body.data.id}`, 'PATCH', { name: 'Mine' }), p(g.body.data.id)))).status).toBe(403);
    expect((await call(chatOne.PATCH(req('ali', `/api/chat/${g.body.data.id}`, 'PATCH', { leave: true }), p(g.body.data.id)))).status).toBe(200);
    expect((await read('ali', g.body.data.id)).status).toBe(404);
  });

  it('channels: HR creates; public ones can be browsed and joined; system ones cannot', async () => {
    expect((await call(chatList.POST(req('ali', '/api/chat', 'POST', { type: 'channel', name: 'x' })))).status).toBe(403);
    const ch = await call(chatList.POST(req('hr', '/api/chat', 'POST', { type: 'channel', name: 'Night Shift' })));
    const browse = await call(chatList.GET(req('sara', '/api/chat?browse=channels')));
    expect(browse.body.data.map((c: any) => c.name)).toEqual(['night-shift']);
    expect((await call(chatJoin.POST(req('sara', `/api/chat/${ch.body.data.id}/join`, 'POST'), p(ch.body.data.id)))).status).toBe(200);
    const help = (await list('hr')).body.data.conversations.find((c: any) => c.systemKey === 'help');
    expect((await call(chatJoin.POST(req('dev', `/api/chat/${help.id}/join`, 'POST'), p(help.id)))).status).toBe(404);
    expect((await call(chatOne.PATCH(req('hr', `/api/chat/${help.id}`, 'PATCH', { addMemberIds: [U.dev] }), p(help.id)))).status).toBe(400);
  });

  it('lists people: developers only for HR and leads', async () => {
    const forAgent = (await call(people.GET(req('ali', '/api/chat/people')))).body.data.map((x: any) => x.role);
    expect(forAgent).not.toContain('developer');
    const forHr = (await call(people.GET(req('hr', '/api/chat/people')))).body.data.map((x: any) => x.role);
    expect(forHr).toContain('developer');
  });

  it('mute and pin are personal', async () => {
    await call(chatOne.PATCH(req('ali', `/api/chat/${DM}`, 'PATCH', { mute: '8h', pinned: true }), p(DM)));
    const mine = (await list('ali')).body.data.conversations[0];
    expect(mine).toMatchObject({ id: DM, pinned: true, muted: true });
    expect((await list('sara')).body.data.conversations.find((c: any) => c.id === DM)).toMatchObject({ pinned: false, muted: false });
  });
});
