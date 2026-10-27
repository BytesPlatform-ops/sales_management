/**
 * Project thread (WhatsApp-style chat) on project_messages / project_reads.
 * The browser side is generic (components/chat/*) and talks to any stream that
 * returns this shape; team channels/DMs (Phase 9) implement the same shape.
 */
import { NextRequest } from 'next/server';
import { pool, query, queryOne } from '@/lib/db';
import { HttpError } from '@/lib/training/http';
import { getViewer, loadProject, ProjectRow, Viewer } from '@/lib/projects/core';
import { notify } from '@/lib/notifications';
import { mentionedUserIds } from '@/lib/tickets/mentions';
import { mediaStorage } from '@/lib/media/storage';

export interface ThreadCtx { viewer: Viewer; project: ProjectRow }

export async function threadCtx(request: NextRequest, projectId: number): Promise<ThreadCtx> {
  const viewer = await getViewer(request);
  // Helpers with a comment-level grant may talk in the thread; view-only grants read it.
  return { viewer, project: await loadProject(projectId, viewer, { grantWrite: 'comment' }) };
}

export interface MessageRow {
  id: number; project_id: number; user_id: string | null; kind: 'message' | 'media' | 'voice' | 'system'; body: string;
  reply_to: number | null; edited_at: string | null; deleted_at: string | null; pinned_at: string | null; is_draft: boolean;
  forwarded_from: unknown; meta: unknown; created_at: string; updated_at: string;
}

/** Message + author, quoted reply, pinner and its files, as the browser renders it. Drafts never appear. */
export const MESSAGE_SELECT = `
  SELECT m.id, m.project_id, m.user_id, m.kind,
         CASE WHEN m.deleted_at IS NULL THEN m.body ELSE '' END AS body,
         m.reply_to, m.edited_at, m.deleted_at, m.pinned_at, pu.full_name AS pinned_by_name, m.forwarded_from,
         CASE WHEN m.deleted_at IS NULL THEN m.meta ELSE NULL END AS meta,
         m.created_at, m.updated_at,
         u.full_name AS author, u.role AS author_role,
         CASE WHEN r.deleted_at IS NULL THEN r.body ELSE NULL END AS reply_body, ru.full_name AS reply_author, r.kind AS reply_kind,
         CASE WHEN m.deleted_at IS NULL THEN COALESCE((
           SELECT json_agg(json_build_object('id', f.id, 'file_name', f.file_name, 'mime_type', f.mime_type, 'size_bytes', f.size_bytes,
                                             'kind', f.kind, 'description', f.description) ORDER BY f.created_at)
             FROM media_files f WHERE f.entity_type = 'message' AND f.entity_id = m.id::text AND f.status = 'ready' AND f.deleted_at IS NULL), '[]')
         ELSE '[]' END AS media
    FROM project_messages m
    LEFT JOIN users u ON u.id = m.user_id
    LEFT JOIN users pu ON pu.id = m.pinned_by
    LEFT JOIN project_messages r ON r.id = m.reply_to
    LEFT JOIN users ru ON ru.id = r.user_id`;

export async function loadMessage(ctx: ThreadCtx, id: number, opts: { draft?: boolean } = {}): Promise<MessageRow> {
  const m = await queryOne<MessageRow>(
    `SELECT id, project_id, user_id, kind, body, reply_to, edited_at, deleted_at, pinned_at, is_draft, forwarded_from, meta, created_at, updated_at
       FROM project_messages WHERE id = $1 AND project_id = $2`,
    [id, ctx.project.id]
  );
  if (!m || (m.is_draft && (!opts.draft || Number(m.user_id) !== ctx.viewer.userId))) throw new HttpError(404, 'Message not found');
  return m;
}

export async function fullMessage(id: number) {
  return queryOne(`${MESSAGE_SELECT} WHERE m.id = $1`, [id]);
}

/** People who take part in the thread: the client's agent, the supervisor and every project member. */
export async function participants(project: ProjectRow): Promise<number[]> {
  const rows = await query<{ user_id: string }>(`SELECT user_id FROM project_members WHERE project_id = $1`, [project.id]);
  const ids = new Set<number>(rows.map((r) => Number(r.user_id)));
  ids.add(Number(project.created_by));
  if (project.supervisor_id) ids.add(Number(project.supervisor_id));
  return Array.from(ids);
}

export async function markRead(projectId: number, userId: number, upTo: number) {
  if (!upTo) return;
  await query(
    `INSERT INTO project_reads (project_id, user_id, last_read_message_id) VALUES ($1, $2, $3)
     ON CONFLICT (project_id, user_id) DO UPDATE SET last_read_message_id = GREATEST(project_reads.last_read_message_id, EXCLUDED.last_read_message_id)`,
    [projectId, userId, upTo]
  );
}

/** After a message goes out: project activity, mentions. */
export async function afterPost(ctx: ThreadCtx, messageId: number, body: string) {
  await query(`UPDATE projects SET updated_at = NOW(), last_activity_at = NOW() WHERE id = $1`, [ctx.project.id]);
  await markRead(ctx.project.id, ctx.viewer.userId, messageId);
  if (body) {
    const mentioned = await mentionedUserIds(ctx.project.id, body);
    await notify({
      users: mentioned, actorId: ctx.viewer.userId, type: 'thread_mention',
      body: `${ctx.viewer.name} mentioned you in ${ctx.project.ticket_no}: ${body.slice(0, 160)}`,
      link: `/projects/${ctx.project.id}?tab=thread#m-${messageId}`, projectId: ctx.project.id,
    });
  }
}

/**
 * Publish a draft: re-insert it with a fresh id (so everyone's "after=<id>" polling
 * sees it), move its files over, drop the draft. All in one transaction.
 */
export async function publishDraft(draft: MessageRow): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [n] } = await client.query(
      `INSERT INTO project_messages (project_id, user_id, kind, body, reply_to, meta, forwarded_from)
       SELECT project_id, user_id, kind, body, reply_to, meta, forwarded_from FROM project_messages WHERE id = $1 RETURNING id`,
      [draft.id]
    );
    await client.query(`UPDATE media_files SET entity_id = $2 WHERE entity_type = 'message' AND entity_id = $1`, [String(draft.id), String(n.id)]);
    await client.query(`DELETE FROM project_messages WHERE id = $1`, [draft.id]);
    await client.query('COMMIT');
    return n.id;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Throw away a draft and any files uploaded for it. */
export async function discardDraft(draft: MessageRow) {
  const files = await query<{ id: string; storage_path: string }>(
    `SELECT id, storage_path FROM media_files WHERE entity_type = 'message' AND entity_id = $1`, [String(draft.id)]
  );
  for (const f of files) await mediaStorage().remove(f.storage_path).catch(() => {});
  await query(`DELETE FROM media_files WHERE entity_type = 'message' AND entity_id = $1`, [String(draft.id)]);
  await query(`DELETE FROM project_messages WHERE id = $1`, [draft.id]);
}
