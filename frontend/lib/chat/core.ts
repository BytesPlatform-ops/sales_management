/**
 * Chat engine (Addendum 5): direct messages, groups and channels share one set
 * of tables (database/migrations/create_chat.sql) and one set of rules.
 *
 *   Sales users = active agents (sales leads are agents) and HR.
 *   DM          any sales user ↔ any sales user.
 *   Group       any sales user, up to 20 people; HR or a sales lead may add developers.
 *   Channel     auto: #sales-all, #help, #wins (all sales), #leads (leads + HR),
 *               #team-<name> (each sales team + HR); HR can create more.
 *   Access      you must be a member; everything is re-checked on every request.
 *
 * API routes answer { data, error, nextCursor }.
 */
import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { HttpError } from '@/lib/training/http';
import { getViewer, Viewer } from '@/lib/projects/core';

export const MAX_GROUP_MEMBERS = 20;
export const EDIT_WINDOW_MS = 15 * 60 * 1000;
export const MAX_MESSAGE_LENGTH = 4000;
export const REACTIONS = ['👍', '❤️', '😂', '🎉', '👏', '✅'] as const;

export type ConversationType = 'dm' | 'group' | 'channel' | 'project';

export interface ConversationRow {
  id: string; type: ConversationType; name: string | null; topic: string | null; system_key: string | null;
  dm_key: string | null; team_id: number | null; is_private: boolean; is_announcement_only: boolean;
  created_by: string | null; created_at: string; last_message_at: string | null; archived_at: string | null;
}

export function ok(data: unknown, nextCursor: string | null = null, status = 200) {
  return NextResponse.json({ data, error: null, nextCursor }, { status });
}

export function fail(err: unknown) {
  if (err instanceof HttpError) return NextResponse.json({ data: null, error: err.message, nextCursor: null }, { status: err.status });
  console.error('[chat]', err);
  return NextResponse.json({ data: null, error: 'Something went wrong', nextCursor: null }, { status: 500 });
}

export const isSalesRole = (role: string) => role === 'agent' || role === 'hr';

export async function isSalesLead(userId: number): Promise<boolean> {
  if (!(await tableExists('sales_leads'))) return false;
  return !!(await queryOne(`SELECT 1 FROM sales_leads WHERE user_id = $1 AND removed_at IS NULL`, [userId]));
}

/** The signed-in chat user. Developers may use chat only in conversations they were added to. */
export async function chatViewer(request: NextRequest): Promise<Viewer> {
  return getViewer(request);
}

/** A CEO's read-only "view as" session can read chat but not write. */
export function assertWritable(v: Viewer) {
  if ((v as { readonly?: boolean }).readonly) throw new HttpError(403, 'Read-only session');
}

/** Load a conversation the viewer is a member of (404 otherwise, so ids can't be probed). */
export async function loadConversation(id: string, v: Viewer): Promise<ConversationRow & { my_role: 'member' | 'admin' }> {
  if (!/^\d+$/.test(id)) throw new HttpError(404, 'Conversation not found');
  const c = await queryOne<ConversationRow & { my_role: 'member' | 'admin' }>(
    `SELECT c.*, m.role AS my_role
       FROM conversations c JOIN conversation_members m ON m.conversation_id = c.id AND m.user_id = $2
      WHERE c.id = $1`,
    [id, v.userId]
  );
  if (!c) throw new HttpError(404, 'Conversation not found');
  return c;
}

/** Who may post: everyone in it, except announcement-only channels (HR, leads and admins). */
export async function assertCanPost(c: ConversationRow & { my_role: string }, v: Viewer) {
  if (c.archived_at) throw new HttpError(403, 'This conversation is archived');
  if (c.is_announcement_only && v.role !== 'hr' && c.my_role !== 'admin' && !(await isSalesLead(v.userId))) {
    throw new HttpError(403, 'Only HR and leads can post here');
  }
}

/** HR, or an admin of this group/channel. Auto channels are managed by the system. */
export function canManage(c: ConversationRow & { my_role: string }, v: Viewer): boolean {
  if (c.type === 'dm' || c.type === 'project') return false;
  return v.role === 'hr' || (!c.system_key && c.my_role === 'admin');
}

// ---------------------------------------------------------------- secrets

const SECRET_PATTERNS: RegExp[] = [
  /\bsk_live_[0-9a-zA-Z]{10,}/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}/,
];

