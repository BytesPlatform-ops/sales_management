import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { branchName } from '@/lib/tickets/rules';
import { capabilities, openBlockers, recordHistory, ticketCtx } from '@/lib/tickets/core';
import { CARD_SQL } from '@/lib/tickets/cards';
import { applyTicketPatch } from '@/lib/tickets/update';

export const dynamic = 'force-dynamic';
type Ctx = { params: { id: string } };

/** GET /api/tickets/{id} — the ticket with everything the ticket page shows. */
export const GET = handler(async (request: NextRequest, { params }: Ctx) => {
  const ctx = await ticketCtx(request, Number(params.id));
  const t = ctx.ticket;
  const [assignees, watchers, labels, checklist, subtasks, relations, blockers, people, parent, epic, devs] = await Promise.all([
    query(`SELECT a.user_id AS id, u.full_name AS name FROM ticket_assignees a JOIN users u ON u.id = a.user_id WHERE a.ticket_id = $1 ORDER BY u.full_name`, [t.id]),
    query(`SELECT w.user_id AS id, u.full_name AS name, w.reason FROM ticket_watchers w JOIN users u ON u.id = w.user_id WHERE w.ticket_id = $1 ORDER BY u.full_name`, [t.id]),
    query(`SELECT l.id, l.name, l.color FROM ticket_labels tl JOIN labels l ON l.id = tl.label_id WHERE tl.ticket_id = $1 ORDER BY l.name`, [t.id]),
    query(`SELECT id, body, done, done_at, sort_order FROM ticket_checklist_items WHERE ticket_id = $1 ORDER BY sort_order, id`, [t.id]),
    query(`${CARD_SQL} WHERE t.parent_id = $1 AND t.deleted_at IS NULL ORDER BY t.rank, t.id`, [t.id]),
    query(
      `SELECT r.id, r.kind, 'out' AS direction, o.id AS ticket_id, o.key, o.title, o.status FROM ticket_relations r JOIN tickets o ON o.id = r.to_ticket_id
        WHERE r.from_ticket_id = $1 AND o.deleted_at IS NULL
       UNION ALL
       SELECT r.id, r.kind, 'in' AS direction, o.id, o.key, o.title, o.status FROM ticket_relations r JOIN tickets o ON o.id = r.from_ticket_id
        WHERE r.to_ticket_id = $1 AND o.deleted_at IS NULL`, [t.id]),
    openBlockers(t.id),
    queryOne(`SELECT (SELECT full_name FROM users WHERE id = $1) AS created_by_name, (SELECT full_name FROM users WHERE id = $2) AS accepted_by_name,
                     (SELECT full_name FROM users WHERE id = $3) AS cr_decided_by_name`, [t.created_by, t.accepted_by, t.cr_decided_by]),
    t.parent_id ? queryOne(`SELECT id, key, title, status FROM tickets WHERE id = $1`, [t.parent_id]) : null,
    t.epic_id ? queryOne(`SELECT id, title, color FROM epics WHERE id = $1`, [t.epic_id]) : null,
    query(`SELECT m.user_id AS id, u.full_name AS name, m.member_role FROM project_members m JOIN users u ON u.id = m.user_id
            WHERE m.project_id = $1 AND m.member_role IN ('developer','lead_developer') AND u.role = 'developer' AND COALESCE(u.is_active, true)
            ORDER BY u.full_name`, [ctx.project.id]),
  ]);
  return ok({
    ticket: { ...t, ...people, branch: branchName(t.key, t.title, t.type) },
    project: { id: ctx.project.id, ticket_no: ctx.project.ticket_no, title: ctx.project.title, client_name: ctx.project.client_name },
    assignees, watchers, labels, checklist, subtasks, relations, blockers, parent, epic, project_developers: devs,
    watching: watchers.some((w: any) => Number(w.id) === ctx.viewer.userId),
    can: capabilities(ctx),
    viewer_role: ctx.viewer.role,
  });
});

/**
 * PATCH /api/tickets/{id}
 * { title?, description?, type?, priority?, epic_id?, parent_id?, start_date?, due_date?, label_ids?,   ← edit
 *   status?, confirm_blocked?, estimate_hours?, move?: { after_id?, before_id? } }                       ← work
 * Rules live in lib/tickets/update.ts (shared with bulk edit).
 */
export const PATCH = handler(async (request: NextRequest, { params }: Ctx) => {
  const ctx = await ticketCtx(request, Number(params.id));
  return ok(await applyTicketPatch(ctx, await readJson(request)));
});

/** DELETE /api/tickets/{id} — HR only; soft delete. */
export const DELETE = handler(async (request: NextRequest, { params }: Ctx) => {
  const ctx = await ticketCtx(request, Number(params.id));
  if (!capabilities(ctx).delete) throw new HttpError(403, 'Only HR can delete tickets');
  await query(`UPDATE tickets SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`, [ctx.ticket.id]);
  await recordHistory(ctx.ticket.id, ctx.viewer.userId, 'deleted', null, true);
  return ok({ deleted: ctx.ticket.id });
});
