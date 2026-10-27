import { NextRequest } from 'next/server';
import { handler, ok, readJson } from '@/lib/training/http';
import { discardDraft, loadMessage, threadCtx } from '@/lib/chat/project-thread';
import { deleteMessage, editMessage } from '@/lib/chat/project-thread-actions';

export const dynamic = 'force-dynamic';
type Ctx = { params: { id: string; msgId: string } };

/** PATCH /api/projects/{id}/messages/{msgId} { body } — your own message (or caption), within 15 minutes. */
export const PATCH = handler(async (request: NextRequest, { params }: Ctx) => {
  const ctx = await threadCtx(request, Number(params.id));
  return ok(await editMessage(ctx, Number(params.msgId), (await readJson(request)).body));
});

/**
 * DELETE /api/projects/{id}/messages/{msgId}
 * Your unsent draft: thrown away with its files. A sent message: "delete for everyone"
 * (your own within 15 minutes; HR any time).
 */
export const DELETE = handler(async (request: NextRequest, { params }: Ctx) => {
  const ctx = await threadCtx(request, Number(params.id));
  const m = await loadMessage(ctx, Number(params.msgId), { draft: true });
  if (m.is_draft) await discardDraft(m);
  else await deleteMessage(ctx, m);
  return ok({ deleted: m.id });
});
