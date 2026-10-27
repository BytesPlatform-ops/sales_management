import { NextRequest } from 'next/server';
import { queryOne } from '@/lib/db';
import { handler, ok, HttpError } from '@/lib/training/http';
import { afterPost, fullMessage, loadMessage, publishDraft, threadCtx } from '@/lib/chat/project-thread';

export const dynamic = 'force-dynamic';

/**
 * POST /api/projects/{id}/messages/{msgId}/publish — send a draft once its files are uploaded.
 * Refused while any of its uploads is unfinished, or if a media/voice message has no file.
 */
export const POST = handler(async (request: NextRequest, { params }: { params: { id: string; msgId: string } }) => {
  const ctx = await threadCtx(request, Number(params.id));
  const m = await loadMessage(ctx, Number(params.msgId), { draft: true });
  if (!m.is_draft) return ok(await fullMessage(m.id));
  const f = await queryOne<{ ready: number; pending: number }>(
    `SELECT COUNT(*) FILTER (WHERE status = 'ready' AND deleted_at IS NULL)::int AS ready,
            COUNT(*) FILTER (WHERE status = 'pending' AND deleted_at IS NULL)::int AS pending
       FROM media_files WHERE entity_type = 'message' AND entity_id = $1`, [String(m.id)]
  );
  if (f!.pending) throw new HttpError(409, 'Some files are still uploading — retry or remove them');
  if (!f!.ready) throw new HttpError(400, 'Attach at least one file');
  if (m.kind === 'voice' && f!.ready !== 1) throw new HttpError(400, 'A voice note has exactly one recording');
  const id = await publishDraft(m);
  await afterPost(ctx, id, m.body);
  return ok(await fullMessage(id));
});
