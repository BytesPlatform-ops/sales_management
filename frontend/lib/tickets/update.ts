/**
 * Changing a ticket: one implementation shared by PATCH /api/tickets/{id} and the
 * bulk edit route, so both enforce the same rules (edit vs work permissions, CR
 * gate, blocked confirmation, history, notifications).
 */
import { query, queryOne } from '@/lib/db';
import { HttpError } from '@/lib/training/http';
import { systemMessage } from '@/lib/projects/core';
import { isStatus, rankBetween, statusMoveError, STATUS_LABELS, triageDueAt, TicketStatus } from './rules';
import {
  assigneeIds, capabilities, notify, notifyUnblocked, openBlockers, recordHistory, slaHours, TICKET_COLS, TicketCtx, TicketRow,
  ticketLink, watch, watcherIds,
} from './core';
import { dateOrNull, epicInProject, hoursOrNull, parentInProject, priorityOf, projectDevIds, str, typeOf } from './input';

export const EDIT_FIELDS = ['title', 'description', 'type', 'priority', 'epic_id', 'parent_id', 'start_date', 'due_date'] as const;

export interface TicketPatch {
  title?: unknown; description?: unknown; type?: unknown; priority?: unknown; epic_id?: unknown; parent_id?: unknown;
  start_date?: unknown; due_date?: unknown; label_ids?: unknown;
  status?: unknown; confirm_blocked?: unknown; estimate_hours?: unknown;
  move?: { after_id?: unknown; before_id?: unknown } | null;
}

