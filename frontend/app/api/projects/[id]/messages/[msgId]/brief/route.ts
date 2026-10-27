import { NextRequest } from 'next/server';
import { handler, ok, readJson } from '@/lib/training/http';
import { threadCtx } from '@/lib/chat/project-thread';
import { messageToBrief } from '@/lib/chat/project-thread-actions';
import { actorFor } from '@/lib/tickets/core';

export const dynamic = 'force-dynamic';

/** POST /api/projects/{id}/messages/{msgId}/brief { type? } — add a message (and its files) to the brief timeline. */
export const POST = handler(async (request: NextRequest, { params }: { params: { id: string; msgId: string } }) => {
  const ctx = await threadCtx(request, Number(params.id));
  const a = await actorFor(ctx.viewer, ctx.project);
  const b = await readJson(request).catch(() => ({}));
  return ok(await messageToBrief(ctx, Number(params.msgId), b.type,
    { role: a.role, userId: a.userId, memberRole: a.memberRole, projectCreatedBy: a.projectCreatedBy }));
});
