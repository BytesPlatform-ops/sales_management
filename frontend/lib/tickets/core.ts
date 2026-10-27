/**
 * Tickets: database helpers shared by the /api/tickets and /api/projects/[id]/tickets
 * routes. Permission rules live in ./rules (pure, tested); this file loads the
 * facts they need and records what happened (history, notifications, thread).
 */
import { NextRequest } from 'next/server';
import { pool, query, queryOne } from '@/lib/db';
import { HttpError } from '@/lib/training/http';
import { notify as sendNotification } from '@/lib/notifications';
import { getViewer, loadProject, normalizeProject, ProjectAccess, ProjectRow, Viewer } from '@/lib/projects/core';
import { activeGrant, autoPickableSql, levelAtLeast } from '@/lib/access/grants';
import {
  canCommentTicket, canEditTicket, canTriage, canWorkTicket, DEFAULT_SLA_HOURS, FINISHED, Priority, rankBetween, TicketActor, TicketStatus, ticketKey, triageDueAt,
} from './rules';

export interface TicketRow {
  id: number; project_id: number; number: number; key: string; epic_id: number | null; parent_id: number | null;
  type: string; title: string; description: string; priority: Priority; status: TicketStatus;
  triage_state: string | null; triage_due_at: string | null; snoozed_until: string | null; decline_reason: string | null;
  duplicate_of: number | null; accepted_by: number | null; accepted_at: string | null;
  cr_status: string | null; cr_decided_by: number | null; cr_decided_at: string | null; cr_new_deadline: string | null;
  estimate_hours: string | null; start_date: string | null; due_date: string | null; rank: string;
  created_by: number; created_via: string; done_at: string | null; closed_at: string | null;
  archived_at: string | null; deleted_at: string | null; created_at: string; updated_at: string;
}

/** Columns safe to send to the browser (never the tsvector). */
export const TICKET_COLS = `t.id, t.project_id, t.number, t.key, t.epic_id, t.parent_id, t.type, t.title, t.description, t.priority,
  t.status, t.triage_state, t.triage_due_at, t.snoozed_until, t.decline_reason, t.duplicate_of, t.accepted_by, t.accepted_at,
  t.cr_status, t.cr_decided_by, t.cr_decided_at, t.cr_new_deadline::text AS cr_new_deadline, t.estimate_hours,
  t.start_date::text AS start_date, t.due_date::text AS due_date, t.rank, t.created_by, t.created_via, t.done_at, t.closed_at,
  t.archived_at, t.created_at, t.updated_at`;

export interface ProjectCtx { viewer: Viewer; project: ProjectRow & { triage_owner_id?: number | null; access?: ProjectAccess }; actor: TicketActor }

/** Viewer + a project they can see + their role on it. */
export async function projectCtx(request: NextRequest, projectId: number): Promise<ProjectCtx> {
  const viewer = await getViewer(request);
  const project = await loadProject(projectId, viewer) as ProjectCtx['project'];
  return { viewer, project, actor: await actorFor(viewer, project) };
}

export async function actorFor(viewer: Viewer, project: ProjectCtx['project']): Promise<TicketActor> {
  const m = await queryOne<{ member_role: string }>(
    `SELECT member_role FROM project_members WHERE project_id = $1 AND user_id = $2`, [project.id, viewer.userId]
  );
  return {
    role: viewer.role, userId: viewer.userId, memberRole: m?.member_role ?? null,
    projectCreatedBy: Number(project.created_by),
    triageOwnerId: await effectiveTriageOwner(project),
    // Reaching the project only through a grant (help request): limited by its level.
    grantLevel: project.access?.via === 'grant' ? project.access.grant?.level ?? 'view' : null,
  };
}

export interface TicketCtx extends ProjectCtx { ticket: TicketRow }

/** Load a ticket the viewer may see (via its project). Deleted tickets are 404. */
export async function ticketCtx(request: NextRequest, ticketId: number): Promise<TicketCtx> {
  if (!Number.isFinite(ticketId)) throw new HttpError(400, 'Invalid ticket id');
  return ticketCtxFor(await getViewer(request), ticketId);
}