/** Apply a patch with the viewer's permissions. Throws HttpError (403/400/409) without changing anything on failure. */
export async function applyTicketPatch(ctx: TicketCtx, b: TicketPatch): Promise<TicketRow> {
  const { ticket: t, actor, viewer, project } = ctx;
  const can = capabilities(ctx);

  const set: Record<string, unknown> = {};
  const wantsEdit = EDIT_FIELDS.some((f) => b[f] !== undefined) || b.label_ids !== undefined;
  if (wantsEdit && !can.edit) throw new HttpError(403, 'You can’t edit this ticket');
  if ((b.status !== undefined || b.estimate_hours !== undefined || b.move) && !can.work) {
    throw new HttpError(403, 'Only the project’s developers or HR can do that');
  }

  if (b.title !== undefined) set.title = str(b.title, 'Title', 300, true);
  if (b.description !== undefined) set.description = str(b.description, 'Description', 50_000) ?? '';
  if (b.type !== undefined) set.type = typeOf(b.type);
  if (b.priority !== undefined) set.priority = priorityOf(b.priority);
  if (b.epic_id !== undefined) set.epic_id = await epicInProject(b.epic_id, project.id);
  if (b.parent_id !== undefined) set.parent_id = await parentInProject(b.parent_id, project.id, t.id);
  if (b.start_date !== undefined) set.start_date = dateOrNull(b.start_date, 'Start date');
  if (b.due_date !== undefined) set.due_date = dateOrNull(b.due_date, 'Due date');
  if (b.estimate_hours !== undefined) set.estimate_hours = hoursOrNull(b.estimate_hours);

  // Becoming a change request starts the approval; leaving it clears it.
  if (set.type === 'change_request' && t.type !== 'change_request') set.cr_status = 'pending';
  if (set.type && set.type !== 'change_request' && t.type === 'change_request') set.cr_status = null;
  // Re-prioritising in triage moves the SLA deadline.
  if (set.priority && t.status === 'triage') set.triage_due_at = triageDueAt(new Date(t.created_at), set.priority as any, await slaHours());

  let to: TicketStatus | null = null;
  if (b.status !== undefined && b.status !== t.status) {
    if (!isStatus(b.status)) throw new HttpError(400, 'Unknown status');
    const next: TicketStatus = b.status;
    to = next;
    const err = statusMoveError(actor, { status: t.status, type: (set.type as string) ?? t.type, cr_status: (set.cr_status as string | null) ?? t.cr_status }, next);
    if (err) throw new HttpError(400, err);
    if (['in_progress', 'in_review', 'in_qa'].includes(next) && !b.confirm_blocked) {
      const blockers = await openBlockers(t.id);
      if (blockers.length) throw new HttpError(409, `Blocked by ${blockers.map((x) => x.key).join(', ')}. Move it anyway?`);
    }
    set.status = next;
    if (next === 'done') set.done_at = new Date();
    if (next === 'closed') set.closed_at = new Date();
    if (!['done', 'closed'].includes(next)) { set.done_at = null; set.closed_at = null; }
  }

  if (b.move) {
    // Place between two neighbours (either may be missing = start/end of the list).
    const ids = [b.move.after_id, b.move.before_id].filter((x) => x !== undefined && x !== null && x !== '').map(Number);
    const ranks = ids.length
      ? await query<{ id: number; rank: string }>(`SELECT id, rank FROM tickets WHERE id = ANY($1::int[]) AND project_id = $2`, [ids, project.id])
      : [];
    const r = (id: unknown) => ranks.find((x) => x.id === Number(id))?.rank ?? null;
    const after = b.move.after_id ? r(b.move.after_id) : null;
    const before = b.move.before_id ? r(b.move.before_id) : null;
    if ((b.move.after_id && after === null) || (b.move.before_id && before === null)) throw new HttpError(400, 'Neighbour ticket not in this project');
    if (after !== null && before !== null && after >= before) throw new HttpError(400, 'Invalid position');
    set.rank = rankBetween(after, before);
  }

  const keys = Object.keys(set);
  if (keys.length) {
    await query(
      `UPDATE tickets SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = NOW() WHERE id = $1`,
      [t.id, ...keys.map((k) => set[k])]
    );
    for (const k of keys) {
      if (['rank', 'triage_due_at', 'done_at', 'closed_at', 'cr_status'].includes(k)) continue;
      const before = (t as any)[k];
      if (String(before ?? '') !== String(set[k] ?? '')) await recordHistory(t.id, viewer.userId, k, before, set[k]);
    }
  }

  if (Array.isArray(b.label_ids)) {
    const ids = b.label_ids.map(Number).filter(Number.isFinite);
    await query(`DELETE FROM ticket_labels WHERE ticket_id = $1 AND NOT (label_id = ANY($2::int[]))`, [t.id, ids]);
    await query(
      `INSERT INTO ticket_labels (ticket_id, label_id) SELECT $1, l.id FROM labels l
        WHERE l.id = ANY($2::int[]) AND (l.project_id IS NULL OR l.project_id = $3) ON CONFLICT DO NOTHING`,
      [t.id, ids, project.id]
    );
    await recordHistory(t.id, viewer.userId, 'labels', null, ids);
  }

  if (to) {
    // A person moving work forward is project activity (keeps health honest); finished work goes in the feed.
    const { recordActivity, touchProject } = await import('@/lib/activity');
    if (to === 'done') {
      await recordActivity({ projectId: project.id, ticketId: t.id, actorUserId: viewer.userId, kind: 'ticket_done', source: 'app',
        summary: `${viewer.name} finished ${t.key}: ${t.title}`, url: ticketLink(project.id, t.key) });
    } else await touchProject(project.id);
    const link = ticketLink(project.id, t.key);
    await notify(await watcherIds(t.id), viewer.userId, 'ticket_status', `${viewer.name} moved ${t.key} to ${STATUS_LABELS[to]}`, link);
    if (to === 'done') {
      // The agent whose client asked for it hears about it even if they unwatched.
      await notify([t.created_by], viewer.userId, 'ticket_done', `${t.key} is done: ${t.title}`, link);
      await notifyUnblocked(t, viewer.userId);
      await systemMessage(project.id, `${viewer.name} finished ${t.key}: ${t.title}`, viewer.userId);
    }
  }
  return (await queryOne<TicketRow>(`SELECT ${TICKET_COLS} FROM tickets t WHERE t.id = $1`, [t.id]))!;
}

export interface HandoffNote { done: string; left: string; branch?: string | null; gotchas?: string | null }

