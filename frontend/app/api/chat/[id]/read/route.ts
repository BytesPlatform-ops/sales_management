import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { chatViewer, fail, loadConversation, ok } from '@/lib/chat/core';

/** POST /api/chat/<id>/read { messageId? } — mark read up to a message (default: the newest). */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const v = await chatViewer(request);
    const c = await loadConversation(params.id, v);
    const b = await request.json().catch(() => ({}));
    const upTo = b.messageId && /^\d+$/.test(String(b.messageId)) ? String(b.messageId) : null;
    await query(
      `UPDATE conversation_members
          SET last_read_message_id = GREATEST(last_read_message_id,
                COALESCE($3::bigint, (SELECT MAX(id) FROM messages WHERE conversation_id = $1), 0))
        WHERE conversation_id = $1 AND user_id = $2`,
      [c.id, v.userId, upTo]
    );
    return ok({ read: true });
  } catch (err) {
    return fail(err);
  }
}