/** Same as ticketCtx for an already-verified viewer (bulk edits load many tickets). */
export async function ticketCtxFor(viewer: Viewer, ticketId: number): Promise<TicketCtx> {
  const ticket = await queryOne<TicketRow>(`SELECT ${TICKET_COLS} FROM tickets t WHERE t.id = $1 AND t.deleted_at IS NULL`, [ticketId]);
  if (!ticket) throw new HttpError(404, 'Ticket not found');
  let project: ProjectCtx['project'];
  // Ticket routes check capabilities themselves, so grant-only access may reach
  // write handlers here (comment/edit levels); capabilities() limits what it can do.
  const ticketGrant = await activeGrant(viewer.userId, 'ticket', ticket.id);
  try {
    project = await loadProject(ticket.project_id, viewer, { grantWrite: 'view' }) as ProjectCtx['project'];
  } catch {
    // A ticket shared on its own opens that ticket only — never the rest of the project.
    if (!ticketGrant) throw new HttpError(404, 'Ticket not found');
    const raw = await queryOne<ProjectRow>(`SELECT * FROM projects WHERE id = $1`, [ticket.project_id]);
    if (!raw) throw new HttpError(404, 'Ticket not found');
    project = { ...normalizeProject(raw), access: { via: 'grant', grant: { id: ticketGrant.id, level: ticketGrant.level, scope: ticketGrant.scope, expires_at: ticketGrant.expires_at, source: ticketGrant.source } } };
  }
  ticket.created_by = Number(ticket.created_by);
  const actor = await actorFor(viewer, project);
  // A ticket grant can raise (never lower) what a project grant allows on this ticket.
  if (actor.grantLevel && ticketGrant && !levelAtLeast(actor.grantLevel, ticketGrant.level)) actor.grantLevel = ticketGrant.level;
  return { viewer, project, actor, ticket };
}

export function capabilities(ctx: TicketCtx) {
  const { actor, ticket } = ctx;
  return {
    edit: canEditTicket(actor, ticket),
    work: canWorkTicket(actor),
    triage: canTriage(actor) && ticket.status === 'triage',
    decide_cr: actor.role === 'hr' && ticket.type === 'change_request' && ticket.cr_status === 'pending',
    delete: actor.role === 'hr',
    comment: canCommentTicket(actor),
  };
}

// ------------------------------------------------------------------ create

export async function slaHours(): Promise<Partial<Record<Priority, number>>> {
  try {
    const rows = await query<{ priority: Priority; triage_hours: number }>(`SELECT priority, triage_hours FROM sla_policies`);
    return Object.fromEntries(rows.map((r) => [r.priority, r.triage_hours]));
  } catch {
    return DEFAULT_SLA_HOURS;
  }
}

export interface NewTicket {
  title: string; description?: string; type: string; priority: Priority; status: TicketStatus;
  epic_id?: number | null; parent_id?: number | null; estimate_hours?: number | null;
  start_date?: string | null; due_date?: string | null; created_via?: string;
}

/**
 * Insert a ticket with the project's next number. The counter bump and insert share
 * one transaction, so two people creating at once never get the same key.
 */
