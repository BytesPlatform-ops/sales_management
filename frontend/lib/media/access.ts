/**
 * Media permissions follow the project: if you can see the project you can see and
 * add its files. Removing someone from a project removes their file access too,
 * because every request re-checks the project.
 */
import { NextRequest } from 'next/server';
import { queryOne } from '@/lib/db';
import { HttpError } from '@/lib/training/http';
import { getViewer, loadProject, ProjectRow, Viewer } from '@/lib/projects/core';
import { activeGrant, levelAtLeast } from '@/lib/access/grants';
import { MediaEntity } from './rules';

/** The project an attachment target belongs to (404 if it doesn't exist). */
export async function projectIdFor(entity: MediaEntity, entityId: string): Promise<number> {
  const id = Number(entityId);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid entity id');
  let row: { project_id: number } | null = null;
  if (entity === 'project') row = { project_id: id };
  else if (entity === 'ticket') row = await queryOne(`SELECT project_id FROM tickets WHERE id = $1 AND deleted_at IS NULL`, [id]);
  else if (entity === 'ticket_comment') {
    row = await queryOne(`SELECT t.project_id FROM ticket_comments c JOIN tickets t ON t.id = c.ticket_id
                           WHERE c.id = $1 AND c.deleted_at IS NULL AND t.deleted_at IS NULL`, [id]);
  } else if (entity === 'meeting') row = await queryOne(`SELECT project_id FROM project_meetings WHERE id = $1`, [id]);
  else if (entity === 'brief_entry') row = await queryOne(`SELECT project_id FROM brief_entries WHERE id = $1 AND deleted_at IS NULL`, [id]);
  else if (entity === 'message') row = await queryOne(`SELECT project_id FROM project_messages WHERE id = $1 AND deleted_at IS NULL`, [id]);
  else if (entity === 'work_update') row = await queryOne(`SELECT project_id FROM work_updates WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!row) throw new HttpError(404, 'Not found');
  return Number(row.project_id);
}

/**
 * Extra rules on top of "can see the project", for attaching and listing:
 *   brief_entry  attach: HR or the client's agent (the people who add brief updates)
 *   message      attach: only the message's author, only while it's a draft;
 *                list: drafts are visible to their author only
 */
export async function assertEntityAccess(viewer: Viewer, project: ProjectRow, entity: MediaEntity, entityId: string, mode: 'attach' | 'list') {
  const id = Number(entityId);
  if (entity === 'brief_entry' && mode === 'attach') {
    if (!(viewer.role === 'hr' || (viewer.role === 'agent' && Number(project.created_by) === viewer.userId))) {
      throw new HttpError(403, 'Only HR or the client’s agent can add files to the brief');
    }
  }
  if (entity === 'work_update' && mode === 'attach') {
    const w = await queryOne<{ user_id: string }>(`SELECT user_id FROM work_updates WHERE id = $1`, [id]);
    if (!w || (Number(w.user_id) !== viewer.userId && viewer.role !== 'hr')) throw new HttpError(403, 'Attach files to your own work update');
  }
  if (entity === 'message') {
    const m = await queryOne<{ user_id: string | null; is_draft: boolean }>(`SELECT user_id, is_draft FROM project_messages WHERE id = $1`, [id]);
    if (!m) throw new HttpError(404, 'Not found');
    const mine = Number(m.user_id) === viewer.userId;
    if (mode === 'attach' && !(mine && m.is_draft)) throw new HttpError(403, 'Attach files while writing your own message');
    if (mode === 'list' && m.is_draft && !mine) throw new HttpError(404, 'Not found');
  }
}

export async function mediaProject(request: NextRequest, projectId: number): Promise<{ viewer: Viewer; project: ProjectRow }> {
  const viewer = await getViewer(request);
  return { viewer, project: await loadProject(projectId, viewer) };
}

/** The ticket a ticket / ticket_comment attachment belongs to (for ticket-only grants). */
async function ticketIdFor(entity: MediaEntity, entityId: string): Promise<number | null> {
  if (entity === 'ticket') return Number(entityId);
  if (entity === 'ticket_comment') {
    const r = await queryOne<{ ticket_id: number }>(`SELECT ticket_id FROM ticket_comments WHERE id = $1`, [Number(entityId)]);
    return r ? Number(r.ticket_id) : null;
  }
  return null;
}

/**
 * Access to the files on one thing, for listing ('read') or adding ('attach').
 *   own project access            as before
 *   project grant (help request)  read everything; attach only to own messages / ticket comments (comment level)
 *   ticket grant (share)          that ticket's files; attach to its comments (comment), to the ticket (edit)
 */
export async function entityMediaAccess(request: NextRequest, entity: MediaEntity, entityId: string, projectId: number, mode: 'read' | 'attach')
  : Promise<{ viewer: Viewer; project: ProjectRow }> {
  const viewer = await getViewer(request);
  const commentish = entity === 'message' || entity === 'ticket_comment';
  try {
    const project = await loadProject(projectId, viewer, mode === 'attach' && commentish ? { grantWrite: 'comment' } : {});
    return { viewer, project };
  } catch (e) {
    if (!(e instanceof HttpError) || e.status === 401) throw e;
    const tid = await ticketIdFor(entity, entityId);
    const g = tid ? await activeGrant(viewer.userId, 'ticket', tid) : null;
    const need = mode === 'read' ? 'view' : entity === 'ticket_comment' ? 'comment' : 'edit';
    if (!g || !levelAtLeast(g.level, need)) throw e;
    const raw = await queryOne<ProjectRow>(`SELECT * FROM projects WHERE id = $1`, [projectId]);
    if (!raw) throw new HttpError(404, 'Not found');
    return { viewer, project: raw };
  }
}

export interface MediaRow {
  id: string; project_id: number; entity_type: MediaEntity; entity_id: string; storage_path: string; file_name: string;
  mime_type: string; size_bytes: string; description: string | null; kind: string; status: 'pending' | 'ready';
  uploaded_by: string; created_at: string; deleted_at: string | null; deleted_by: string | null;
}

/** Load a file the viewer may access. Deleted files only for HR (restore). */
export async function loadMedia(request: NextRequest, id: string, opts: { allowDeleted?: boolean } = {}) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, 'File not found');
  const m = await queryOne<MediaRow>(`SELECT * FROM media_files WHERE id = $1`, [id]);
  if (!m || (m.deleted_at && !opts.allowDeleted)) throw new HttpError(404, 'File not found');
  const viewer = await getViewer(request);
  let project: ProjectRow;
  try {
    // Routes that change a file check uploader/HR themselves, so grant-only readers get through here.
    project = await loadProject(m.project_id, viewer, { grantWrite: 'view' });
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) throw e;
    // Shared on its own, or on a ticket shared on its own.
    const tid = await ticketIdFor(m.entity_type, m.entity_id).catch(() => null);
    const g = (await activeGrant(viewer.userId, 'file', m.id)) || (tid ? await activeGrant(viewer.userId, 'ticket', tid) : null);
    const raw = g ? await queryOne<ProjectRow>(`SELECT * FROM projects WHERE id = $1`, [m.project_id]) : null;
    if (!raw) throw new HttpError(404, 'File not found');
    project = raw;
  }
  return { media: m, viewer, project };
}
