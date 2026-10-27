import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { handler, ok } from '@/lib/training/http';
import { MESSAGE_SELECT, threadCtx } from '@/lib/chat/project-thread';

export const dynamic = 'force-dynamic';

/** GET /api/projects/{id}/messages/pinned — pinned messages, newest pin first. */
export const GET = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const { project } = await threadCtx(request, Number(params.id));
  return ok(await query(
    `${MESSAGE_SELECT} WHERE m.project_id = $1 AND m.pinned_at IS NOT NULL AND m.deleted_at IS NULL AND NOT m.is_draft ORDER BY m.pinned_at DESC`,
    [project.id]
  ));
});
