import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { query } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { assertEntityAccess, entityMediaAccess, projectIdFor } from '@/lib/media/access';
import { descriptionRequired, isMediaEntity, kindOf, maxUploadBytes, normalizeMime, safeFileName } from '@/lib/media/rules';
import { mediaStorage } from '@/lib/media/storage';

export const dynamic = 'force-dynamic';

/**
 * POST /api/media/upload-url { entity_type, entity_id, file_name, mime_type, size_bytes, description? }
 * Creates a pending file record and returns a short-lived URL the browser uploads to
 * directly. Call /api/media/{id}/complete afterwards.
 */
export const POST = handler(async (request: NextRequest) => {
  const b = await readJson(request);
  if (!isMediaEntity(b.entity_type)) throw new HttpError(400, 'Files can be attached to a project, ticket, comment, meeting, brief update or message');
  const projectId = await projectIdFor(b.entity_type, String(b.entity_id));
  const { viewer, project } = await entityMediaAccess(request, b.entity_type, String(b.entity_id), projectId, 'attach');
  await assertEntityAccess(viewer, project, b.entity_type, String(b.entity_id), 'attach');

  const size = Number(b.size_bytes);
  const max = maxUploadBytes();
  if (!Number.isFinite(size) || size <= 0) throw new HttpError(400, 'Empty file');
  if (size > max) throw new HttpError(400, `Files must be ${Math.round(max / 1024 / 1024)} MB or smaller`);
  const description = typeof b.description === 'string' ? b.description.trim().slice(0, 1000) : '';
  if (descriptionRequired(b.entity_type) && !description) throw new HttpError(400, 'Add a short description for this file');

  const mime = normalizeMime(b.mime_type);
  const fileName = String(b.file_name || 'file').slice(0, 255);
  const id = randomUUID();
  const objectPath = `projects/${projectId}/${b.entity_type}/${id}/${safeFileName(fileName)}`;
  const storage = mediaStorage();
  const upload = await storage.signedUpload(objectPath, mime, max);

  await query(
    `INSERT INTO media_files (id, project_id, entity_type, entity_id, storage_path, file_name, mime_type, size_bytes, description, kind, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [id, projectId, b.entity_type, String(Number(b.entity_id)), objectPath, fileName, mime, size, description || null,
      // A recorded voice note is audio shown with the voice player.
      b.entity_type === 'message' && b.kind === 'voice' && kindOf(mime) === 'audio' ? 'voice' : kindOf(mime), viewer.userId]
  );
  return ok({ id, upload, max_bytes: max });
});
