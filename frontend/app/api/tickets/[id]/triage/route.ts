import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { systemMessage } from '@/lib/projects/core';
import { canTriage } from '@/lib/tickets/rules';
import { notify, recordHistory, ticketCtx, ticketLink, triageRecipients, watch } from '@/lib/tickets/core';
import { epicInProject, hoursOrNull, priorityOf, projectDevIds, str } from '@/lib/tickets/input';

export const dynamic = 'force-dynamic';

/**
 * POST /api/tickets/{id}/triage
 *   { action: 'accept', epic_id?, priority?, assignee_ids?, estimate_hours? }
 *   { action: 'merge', into_key }               duplicate → declined, comments point to the original
 *   { action: 'need_info', question }           back to the agent who opened it
 *   { action: 'info_given', note }              agent answers; ticket returns to the triage queue
 *   { action: 'decline', reason }
 *   { action: 'snooze', until }                 ISO date/time
 *   { action: 'reopen' }                        HR/triage owner: declined → triage
 */
export const POST = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const { ticket: t, actor, viewer, project } = await ticketCtx(request, Number(params.id));
  const b = await readJson(request);
  const action = String(b.action || '');
  const link = ticketLink(project.id, t.key);
  const log = (note: string | null) =>
    query(`INSERT INTO triage_events (ticket_id, user_id, action, note) VALUES ($1, $2, $3, $4)`, [t.id, viewer.userId, action, note]);

  // The agent who opened it may answer a "need info" question; everything else is the triager's.
  if (action === 'info_given') {
    if (t.status !== 'triage' || t.triage_state !== 'need_info') throw new HttpError(400, 'This ticket isn’t waiting for information');
    if (!(t.created_by === viewer.userId || canTriage(actor))) throw new HttpError(403, 'Only the person who opened it can answer');
    const note = str(b.note, 'Answer', 5000, true)!;
    await query(`UPDATE tickets SET triage_state = NULL, updated_at = NOW() WHERE id = $1`, [t.id]);
    await query(`INSERT INTO ticket_comments (ticket_id, user_id, body) VALUES ($1, $2, $3)`, [t.id, viewer.userId, note]);
    await log(note);
    await notify(await triageRecipients(project), viewer.userId, 'triage_info', `${viewer.name} answered on ${t.key}`, link);
    return ok({ status: 'triage' });
  }

  if (!canTriage(actor)) throw new HttpError(403, 'Only the triage owner, a lead developer or HR can triage');
  if (action === 'reopen') {
    if (t.status !== 'declined') throw new HttpError(400, 'Only declined tickets can be reopened');
    await query(`UPDATE tickets SET status = 'triage', triage_state = NULL, decline_reason = NULL, duplicate_of = NULL, updated_at = NOW() WHERE id = $1`, [t.id]);
    await log(null);
    await recordHistory(t.id, viewer.userId, 'status', 'declined', 'triage');
    return ok({ status: 'triage' });
  }
  if (t.status !== 'triage') throw new HttpError(400, 'This ticket is not in Triage');

  switch (action) {
    case 'accept': {
      const epic = await epicInProject(b.epic_id, project.id);
      const priority = b.priority !== undefined ? priorityOf(b.priority) : t.priority;
      const assignees = b.assignee_ids !== undefined ? await projectDevIds(project.id, b.assignee_ids) : [];
      const est = hoursOrNull(b.estimate_hours);
      await query(
        `UPDATE tickets SET status = 'open', triage_state = NULL, snoozed_until = NULL, accepted_by = $2, accepted_at = NOW(),
                priority = $3, epic_id = COALESCE($4, epic_id), estimate_hours = COALESCE($5, estimate_hours), updated_at = NOW()
          WHERE id = $1`,
        [t.id, viewer.userId, priority, epic ?? null, est ?? null]
      );
      if (assignees.length) {
        await query(`INSERT INTO ticket_assignees (ticket_id, user_id, assigned_by) SELECT $1, u, $3 FROM unnest($2::bigint[]) u ON CONFLICT DO NOTHING`,
          [t.id, assignees, viewer.userId]);
        await watch(t.id, assignees, 'assignee');
        await notify(assignees, viewer.userId, 'ticket_assigned', `${viewer.name} assigned you ${t.key}: ${t.title}`, link);
      }
      await log(null);
      await recordHistory(t.id, viewer.userId, 'status', 'triage', 'open');
      await notify([t.created_by], viewer.userId, 'triage_accepted', `${t.key} was accepted: ${t.title}`, link);
      return ok({ status: 'open' });
    }
    case 'merge': {
      const target = await queryOne<{ id: number; key: string }>(
        `SELECT id, key FROM tickets WHERE key = $1 AND project_id = $2 AND deleted_at IS NULL AND id <> $3`,
        [String(b.into_key || '').trim().toUpperCase(), project.id, t.id]
      );
      if (!target) throw new HttpError(400, 'Pick another ticket in this project to merge into');
      await query(`UPDATE tickets SET status = 'declined', duplicate_of = $2, decline_reason = $3, triage_state = NULL, updated_at = NOW() WHERE id = $1`,
        [t.id, target.id, `Duplicate of ${target.key}`]);
      await query(`INSERT INTO ticket_relations (from_ticket_id, to_ticket_id, kind, created_by) VALUES ($1, $2, 'duplicate_of', $3) ON CONFLICT DO NOTHING`,
        [t.id, target.id, viewer.userId]);
      // The requester keeps following the work through the original ticket.
      await watch(target.id, [t.created_by], 'manual');
      await log(target.key);
      await recordHistory(t.id, viewer.userId, 'status', 'triage', 'declined');
      await notify([t.created_by], viewer.userId, 'triage_merged', `${t.key} was merged into ${target.key}`, ticketLink(project.id, target.key));
      return ok({ status: 'declined', duplicate_of: target.key });
    }
    case 'need_info': {
      const question = str(b.question, 'Question', 5000, true)!;
      await query(`UPDATE tickets SET triage_state = 'need_info', updated_at = NOW() WHERE id = $1`, [t.id]);
      await query(`INSERT INTO ticket_comments (ticket_id, user_id, body) VALUES ($1, $2, $3)`, [t.id, viewer.userId, `**Need more info:** ${question}`]);
      await log(question);
      await notify([t.created_by], viewer.userId, 'triage_need_info', `${viewer.name} needs more info on ${t.key}: ${question}`, link);
      return ok({ status: 'triage', triage_state: 'need_info' });
    }
    case 'decline': {
      const reason = str(b.reason, 'Reason', 2000, true)!;
      await query(`UPDATE tickets SET status = 'declined', decline_reason = $2, triage_state = NULL, updated_at = NOW() WHERE id = $1`, [t.id, reason]);
      await log(reason);
      await recordHistory(t.id, viewer.userId, 'status', 'triage', 'declined');
      await notify([t.created_by], viewer.userId, 'triage_declined', `${t.key} was declined: ${reason}`, link);
      await systemMessage(project.id, `${viewer.name} declined ${t.key}: ${reason}`, viewer.userId);
      return ok({ status: 'declined' });
    }
    case 'snooze': {
      const until = new Date(String(b.until || ''));
      if (Number.isNaN(until.getTime()) || until.getTime() <= Date.now()) throw new HttpError(400, 'Pick a time in the future');
      await query(`UPDATE tickets SET triage_state = 'snoozed', snoozed_until = $2, updated_at = NOW() WHERE id = $1`, [t.id, until]);
      await log(until.toISOString());
      return ok({ status: 'triage', triage_state: 'snoozed', snoozed_until: until });
    }
    default:
      throw new HttpError(400, 'Unknown triage action');
  }
});