export async function insertTicket(project: { id: number; ticket_no: string }, userId: number, t: NewTicket): Promise<TicketRow> {
  // Everything that needs the pool happens before or after the transaction: a
  // transaction that holds one connection and waits for another deadlocks the
  // pool when many tickets are created at once.
  const due = t.status === 'triage' ? triageDueAt(new Date(), t.priority, await slaHours()) : null;
  const client = await pool.connect();
  let id: number;
  try {
    await client.query('BEGIN');
    const { rows: [c] } = await client.query(
      `UPDATE projects SET next_ticket_no = next_ticket_no + 1 WHERE id = $1 RETURNING next_ticket_no - 1 AS n`, [project.id]
    );
    const n = Number(c.n);
    // The counter row lock serialises creators per project, so "last rank" is stable here.
    const { rows: [last] } = await client.query(
      `SELECT rank FROM tickets WHERE project_id = $1 AND deleted_at IS NULL ORDER BY rank DESC LIMIT 1`, [project.id]
    );
    const rank = rankBetween(last?.rank ?? null, null);
    const { rows: [row] } = await client.query(
      `INSERT INTO tickets (project_id, number, key, epic_id, parent_id, type, title, description, priority, status,
                            triage_due_at, estimate_hours, start_date, due_date, rank, created_by, created_via)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING id`,
      [project.id, n, ticketKey(project.ticket_no, n), t.epic_id ?? null, t.parent_id ?? null, t.type, t.title, t.description ?? '',
        t.priority, t.status, due, t.estimate_hours ?? null, t.start_date ?? null, t.due_date ?? null, rank, userId, t.created_via ?? 'manual']
    );
    id = row.id;
    await client.query(
      `INSERT INTO ticket_watchers (ticket_id, user_id, reason) VALUES ($1, $2, 'creator') ON CONFLICT DO NOTHING`, [id, userId]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return (await queryOne<TicketRow>(`SELECT ${TICKET_COLS} FROM tickets t WHERE t.id = $1`, [id]))!;
}

// ------------------------------------------------------------------ history, watchers, notifications

export async function recordHistory(ticketId: number, userId: number | null, field: string, oldValue: unknown, newValue: unknown) {
  await query(
    `INSERT INTO ticket_history (ticket_id, user_id, field, old_value, new_value) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
    [ticketId, userId, field, JSON.stringify(oldValue ?? null), JSON.stringify(newValue ?? null)]
  );
}

export async function watch(ticketId: number, userIds: number[], reason: string) {
  if (!userIds.length) return;
  await query(
    `INSERT INTO ticket_watchers (ticket_id, user_id, reason) SELECT $1, u, $3 FROM unnest($2::bigint[]) u ON CONFLICT DO NOTHING`,
    [ticketId, userIds, reason]
  );
}

/** Ticket notifications go through the shared inbox (lib/notifications): prefs, email, de-dupe. */
export async function notify(userIds: Iterable<number>, actorId: number | null, type: string, body: string, link: string) {
  const key = /\/tickets\/(PRJ-[\w-]+)$/.exec(link)?.[1];
  await sendNotification({ users: userIds, actorId, type, body, link, entity: key ? { type: 'ticket', id: key } : null });
}

export async function watcherIds(ticketId: number): Promise<number[]> {
  return (await query<{ user_id: string }>(`SELECT user_id FROM ticket_watchers WHERE ticket_id = $1`, [ticketId])).map((r) => Number(r.user_id));
}

export async function assigneeIds(ticketId: number): Promise<number[]> {
  return (await query<{ user_id: string }>(`SELECT user_id FROM ticket_assignees WHERE ticket_id = $1`, [ticketId])).map((r) => Number(r.user_id));
}

/** Who triages a project: its triage owner, else its lead developer(s), else the HR supervisor. */
/** Week number used for the weekly triage rotation (weeks since 1970-01-05, a Monday, in PKT). */
export function rotationWeek(now = new Date()): number {
  const pkt = now.getTime() + 5 * 3600_000;
  return Math.floor((pkt - Date.UTC(1970, 0, 5)) / (7 * 86_400_000));
}

/**
 * Who triages this week: with triage_rotation on, the project's lead and developers
 * take turns weekly (skipping anyone out of office and guests); otherwise the fixed
 * triage owner (or null → leads/HR, see triageRecipients).
 */
export async function effectiveTriageOwner(project: { id: number; triage_owner_id?: number | null; triage_rotation?: boolean }): Promise<number | null> {
  if ((project as any).triage_rotation) {
    const rows = await query<{ id: string }>(
      `SELECT u.id FROM project_members m JOIN users u ON u.id = m.user_id
        WHERE m.project_id = $1 AND m.member_role IN ('developer', 'lead_developer') AND u.role = 'developer'
          AND COALESCE(u.is_active, true) AND ${autoPickableSql('u')}
        ORDER BY u.id`, [project.id]
    ).catch(() => []);
    if (rows.length) return Number(rows[rotationWeek() % rows.length].id);
  }
  return project.triage_owner_id != null ? Number(project.triage_owner_id) : null;
}

export async function triageRecipients(project: ProjectCtx['project']): Promise<number[]> {
  const owner = await effectiveTriageOwner(project);
  if (owner) return [owner];
  const leads = await query<{ user_id: string }>(
    `SELECT user_id FROM project_members WHERE project_id = $1 AND member_role = 'lead_developer'`, [project.id]
  );
  if (leads.length) return leads.map((l) => Number(l.user_id));
  return project.supervisor_id ? [Number(project.supervisor_id)] : [];
}

export const ticketLink = (projectId: number, key: string) => `/projects/${projectId}/tickets/${key}`;

// ------------------------------------------------------------------ relations

/** Open tickets that block this one. */
export async function openBlockers(ticketId: number) {
  return query<{ id: number; key: string; title: string; status: string }>(
    `SELECT b.id, b.key, b.title, b.status FROM ticket_relations r JOIN tickets b ON b.id = r.from_ticket_id
      WHERE r.to_ticket_id = $1 AND r.kind = 'blocks' AND b.deleted_at IS NULL AND b.status <> ALL($2::text[])`,
    [ticketId, FINISHED]
  );
}

/** Would "from blocks to" close a loop? True if `to` already (transitively) blocks `from`. */
export async function wouldCreateBlockCycle(fromId: number, toId: number): Promise<boolean> {
  if (fromId === toId) return true;
  const r = await queryOne(
    `WITH RECURSIVE chain(id) AS (
       SELECT to_ticket_id FROM ticket_relations WHERE from_ticket_id = $1 AND kind = 'blocks'
       UNION
       SELECT r.to_ticket_id FROM ticket_relations r JOIN chain c ON r.from_ticket_id = c.id WHERE r.kind = 'blocks'
     ) SELECT 1 AS hit FROM chain WHERE id = $2 LIMIT 1`,
    [toId, fromId]
  );
  return !!r;
}

/** When a ticket finishes, tell the assignees of tickets it was blocking. */
export async function notifyUnblocked(ticket: TicketRow, actorId: number) {
  const blocked = await query<{ id: number; key: string; project_id: number }>(
    `SELECT t.id, t.key, t.project_id FROM ticket_relations r JOIN tickets t ON t.id = r.to_ticket_id
      WHERE r.from_ticket_id = $1 AND r.kind = 'blocks' AND t.deleted_at IS NULL`, [ticket.id]
  );
  for (const b of blocked) {
    await notify(await assigneeIds(b.id), actorId, 'ticket_unblocked',
      `${ticket.key} is done — ${b.key} is no longer blocked by it.`, ticketLink(b.project_id, b.key));
  }
}
