import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { HttpError } from '@/lib/training/http';
import { assertWritable, chatViewer, fail, ok, REACTIONS } from '@/lib/chat/core';

/** POST /api/messages/<id>/react { emoji } — toggles my reaction. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const v = await chatViewer(request);
    assertWritable(v);
    const b = await request.json().catch(() => ({}));
    const emoji = String(b.emoji || '');
    if (!(REACTIONS as readonly string[]).includes(emoji)) throw new HttpError(400, 'Unknown reaction');
    if (!/^\d+$/.test(params.id)) throw new HttpError(404, 'Message not found');
    const m = await queryOne<{ id: string }>(
      `SELECT x.id FROM messages x
         JOIN conversation_members cm ON cm.conversation_id = x.conversation_id AND cm.user_id = $2
        WHERE x.id = $1 AND x.deleted_at IS NULL AND x.kind <> 'system'`,
      [params.id, v.userId]
    );
    if (!m) throw new HttpError(404, 'Message not found');
    const removed = await query(
      `DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3 RETURNING 1`,
      [m.id, v.userId, emoji]
    );
    if (!removed.length) {
      await query(`INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [m.id, v.userId, emoji]);
    }
    return ok({ reacted: !removed.length });
  } catch (err) {
    return fail(err);
  }
}
