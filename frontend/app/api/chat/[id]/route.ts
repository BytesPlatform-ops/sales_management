import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { HttpError } from '@/lib/training/http';
import {
  assertCanPost, assertWritable, canManage, chatViewer, fail, isSalesLead, isSalesRole, loadConversation,
  MAX_GROUP_MEMBERS, ok,
} from '@/lib/chat/core';

export const dynamic = 'force-dynamic';

/** GET /api/chat/<id> — the conversation, its members and what I may do in it. */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const v = await chatViewer(request);
    const c = await loadConversation(params.id, v);
    const members = await query<any>(
      `SELECT u.id, u.full_name, u.role AS user_role, m.role, m.last_read_message_id, m.pinned, m.muted_until
         FROM conversation_members m JOIN users u ON u.id = m.user_id
        WHERE m.conversation_id = $1
        ORDER BY (m.user_id = $2) DESC, u.full_name`,
      [c.id, v.userId]
    );
    const me = members.find((m) => Number(m.id) === v.userId);
    const other = c.type === 'dm' ? members.find((m) => Number(m.id) !== v.userId) : null;
    let canPost = true;
    try { await assertCanPost(c, v); } catch { canPost = false; }
    return ok({
      id: String(c.id),
      type: c.type,
      name: c.type === 'dm' ? other?.full_name || 'Direct message' : c.name,
      topic: c.topic,
      systemKey: c.system_key,
      isPrivate: c.is_private,
      isAnnouncementOnly: c.is_announcement_only,
      meId: v.userId,
      members: members.map((m) => ({
        id: Number(m.id), name: m.full_name, userRole: m.user_role, role: m.role,
        lastReadMessageId: Number(m.last_read_message_id),
      })),
      pinned: !!me?.pinned,
      mutedUntil: me?.muted_until || null,
      canPost,
      canManage: canManage(c, v),
      canLeave: c.type === 'group' || (c.type === 'channel' && !c.system_key),
    });
  } catch (err) {
    return fail(err);
  }
}

/**
 * PATCH /api/chat/<id>
 *   Mine:    { pinned }, { mute: '1h' | '8h' | 'forever' | null }, { leave: true }
 *   Manage:  { name }, { topic }, { isAnnouncementOnly } (HR), { addMemberIds }, { removeMemberIds }, { archive: true } (HR)
 */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const v = await chatViewer(request);
    assertWritable(v);
    const c = await loadConversation(params.id, v);
    const b = await request.json().catch(() => ({}));

    if (typeof b.pinned === 'boolean') {
      await query(`UPDATE conversation_members SET pinned = $3 WHERE conversation_id = $1 AND user_id = $2`, [c.id, v.userId, b.pinned]);
    }
    if ('mute' in b) {
      const until = b.mute === '1h' ? `NOW() + INTERVAL '1 hour'` : b.mute === '8h' ? `NOW() + INTERVAL '8 hours'`
        : b.mute === 'forever' ? `'infinity'::timestamptz` : 'NULL';
      await query(`UPDATE conversation_members SET muted_until = ${until} WHERE conversation_id = $1 AND user_id = $2`, [c.id, v.userId]);
    }
    if (b.leave === true) {
      if (!(c.type === 'group' || (c.type === 'channel' && !c.system_key))) throw new HttpError(400, 'You can’t leave this conversation');
      await query(`DELETE FROM conversation_members WHERE conversation_id = $1 AND user_id = $2`, [c.id, v.userId]);
      await query(`INSERT INTO messages (conversation_id, kind, body) VALUES ($1, 'system', $2)`, [c.id, `${v.name} left`]);
      return ok({ left: true });
    }

    const managing = ['name', 'topic', 'isAnnouncementOnly', 'addMemberIds', 'removeMemberIds', 'archive'].some((k) => k in b);
    if (managing) {
      if (!canManage(c, v)) throw new HttpError(403, 'Only HR or the group’s admin can change this');
      if (typeof b.name === 'string' && !c.system_key) {
        const name = b.name.trim();
        if (!name || name.length > 80) throw new HttpError(400, 'Name must be 1–80 characters');
        await query(`UPDATE conversations SET name = $2, updated_at = NOW() WHERE id = $1`, [c.id, name]);
      }
      if (typeof b.topic === 'string') {
        await query(`UPDATE conversations SET topic = $2, updated_at = NOW() WHERE id = $1`, [c.id, b.topic.slice(0, 300) || null]);
      }
      if (typeof b.isAnnouncementOnly === 'boolean') {
        if (v.role !== 'hr') throw new HttpError(403, 'Only HR can make a channel announcement-only');
        await query(`UPDATE conversations SET is_announcement_only = $2 WHERE id = $1`, [c.id, b.isAnnouncementOnly]);
      }
      if (Array.isArray(b.addMemberIds) && b.addMemberIds.length) {
        if (c.system_key) throw new HttpError(400, 'Members of this channel follow sales teams automatically');
        const ids = Array.from(new Set<number>(b.addMemberIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0)));
        const users = await query<{ id: string; role: string; full_name: string }>(
          `SELECT id, role, full_name FROM users WHERE id = ANY($1::bigint[]) AND is_active = true`, [ids]
        );
        const devOk = v.role === 'hr' || (await isSalesLead(v.userId));
        for (const u of users) {
          if (!isSalesRole(u.role) && !(u.role === 'developer' && devOk)) throw new HttpError(403, 'Only HR or a sales lead can add developers');
        }
        if (c.type === 'group') {
          const n = await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM conversation_members WHERE conversation_id = $1`, [c.id]);
          if (n[0].n + users.length > MAX_GROUP_MEMBERS) throw new HttpError(400, `A group can have up to ${MAX_GROUP_MEMBERS} people`);
        }
        await query(
          `INSERT INTO conversation_members (conversation_id, user_id) SELECT $1, x FROM unnest($2::bigint[]) x ON CONFLICT DO NOTHING`,
          [c.id, users.map((u) => Number(u.id))]
        );
        if (users.length) {
          await query(`INSERT INTO messages (conversation_id, kind, body) VALUES ($1, 'system', $2)`,
            [c.id, `${v.name} added ${users.map((u) => u.full_name).join(', ')}`]);
        }
      }
      if (Array.isArray(b.removeMemberIds) && b.removeMemberIds.length) {
        if (c.system_key) throw new HttpError(400, 'Members of this channel follow sales teams automatically');
        const ids = b.removeMemberIds.map(Number).filter((n: number) => Number.isInteger(n) && n !== v.userId);
        await query(`DELETE FROM conversation_members WHERE conversation_id = $1 AND user_id = ANY($2::bigint[])`, [c.id, ids]);
      }
      if (b.archive === true) {
        if (v.role !== 'hr') throw new HttpError(403, 'Only HR can archive');
        await query(`UPDATE conversations SET archived_at = NOW() WHERE id = $1`, [c.id]);
      }
    }
    return ok({ id: String(c.id) });
  } catch (err) {
    return fail(err);
  }
}
