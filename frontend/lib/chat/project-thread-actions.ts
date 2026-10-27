/** Edit / delete / pin / forward / add-to-brief for project thread messages. */
import { query, queryOne } from '@/lib/db';
import { HttpError } from '@/lib/training/http';
import { loadProject } from '@/lib/projects/core';
import { announceEntry, ensureOriginal } from '@/lib/brief/core';
import { BriefActor, canAddBrief, isBriefType } from '@/lib/brief/rules';
import { copyMedia } from '@/lib/media/copy';
import { canDeleteMessage, canEditMessage, canForwardMessage } from './rules';
import { fullMessage, loadMessage, MessageRow, ThreadCtx } from './project-thread';

const facts = (m: MessageRow) => ({ user_id: m.user_id, created_at: m.created_at, kind: m.kind, deleted_at: m.deleted_at });

export async function editMessage(ctx: ThreadCtx, id: number, rawBody: unknown) {
  const m = await loadMessage(ctx, id);
  if (!canEditMessage(facts(m), ctx.viewer)) {
    throw new HttpError(403, Number(m.user_id) === ctx.viewer.userId ? 'Messages can only be edited for 15 minutes' : 'You can only edit your own messages');
  }
  const body = String(rawBody ?? '').trim();
  if (!body && m.kind === 'message') throw new HttpError(400, 'Message can’t be empty');
  if (body.length > 10000) throw new HttpError(400, 'Message is too long');
  await query(`UPDATE project_messages SET body = $2, edited_at = NOW(), updated_at = NOW() WHERE id = $1`, [m.id, body]);
  return fullMessage(m.id);
}

/** Delete for everyone: text and files are removed for all; a "message deleted" placeholder stays. */
export async function deleteMessage(ctx: ThreadCtx, m: MessageRow) {
  if (!canDeleteMessage(facts(m), ctx.viewer)) {
    throw new HttpError(403, Number(m.user_id) === ctx.viewer.userId ? 'Messages can only be deleted for 15 minutes' : 'You can only delete your own messages');
  }
  await query(
    `UPDATE project_messages SET deleted_at = NOW(), deleted_by = $2, body = '', meta = NULL, pinned_at = NULL, pinned_by = NULL, updated_at = NOW() WHERE id = $1`,
    [m.id, ctx.viewer.userId]
  );
  await query(`UPDATE media_files SET deleted_at = NOW(), deleted_by = $2 WHERE entity_type = 'message' AND entity_id = $1 AND deleted_at IS NULL`,
    [String(m.id), ctx.viewer.userId]);
}

/** Pin / unpin: anyone who can post in the thread (system messages and deleted ones can't be pinned). */
export async function pinMessage(ctx: ThreadCtx, id: number, pinned: boolean) {
  const m = await loadMessage(ctx, id);
  if (m.deleted_at) throw new HttpError(400, 'Deleted messages can’t be pinned');
  if (m.kind === 'system') throw new HttpError(400, 'Automatic messages can’t be pinned');
  await query(
    `UPDATE project_messages SET pinned_at = CASE WHEN $2 THEN NOW() ELSE NULL END, pinned_by = CASE WHEN $2 THEN $3::bigint ELSE NULL END,
            updated_at = NOW() WHERE id = $1`,
    [m.id, pinned, ctx.viewer.userId]
  );
  return fullMessage(m.id);
}

/** Forward a message (text + files) to another project's thread. HR only. */
export async function forwardMessage(ctx: ThreadCtx, id: number, targetProjectId: number) {
  if (!canForwardMessage(ctx.viewer)) throw new HttpError(403, 'Only HR can forward messages');
  const m = await loadMessage(ctx, id);
  if (m.deleted_at || m.kind === 'system') throw new HttpError(400, 'This message can’t be forwarded');
  const target = await loadProject(targetProjectId, ctx.viewer);
  if (target.id === ctx.project.id) throw new HttpError(400, 'Pick a different project');
  const author = await queryOne<{ full_name: string }>(`SELECT full_name FROM users WHERE id = $1`, [m.user_id]);
  const row = await queryOne<{ id: number }>(
    `INSERT INTO project_messages (project_id, user_id, kind, body, meta, forwarded_from) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [target.id, ctx.viewer.userId, m.kind, m.body, m.meta ? JSON.stringify(m.meta) : null,
      JSON.stringify({ project_id: ctx.project.id, ticket_no: ctx.project.ticket_no, author: author?.full_name ?? null, message_id: m.id })]
  );
  await copyMedia({ entity_type: 'message', entity_id: m.id }, { project_id: target.id, entity_type: 'message', entity_id: row!.id }, ctx.viewer.userId);
  await query(`UPDATE projects SET updated_at = NOW(), last_activity_at = NOW() WHERE id = $1`, [target.id]);
  return { id: row!.id, project_id: target.id };
}

/** Turn a message into a brief update (text + files). HR or the client's agent. */
export async function messageToBrief(ctx: ThreadCtx, id: number, type: unknown, actor: BriefActor) {
  if (!canAddBrief(actor)) throw new HttpError(403, 'Only HR or the client’s agent can add to the brief');
  const m = await loadMessage(ctx, id);
  if (m.deleted_at || m.kind === 'system') throw new HttpError(400, 'This message can’t be added to the brief');
  const t = isBriefType(type) ? type : 'feedback';
  await ensureOriginal(ctx.project as any);
  const author = await queryOne<{ full_name: string }>(`SELECT full_name FROM users WHERE id = $1`, [m.user_id]);
  const body = `${m.body || (m.kind === 'voice' ? '_Voice note_' : '_Files from the thread_')}\n\n_From the project thread, ${author?.full_name || 'someone'}._`;
  const e = await queryOne<{ id: number; type: any; body: string }>(
    `INSERT INTO brief_entries (project_id, type, body, created_by, source_message_id) VALUES ($1, $2, $3, $4, $5) RETURNING id, type, body`,
    [ctx.project.id, t, body, ctx.viewer.userId, m.id]
  );
  await copyMedia({ entity_type: 'message', entity_id: m.id }, { project_id: ctx.project.id, entity_type: 'brief_entry', entity_id: e!.id }, ctx.viewer.userId);
  await announceEntry({ viewer: ctx.viewer, project: ctx.project, actor }, e!);
  return { id: e!.id };
}