/** Messages may never carry keys or private keys (Addendum 5 §1.5). */
export function assertNoSecrets(text: string) {
  if (SECRET_PATTERNS.some((re) => re.test(text))) {
    throw new HttpError(422, 'This looks like a secret key. Don’t send it in chat — save it to the project vault instead.');
  }
}

// ---------------------------------------------------------------- sales channels

async function tableExists(name: string): Promise<boolean> {
  const r = await queryOne<{ t: string | null }>(`SELECT to_regclass($1)::text AS t`, [name]);
  return !!r?.t;
}

interface ChannelSpec { key: string; name: string; topic: string; teamId?: number; announcement?: boolean; members: string }

const ALL_SALES = `SELECT id FROM users WHERE role IN ('agent', 'hr') AND is_active = true`;
const HR = `SELECT id FROM users WHERE role = 'hr' AND is_active = true`;

let lastSync = 0;

/**
 * Create the sales channels and bring their members in line with users, sales
 * teams and leads. Cheap, idempotent; throttled to once a minute unless forced
 * (e.g. right after HR moves someone between teams).
 */
export async function syncSalesChannels(force = false) {
  if (!force && Date.now() - lastSync < 60_000) return;
  lastSync = Date.now();

  const specs: ChannelSpec[] = [
    { key: 'sales-all', name: 'sales-all', topic: 'Everyone in sales', members: ALL_SALES },
    { key: 'help', name: 'help', topic: 'Ask anything — leads and HR answer', members: ALL_SALES },
    { key: 'wins', name: 'wins', topic: 'Closed deals and shout-outs', members: ALL_SALES },
  ];
  if (await tableExists('sales_leads')) {
    specs.push({
      key: 'leads', name: 'leads', topic: 'Sales leads and HR', members:
        `SELECT user_id AS id FROM sales_leads WHERE removed_at IS NULL UNION ${HR}`,
    });
  }
  if (await tableExists('sales_teams')) {
    const teams = await query<{ id: number; name: string }>(`SELECT id, name FROM sales_teams WHERE archived_at IS NULL`);
    for (const t of teams) {
      specs.push({
        key: `team-${t.id}`, teamId: t.id,
        name: `team-${t.name.toLowerCase().replace(/^team\s+/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || t.id}`.slice(0, 80),
        topic: `${t.name} team`,
        members: `SELECT user_id AS id FROM sales_team_members WHERE team_id = ${Number(t.id)} AND to_at IS NULL UNION ${HR}`,
      });
    }
    // Archive the channels of archived teams.
    await query(
      `UPDATE conversations c SET archived_at = NOW()
        WHERE c.system_key LIKE 'team-%' AND c.archived_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM sales_teams t WHERE t.id = c.team_id AND t.archived_at IS NULL)`
    );
  }

  for (const s of specs) {
    const c = await queryOne<{ id: string }>(
      `INSERT INTO conversations (type, name, topic, system_key, team_id, is_announcement_only)
       VALUES ('channel', $1, $2, $3, $4, $5)
       ON CONFLICT (system_key) WHERE system_key IS NOT NULL
       DO UPDATE SET name = EXCLUDED.name, topic = COALESCE(conversations.topic, EXCLUDED.topic), archived_at = NULL
       RETURNING id`,
      [s.name, s.topic, s.key, s.teamId ?? null, !!s.announcement]
    );
    if (!c) continue;
    await query(
      `INSERT INTO conversation_members (conversation_id, user_id, role, last_read_message_id)
       SELECT $1, e.id, CASE WHEN u.role = 'hr' THEN 'admin' ELSE 'member' END,
              COALESCE((SELECT MAX(id) FROM messages WHERE conversation_id = $1), 0)
         FROM (${s.members}) e JOIN users u ON u.id = e.id
       ON CONFLICT (conversation_id, user_id) DO NOTHING`,
      [c.id]
    );
    await query(
      `DELETE FROM conversation_members m
        WHERE m.conversation_id = $1 AND m.user_id NOT IN (SELECT id FROM (${s.members}) e)`,
      [c.id]
    );
  }
}

/** One DM per pair of people. */
export function dmKey(a: number, b: number) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export async function touchConversation(id: string | number) {
  await query(`UPDATE conversations SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1`, [id]);
}
