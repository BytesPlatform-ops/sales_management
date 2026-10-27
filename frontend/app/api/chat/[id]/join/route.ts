import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { HttpError } from '@/lib/training/http';
import { assertWritable, chatViewer, fail, isSalesRole, ok } from '@/lib/chat/core';

/** POST /api/chat/<id>/join — join a public channel. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const v = await chatViewer(request);
    assertWritable(v);
    if (!isSalesRole(v.role) || !/^\d+$/.test(params.id)) throw new HttpError(404, 'Channel not found');
    const c = await queryOne<{ id: string }>(
      `SELECT id FROM conversations WHERE id = $1 AND type = 'channel' AND is_private = false AND archived_at IS NULL AND system_key IS NULL`,
      [params.id]
    );
    if (!c) throw new HttpError(404, 'Channel not found');
    await query(
      `INSERT INTO conversation_members (conversation_id, user_id, last_read_message_id)
       VALUES ($1, $2, COALESCE((SELECT MAX(id) FROM messages WHERE conversation_id = $1), 0))
       ON CONFLICT DO NOTHING`,
      [c.id, v.userId]
    );
    return ok({ id: String(c.id) });
  } catch (err) {
    return fail(err);
  }
}
