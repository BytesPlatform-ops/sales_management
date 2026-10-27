import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { HttpError } from '@/lib/training/http';
import {
  assertCanPost, assertNoSecrets, assertWritable, chatViewer, EDIT_WINDOW_MS, fail, loadConversation,
  MAX_MESSAGE_LENGTH, ok, touchConversation,
} from '@/lib/chat/core';

export const dynamic = 'force-dynamic';

const PAGE = 50;

/**
 * GET /api/chat/<id>/messages?before=<message id>
 * The newest 50 messages (oldest first), or the 50 before a message. The client
 * polls this every 3 s; nextCursor pages back to older messages.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const v = await chatViewer(request);
    const c = await loadConversation(params.id, v);
    const before = new URL(request.url).searchParams.get('before');
    if (before && !/^\d+$/.test(before)) throw new HttpError(400, 'Invalid cursor');

    const rows = await query<any>(
      `SELECT x.id, x.sender_id, u.full_name AS sender_name, u.role AS sender_role, x.kind, x.body, x.card,
              x.reply_to_id, x.edited_at, x.deleted_at, x.created_at,
              r.body AS reply_body, r.deleted_at AS reply_deleted, ru.full_name AS reply_sender,
              COALESCE((SELECT json_agg(json_build_object('emoji', e.emoji, 'count', e.n, 'mine', e.mine) ORDER BY e.first_at)
                          FROM (SELECT emoji, COUNT(*)::int AS n, bool_or(user_id = $2) AS mine, MIN(created_at) AS first_at
                                  FROM message_reactions WHERE message_id = x.id GROUP BY emoji) e), '[]') AS reactions
         FROM messages x
         LEFT JOIN users u ON u.id = x.sender_id
         LEFT JOIN messages r ON r.id = x.reply_to_id
         LEFT JOIN users ru ON ru.id = r.sender_id
        WHERE x.conversation_id = $1 AND x.parent_id IS NULL
          AND (x.scheduled_for IS NULL OR x.scheduled_for <= NOW())
          AND ($3::bigint IS NULL OR x.id < $3::bigint)
        ORDER BY x.id DESC
        LIMIT ${PAGE + 1}`,
      [c.id, v.userId, before]
    );
    const more = rows.length > PAGE;
    const page = rows.slice(0, PAGE).reverse();
    const now = Date.now();
    const data = page.map((m) => {
      const mine = Number(m.sender_id) === v.userId;
      const deleted = !!m.deleted_at;
      const fresh = now - new Date(m.created_at).getTime() < EDIT_WINDOW_MS;
      return {
        id: String(m.id),
        kind: m.kind,
        body: deleted ? '' : m.body,
        card: deleted ? null : m.card,
        sender: m.sender_id ? { id: Number(m.sender_id), name: m.sender_name, role: m.sender_role } : null,
        mine,
        createdAt: m.created_at,
        editedAt: m.edited_at,
        deleted,
        canEdit: mine && !deleted && fresh && m.kind === 'text',
        canDelete: !deleted && m.kind !== 'system' && ((mine && fresh) || v.role === 'hr'),
        replyTo: m.reply_to_id
          ? { id: String(m.reply_to_id), senderName: m.reply_sender, body: m.reply_deleted ? 'Message deleted' : String(m.reply_body || '').slice(0, 140) }
          : null,
        reactions: m.reactions,
      };
    });
    return ok(data, more && page.length ? page[0].id : null);
  } catch (err) {
    return fail(err);
  }
}

/** POST /api/chat/<id>/messages { body, replyToId? } */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const v = await chatViewer(request);
    assertWritable(v);
    const c = await loadConversation(params.id, v);
    await assertCanPost(c, v);
    const b = await request.json().catch(() => ({}));
    const body = String(b.body ?? '').trim();
    if (!body) throw new HttpError(400, 'Write a message');
    if (body.length > MAX_MESSAGE_LENGTH) throw new HttpError(400, `Messages can be up to ${MAX_MESSAGE_LENGTH} characters`);
    assertNoSecrets(body);

    let replyTo: string | null = null;
    if (b.replyToId) {
      const r = await queryOne<{ id: string }>(
        `SELECT id FROM messages WHERE id = $1 AND conversation_id = $2`, [String(b.replyToId), c.id]
      );
      if (!r) throw new HttpError(400, 'The message you replied to is not in this conversation');
      replyTo = r.id;
    }

    const m = await queryOne<{ id: string; created_at: string }>(
      `INSERT INTO messages (conversation_id, sender_id, kind, body, reply_to_id)
       VALUES ($1, $2, 'text', $3, $4) RETURNING id, created_at`,
      [c.id, v.userId, body, replyTo]
    );
    await touchConversation(c.id);
    await query(
      `UPDATE conversation_members SET last_read_message_id = GREATEST(last_read_message_id, $3)
        WHERE conversation_id = $1 AND user_id = $2`,
      [c.id, v.userId, m!.id]
    );
    return ok({ id: String(m!.id), createdAt: m!.created_at }, null, 201);
  } catch (err) {
    return fail(err);
  }
}