export const HANDOFF_REQUIRED = 'Handoff note required: this ticket is in progress and someone is being taken off it';

/** Who would be assigned after this change (no writes). */
export async function plannedAssignees(ctx: TicketCtx, userIds: unknown, mode: 'replace' | 'add' | 'remove'): Promise<{ before: number[]; want: number[] }> {
  const before = await assigneeIds(ctx.ticket.id);
  const given = mode === 'remove'
    ? (Array.isArray(userIds) ? userIds.map(Number).filter(Number.isFinite) : [])
    : await projectDevIds(ctx.project.id, userIds);
  const want = mode === 'replace' ? given
    : mode === 'add' ? Array.from(new Set([...before, ...given]))
    : before.filter((id) => !given.includes(id));
  return { before, want };
}

/** Reassigning work that's under way needs a handoff note (someone in progress comes off it). */
export function handoffNeeded(status: string, before: number[], want: number[]): boolean {
  return status === 'in_progress' && before.some((id) => !want.includes(id));
}

function parseHandoff(h: unknown): HandoffNote | null {
  if (!h || typeof h !== 'object') return null;
  const o = h as Record<string, unknown>;
  const done = String(o.done ?? '').trim();
  const left = String(o.left ?? '').trim();
  if (!done || !left) return null;
  return {
    done: done.slice(0, 5000), left: left.slice(0, 5000),
    branch: o.branch ? String(o.branch).trim().slice(0, 255) : null,
    gotchas: o.gotchas ? String(o.gotchas).trim().slice(0, 5000) : null,
  };
}

/**
 * Change assignees (project developers only).
 *   replace: exactly these people · add: these plus whoever is on it · remove: drop these
 * Taking someone off an In-progress ticket requires `handoff` {done, left, branch?, gotchas?};
 * it's stored in handoff_notes and shown pinned on the ticket.
 */
export async function setAssignees(ctx: TicketCtx, userIds: unknown, mode: 'replace' | 'add' | 'remove' = 'replace', handoff?: unknown): Promise<number[]> {
  if (!capabilities(ctx).work) throw new HttpError(403, 'Only the project’s developers or HR can assign');
  const { ticket: t, viewer, project } = ctx;
  const { before, want } = await plannedAssignees(ctx, userIds, mode);
  let note: HandoffNote | null = null;
  if (handoffNeeded(t.status, before, want)) {
    note = parseHandoff(handoff);
    if (!note) throw new HttpError(400, HANDOFF_REQUIRED + ' — say what is done and what is left.');
  }
  const added = want.filter((id) => !before.includes(id));
  await query(`DELETE FROM ticket_assignees WHERE ticket_id = $1 AND NOT (user_id = ANY($2::bigint[]))`, [t.id, want]);
  if (added.length) {
    await query(`INSERT INTO ticket_assignees (ticket_id, user_id, assigned_by) SELECT $1, u, $3 FROM unnest($2::bigint[]) u ON CONFLICT DO NOTHING`,
      [t.id, added, viewer.userId]);
    await watch(t.id, added, 'assignee');
    await notify(added, viewer.userId, 'ticket_assigned',
      `${viewer.name} assigned you ${t.key}: ${t.title}${note ? ' — read the handoff note on the ticket' : ''}`, ticketLink(project.id, t.key));
  }
  if (note) {
    await query(
      `INSERT INTO handoff_notes (ticket_id, from_user_ids, to_user_ids, done, left_todo, branch, gotchas, created_by)
       VALUES ($1, $2::bigint[], $3::bigint[], $4, $5, $6, $7, $8)`,
      [t.id, before.filter((id) => !want.includes(id)), added, note.done, note.left, note.branch, note.gotchas, viewer.userId]
    );
    await recordHistory(t.id, viewer.userId, 'handoff', null, { done: note.done.slice(0, 200), left: note.left.slice(0, 200) });
  }
  if (String([...before].sort()) !== String([...want].sort())) await recordHistory(t.id, viewer.userId, 'assignees', before, want);
  return want;
}
