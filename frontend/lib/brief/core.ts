/**
 * Brief timeline: database helpers for /api/projects/[id]/brief and /api/brief/*.
 * Permission rules are in ./rules (pure, tested).
 */
import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { HttpError } from '@/lib/training/http';
import { getViewer, loadProject, ProjectRow, systemMessage, Viewer } from '@/lib/projects/core';
import { actorFor } from '@/lib/tickets/core';
import { notify } from '@/lib/notifications';
import { projectSettings, scheduleClarification } from '@/lib/reminders/auto';
import { cancelAuto } from '@/lib/reminders/core';
import { BriefActor, BRIEF_TYPE_LABELS, BriefType } from './rules';

export interface BriefCtx { viewer: Viewer; project: ProjectRow; actor: BriefActor }

export async function briefCtx(request: NextRequest, projectId: number): Promise<BriefCtx> {
  const viewer = await getViewer(request);
  const project = await loadProject(projectId, viewer);
  const a = await actorFor(viewer, project);
  return { viewer, project, actor: { role: a.role, userId: a.userId, memberRole: a.memberRole, projectCreatedBy: a.projectCreatedBy } };
}

export interface BriefEntryRow {
  id: number; project_id: number; type: BriefType; body: string; tags: string[]; is_original: boolean; version: number;
  created_by: number; created_at: string; edited_at: string | null; edited_by: number | null; deleted_at: string | null;
  deleted_by: number | null; source_message_id: number | null;
}

const ENTRY_COLS = `e.id, e.project_id, e.type, e.body, e.tags, e.is_original, e.version, e.created_by, e.created_at,
  e.edited_at, e.edited_by, e.deleted_at, e.deleted_by, e.source_message_id`;

/** Load an entry the viewer may see (via its project). Deleted entries only when asked (HR restore). */
export async function entryCtx(request: NextRequest, entryId: number, opts: { allowDeleted?: boolean } = {}) {
  if (!Number.isInteger(entryId) || entryId <= 0) throw new HttpError(404, 'Brief entry not found');
  const e = await queryOne<BriefEntryRow>(`SELECT ${ENTRY_COLS} FROM brief_entries e WHERE e.id = $1`, [entryId]);
  if (!e || (e.deleted_at && !opts.allowDeleted)) throw new HttpError(404, 'Brief entry not found');
  let ctx: BriefCtx;
  try {
    ctx = await briefCtx(request, e.project_id);
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) throw err;
    throw new HttpError(404, 'Brief entry not found');
  }
  e.created_by = Number(e.created_by);
  return { ...ctx, entry: e };
}

/** Every project has an original brief entry (version 1); create it if an older project lacks one. */
export async function ensureOriginal(project: { id: number; description: string; created_by: number | string; created_at: string }): Promise<number> {
  const found = await queryOne<{ id: number }>(`SELECT id FROM brief_entries WHERE project_id = $1 AND is_original`, [project.id]);
  if (found) return found.id;
  const row = await queryOne<{ id: number }>(
    `INSERT INTO brief_entries (project_id, type, body, is_original, created_by, created_at)
     VALUES ($1, 'requirement', $2, true, $3, $4)
     ON CONFLICT (project_id) WHERE is_original DO NOTHING RETURNING id`,
    [project.id, project.description || '', Number(project.created_by), project.created_at]
  );
  if (row) return row.id;
  return (await queryOne<{ id: number }>(`SELECT id FROM brief_entries WHERE project_id = $1 AND is_original`, [project.id]))!.id;
}

/** The original brief follows the project's description (edited from the details form). */
export async function syncOriginalBrief(projectId: number, description: string, userId: number) {
  const o = await queryOne<{ id: number; body: string; type: string; tags: string[]; version: number }>(
    `SELECT id, body, type, tags, version FROM brief_entries WHERE project_id = $1 AND is_original`, [projectId]
  );
  if (!o || o.body === description) return;
  await query(`INSERT INTO brief_entry_versions (entry_id, version, type, body, tags, edited_by) VALUES ($1, $2, $3, $4, $5, $6)`,
    [o.id, o.version, o.type, o.body, o.tags, userId]);
  await query(`UPDATE brief_entries SET body = $2, version = version + 1, edited_at = NOW(), edited_by = $3 WHERE id = $1`, [o.id, description, userId]);
}

export async function projectDeveloperIds(projectId: number): Promise<number[]> {
  return (await query<{ user_id: string }>(
    `SELECT user_id FROM project_members WHERE project_id = $1 AND member_role IN ('developer', 'lead_developer')`, [projectId]
  )).map((r) => Number(r.user_id));
}

export async function touchActivity(projectId: number) {
  await query(`UPDATE projects SET last_activity_at = NOW(), updated_at = NOW() WHERE id = $1`, [projectId]);
}

/** New entry → thread line, developers notified, project activity. */
export async function announceEntry(ctx: BriefCtx, entry: { id: number; type: BriefType; body: string }) {
  const preview = entry.body.replace(/\s+/g, ' ').trim().slice(0, 120);
  await systemMessage(ctx.project.id, `${ctx.viewer.name} added a brief update (${BRIEF_TYPE_LABELS[entry.type]}): ${preview}`, ctx.viewer.userId);
  await notify({
    users: await projectDeveloperIds(ctx.project.id), actorId: ctx.viewer.userId, type: 'brief_update',
    body: `${ctx.viewer.name} added a brief update on ${ctx.project.ticket_no}: ${preview}`,
    link: `/projects/${ctx.project.id}?tab=brief#brief-${entry.id}`, entity: { type: 'brief_entry', id: entry.id }, projectId: ctx.project.id,
  });
  await touchActivity(ctx.project.id);
}

/**
 * A developer asked for clarification on a brief entry. Notifies the client's agent
 * (and the entry's author), and schedules a reminder for the agent if it's still
 * unanswered after the project's threshold (24h by default). Answering cancels it.
 */
export async function onClarificationRequested(ctx: BriefCtx, entry: BriefEntryRow, markId: number, comment: string) {
  await notify({
    users: [Number(ctx.project.created_by), entry.created_by], actorId: ctx.viewer.userId, type: 'brief_clarification',
    body: `${ctx.viewer.name} needs clarification on a brief update (${ctx.project.ticket_no}): ${comment.slice(0, 200)}`,
    link: `/projects/${ctx.project.id}?tab=brief#brief-${entry.id}`, entity: { type: 'brief_mark', id: markId }, projectId: ctx.project.id,
  });
  try {
    const settings = await projectSettings(ctx.project.id);
    if (settings.clarification_enabled) {
      await scheduleClarification(markId, entry.id, ctx.project.id, Number(ctx.project.created_by), ctx.project.ticket_no, new Date(), settings.clarification_hours);
    }
  } catch (err) {
    // Reminders are a convenience; never fail the question because of them.
    if (!/does not exist/.test(String((err as Error)?.message))) console.error('[brief] clarification reminder', (err as Error)?.message);
  }
}

/** The clarification was answered: its pending reminder is no longer needed. */
export async function onClarificationResolved(markId: number) {
  await cancelAuto(`clarification:${markId}`).catch(() => {});
}
