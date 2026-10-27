import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { handler, ok, HttpError } from '@/lib/training/http';
import { systemMessage } from '@/lib/projects/core';
import { loadMedia } from '@/lib/media/access';
import { maxUploadBytes } from '@/lib/media/rules';
import { mediaStorage } from '@/lib/media/storage';

export const dynamic = 'force-dynamic';

/**
 * POST /api/media/{id}/complete — the uploader confirms the upload finished.
 * The object must exist and be within the size limit, otherwise it is removed.
 */
export const POST = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const { media: m, viewer } = await loadMedia(request, params.id);
  if (Number(m.uploaded_by) !== viewer.userId) throw new HttpError(403, 'Not your upload');
  if (m.status === 'ready') return ok({ id: m.id, status: 'ready' });

  const storage = mediaStorage();
  const size = await storage.size(m.storage_path);
  if (size === null) throw new HttpError(400, 'Upload not found — try again');
  if (size > maxUploadBytes()) {
    await storage.remove(m.storage_path);
    await query(`DELETE FROM media_files WHERE id = $1`, [m.id]);
    throw new HttpError(400, 'File is larger than the upload limit');
  }
  await query(`UPDATE media_files SET status = 'ready', size_bytes = $2 WHERE id = $1`, [m.id, size || m.size_bytes]);

  // Project-level files are worth a line in the thread; ticket/comment files show on the ticket.
  if (m.entity_type === 'project') {
    await systemMessage(m.project_id, `${viewer.name} added a file: ${m.file_name}${m.description ? ` — ${m.description}` : ''}`, viewer.userId);
  } else if (m.entity_type === 'ticket') {
    await query(`UPDATE tickets SET updated_at = NOW() WHERE id = $1`, [Number(m.entity_id)]);
    const t = await queryOne<{ id: number }>(`SELECT id FROM tickets WHERE id = $1`, [Number(m.entity_id)]);
    if (t) {
      await query(`INSERT INTO ticket_history (ticket_id, user_id, field, old_value, new_value) VALUES ($1, $2, 'attachment', NULL, $3::jsonb)`,
        [t.id, viewer.userId, JSON.stringify(m.file_name)]);
    }
  }
  return ok({ id: m.id, status: 'ready' });
});
