import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { HttpError } from '@/lib/training/http';
import {
  assertWritable, chatViewer, dmKey, fail, isSalesLead, isSalesRole, MAX_GROUP_MEMBERS, ok, syncSalesChannels,
} from '@/lib/chat/core';

export const dynamic = 'force-dynamic';

/**
 * GET /api/chat — my conversations (DMs, groups, channels), pinned first, then
 * newest activity, with unread counts. ?browse=channels lists public channels
 * I can join instead.
 */
export async function GET(request: NextRequest) {
  try {
    const v = await chatViewer(request);
    if (isSalesRole(v.role)) await syncSalesChannels();

    if (new URL(request.url).searchParams.get('browse') === 'channels') {
      if (!isSalesRole(v.role)) return ok([]);
      const rows = await query(
        `SELECT c.id, c.name, c.topic,
                (SELECT COUNT(*) FROM conversation_members x WHERE x.conversation_id = c.id)::int AS member_count
           FROM conversations c
          WHERE c.type = 'channel' AND c.is_private = false AND c.archived_at IS NULL AND c.system_key IS NULL
            AND NOT EXISTS (SELECT 1 FROM conversation_members m WHERE m.conversation_id = c.id AND m.user_id = $1)
          ORDER BY c.name`,
        [v.userId]
      );
      return ok(rows);
    }

    const rows = await query<any>(
      `SELECT c.id, c.type, c.name, c.topic, c.system_key, c.is_private, c.is_announcement_only,
              COALESCE(c.last_message_at, c.created_at) AS activity_at,
              m.pinned, m.muted_until, m.role AS my_role,
              (m.muted_until IS NOT NULL AND m.muted_until > NOW()) AS muted,
              (SELECT COUNT(*) FROM messages x
                WHERE x.conversation_id = c.id AND x.id > m.last_read_message_id AND x.parent_id IS NULL
                  AND x.deleted_at IS NULL AND x.kind <> 'system' AND x.sender_id IS DISTINCT FROM m.user_id
                  AND (x.scheduled_for IS NULL OR x.scheduled_for <= NOW()))::int AS unread,
              (SELECT COUNT(*) FROM conversation_members x WHERE x.conversation_id = c.id)::int AS member_count,
              (SELECT json_build_object('id', u.id, 'name', u.full_name, 'role', u.role)
                 FROM conversation_members o JOIN users u ON u.id = o.user_id
                WHERE o.conversation_id = c.id AND o.user_id <> m.user_id LIMIT 1) AS other,
              last.body AS last_body, last.deleted AS last_deleted, last.sender_name AS last_sender,
              last.sender_id AS last_sender_id
         FROM conversation_members m
         JOIN conversations c ON c.id = m.conversation_id
         LEFT JOIN LATERAL (
           SELECT x.body, x.deleted_at IS NOT NULL AS deleted, x.sender_id, u.full_name AS sender_name
             FROM messages x LEFT JOIN users u ON u.id = x.sender_id
            WHERE x.conversation_id = c.id AND x.parent_id IS NULL
              AND (x.scheduled_for IS NULL OR x.scheduled_for <= NOW())
            ORDER BY x.id DESC LIMIT 1
         ) last ON true
        WHERE m.user_id = $1 AND c.archived_at IS NULL AND c.type <> 'project'
        ORDER BY m.pinned DESC, COALESCE(c.last_message_at, c.created_at) DESC`,
      [v.userId]
    );

    const conversations = rows.map((r) => ({
      id: String(r.id),
      type: r.type,
      name: r.type === 'dm' ? r.other?.name || 'Direct message' : r.name,
      topic: r.topic,
      systemKey: r.system_key,
      isPrivate: r.is_private,
      isAnnouncementOnly: r.is_announcement_only,
      other: r.type === 'dm' && r.other ? { id: Number(r.other.id), name: r.other.name, role: r.other.role } : null,
      memberCount: r.member_count,
      pinned: r.pinned,
      muted: r.muted,
      unread: r.unread,
      activityAt: r.activity_at,
      last: r.last_body !== null && r.last_body !== undefined
        ? { body: r.last_deleted ? 'Message deleted' : r.last_body, senderName: r.last_sender, mine: Number(r.last_sender_id) === v.userId }
        : null,
    }));
    const unreadTotal = conversations.reduce((n, c) => n + (c.muted ? 0 : c.unread), 0);
    return ok({ conversations, unreadTotal });
  } catch (err) {
    return fail(err);
  }
}

