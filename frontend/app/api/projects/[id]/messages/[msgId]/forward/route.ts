import { NextRequest } from 'next/server';
import { handler, ok, readJson } from '@/lib/training/http';
import { threadCtx } from '@/lib/chat/project-thread';
import { forwardMessage } from '@/lib/chat/project-thread-actions';

export const dynamic = 'force-dynamic';

/** POST /api/projects/{id}/messages/{msgId}/forward { project_id } — HR only; copies text and files. */
export const POST = handler(async (request: NextRequest, { params }: { params: { id: string; msgId: string } }) => {
  const ctx = await threadCtx(request, Number(params.id));
  return ok(await forwardMessage(ctx, Number(params.msgId), Number((await readJson(request)).project_id)));
});
