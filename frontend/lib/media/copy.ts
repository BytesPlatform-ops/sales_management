/**
 * Copy ready files from one attachment target to another (same or different project).
 * Each copy gets its own storage object, so deleting one never affects the other.
 */
import { randomUUID } from 'crypto';
import { query } from '@/lib/db';
import { mediaStorage } from './storage';
import { safeFileName } from './rules';

export async function copyMedia(
  from: { entity_type: string; entity_id: string | number },
  to: { project_id: number; entity_type: string; entity_id: string | number },
  userId: number,
): Promise<number> {
  const files = await query<{ storage_path: string; file_name: string; mime_type: string; size_bytes: string; description: string | null; kind: string }>(
    `SELECT storage_path, file_name, mime_type, size_bytes, description, kind FROM media_files
      WHERE entity_type = $1 AND entity_id = $2 AND status = 'ready' AND deleted_at IS NULL ORDER BY created_at`,
    [from.entity_type, String(from.entity_id)]
  );
  const storage = mediaStorage();
  let n = 0;
  for (const f of files) {
    const id = randomUUID();
    const path = `projects/${to.project_id}/${to.entity_type}/${id}/${safeFileName(f.file_name)}`;
    await storage.copy(f.storage_path, path);
    await query(
      `INSERT INTO media_files (id, project_id, entity_type, entity_id, storage_path, file_name, mime_type, size_bytes, description, kind, status, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'ready', $11)`,
      [id, to.project_id, to.entity_type, String(to.entity_id), path, f.file_name, f.mime_type, f.size_bytes, f.description, f.kind, userId]
    );
    n++;
  }
  return n;
}