/**
 * POST /api/chat — start a conversation.
 *   { type: 'dm', userId }                          returns the existing DM if there is one
 *   { type: 'group', name, memberIds }              up to 20 people
 *   { type: 'channel', name, topic?, isPrivate?, memberIds? }   HR only
 */
export async function POST(request: NextRequest) {
  try {
    const v = await chatViewer(request);
    assertWritable(v);
    const body = await request.json().catch(() => ({}));
    const type = body?.type;
    const canAddDevelopers = v.role === 'hr' || (await isSalesLead(v.userId));

    // Everyone named must be an active user this viewer may talk to.
    const checkPeople = async (ids: number[]) => {
      if (!ids.length) return;
      const rows = await query<{ id: string; role: string }>(
        `SELECT id, role FROM users WHERE id = ANY($1::bigint[]) AND is_active = true`, [ids]
      );
      if (rows.length !== ids.length) throw new HttpError(400, 'Someone in the list is not an active user');
      for (const r of rows) {
        if (isSalesRole(r.role)) continue;
        if (r.role === 'developer' && canAddDevelopers) continue;
        throw new HttpError(403, 'Only HR or a sales lead can add developers');
      }
    };

    if (!isSalesRole(v.role)) throw new HttpError(403, 'Developers can chat only in conversations they are added to');

    if (type === 'dm') {
      const other = Number(body.userId);
      if (!Number.isInteger(other) || other === v.userId) throw new HttpError(400, 'Pick someone to message');
      await checkPeople([other]);
      const key = dmKey(v.userId, other);
      await query(
        `INSERT INTO conversations (type, dm_key, created_by) VALUES ('dm', $1, $2)
         ON CONFLICT (dm_key) WHERE dm_key IS NOT NULL DO NOTHING`,
        [key, v.userId]
      );
      const c = await queryOne<{ id: string }>(`SELECT id FROM conversations WHERE dm_key = $1`, [key]);
      await query(
        `INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2), ($1, $3)
         ON CONFLICT DO NOTHING`,
        [c!.id, v.userId, other]
      );
      return ok({ id: String(c!.id) }, null, 201);
    }

    if (type === 'group' || type === 'channel') {
      const name = String(body.name || '').trim();
      if (!name || name.length > 80) throw new HttpError(400, 'Give it a name (up to 80 characters)');
      const memberIds: number[] = Array.from(new Set<number>(
        (Array.isArray(body.memberIds) ? body.memberIds : []).map(Number).filter((n: number) => Number.isInteger(n) && n > 0 && n !== v.userId)
      ));
      if (type === 'group') {
        if (!memberIds.length) throw new HttpError(400, 'Add at least one person');
        if (memberIds.length + 1 > MAX_GROUP_MEMBERS) throw new HttpError(400, `A group can have up to ${MAX_GROUP_MEMBERS} people`);
      } else if (v.role !== 'hr') {
        throw new HttpError(403, 'Only HR can create channels');
      }
      await checkPeople(memberIds);
      const channelName = type === 'channel' ? name.toLowerCase().replace(/^#/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : name;
      if (!channelName) throw new HttpError(400, 'Use letters or numbers in the channel name');
      const c = await queryOne<{ id: string }>(
        `INSERT INTO conversations (type, name, topic, is_private, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [type, channelName, body.topic ? String(body.topic).slice(0, 300) : null, type === 'group' ? true : !!body.isPrivate, v.userId]
      );
      await query(
        `INSERT INTO conversation_members (conversation_id, user_id, role)
         SELECT $1, x, CASE WHEN x = $2 THEN 'admin' ELSE 'member' END FROM unnest($3::bigint[]) AS x
         ON CONFLICT DO NOTHING`,
        [c!.id, v.userId, [v.userId, ...memberIds]]
      );
      await query(
        `INSERT INTO messages (conversation_id, kind, body) VALUES ($1, 'system', $2)`,
        [c!.id, `${v.name} created ${type === 'channel' ? `#${channelName}` : `the group “${name}”`}`]
      );
      return ok({ id: String(c!.id) }, null, 201);
    }

    throw new HttpError(400, 'type must be dm, group or channel');
  } catch (err) {
    return fail(err);
  }
}
