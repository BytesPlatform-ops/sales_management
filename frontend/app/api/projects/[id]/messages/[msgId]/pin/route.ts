import { NextRequest } from 'next/server';
import { handler, ok, readJson } from '@/lib/training/http';
import { threadCtx } from '@/lib/chat/project-thread';
import { pinMessage } from '@/lib/chat/project-thread-actions';

export const dynamic = 'force-dynamic';

/** POST /api/projects/{id}/messages/{msgId}/pin { pinned: boolean } — anyone in the thread. */
export const POST = handler(async (request: NextRequest, { params }: { params: { id: string; msgId: string } }) => {
  const ctx = await threadCtx(request, Number(params.id));
  const b = await readJson(request).catch(() => ({}));
  return ok(await pinMessage(ctx, Number(params.msgId), b.pinned !== false));
});
