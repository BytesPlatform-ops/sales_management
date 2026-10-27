import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { HttpError } from '@/lib/training/http';
import { assertNoSecrets, assertWritable, chatViewer, EDIT_WINDOW_MS, fail, MAX_MESSAGE_LENGTH, ok } from '@/lib/chat/core';
import type { Viewer } from '@/lib/projects/core';

interface MessageRow { id: string; conversation_id: string; sender_id: string | null; kind: string; created_at: string; deleted_at: string | null }

/** A message in a conversation the viewer belongs to (404 otherwise). */
async function loadMessage(id: string, v: Viewer): Promise<MessageRow> {
  if (!/^\d+$/.test(id)) throw new HttpError(404, 'Message not found');
  const m = await queryOne<MessageRow>(
    `SELECT x.id, x.conversation_id, x.sender_id, x.kind, x.created_at, x.deleted_at
       FROM messages x JOIN conversation_members cm ON cm.conversation_id = x.conversation_id AND cm.user_id = $2
      WHERE x.id = $1`,
    [id, v.userId]
  );
  if (!m) throw new HttpError(404, 'Message not found');
  return m;
}

const fresh = (m: MessageRow) => Date.now() - new Date(m.created_at).getTime() < EDIT_WINDOW_MS;

/** PATCH /api/messages/<id> { body } — the sender, within 15 minutes. */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const v = await chatViewer(request);
    assertWritable(v);
    const m = await loadMessage(params.id, v);
    if (Number(m.sender_id) !== v.userId || m.kind !== 'text') throw new HttpError(403, 'You can only edit your own messages');
    if (m.deleted_at) throw new HttpError(400, 'This message was deleted');
    if (!fresh(m)) throw new HttpError(403, 'Messages can be edited for 15 minutes after sending');
    const b = await request.json().catch(() => ({}));
    const body = String(b.body ?? '').trim();
    if (!body) throw new HttpError(400, 'Write a message');
    if (body.length > MAX_MESSAGE_LENGTH) throw new HttpError(400, `Messages can be up to ${MAX_MESSAGE_LENGTH} characters`);
    assertNoSecrets(body);
    await query(`UPDATE messages SET body = $2, edited_at = NOW() WHERE id = $1`, [m.id, body]);
    return ok({ id: String(m.id) });
  } catch (err) {
    return fail(err);
  }
}

/** DELETE /api/messages/<id> — the sender within 15 minutes, or HR at any time. Kept for audit. */
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const v = await chatViewer(request);
    assertWritable(v);
    const m = await loadMessage(params.id, v);
    if (m.deleted_at) return ok({ id: String(m.id) });
    if (m.kind === 'system') throw new HttpError(403, 'System messages can’t be deleted');
    const mine = Number(m.sender_id) === v.userId;
    if (!(v.role === 'hr' || (mine && fresh(m)))) {
      throw new HttpError(403, mine ? 'Messages can be deleted for 15 minutes after sending' : 'You can only delete your own messages');
    }
    await query(`UPDATE messages SET deleted_at = NOW(), deleted_by = $2 WHERE id = $1`, [m.id, v.userId]);
    return ok({ id: String(m.id) });
  } catch (err) {
    return fail(err);
  }
}
