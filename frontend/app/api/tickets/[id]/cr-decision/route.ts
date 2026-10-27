import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { fmtDay, systemMessage } from '@/lib/projects/core';
import { notify, recordHistory, ticketCtx, ticketLink, watcherIds } from '@/lib/tickets/core';
import { dateOrNull } from '@/lib/tickets/input';

export const dynamic = 'force-dynamic';

/**
 * POST /api/tickets/{id}/cr-decision { decision: 'approved' | 'rejected', new_deadline?: 'YYYY-MM-DD', note? }
 * HR approves a change request before work starts; approval may push the project deadline.
 */
export const POST = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const { ticket: t, viewer, project } = await ticketCtx(request, Number(params.id));
  if (viewer.role !== 'hr') throw new HttpError(403, 'Only HR can approve change requests');
  if (t.type !== 'change_request') throw new HttpError(400, 'This ticket is not a change request');
  if (t.cr_status !== 'pending') throw new HttpError(400, 'This change request was already decided');
  const b = await readJson(request);
  const decision = b.decision === 'approved' ? 'approved' : b.decision === 'rejected' ? 'rejected' : null;
  if (!decision) throw new HttpError(400, 'decision must be approved or rejected');
  const newDeadline = decision === 'approved' ? dateOrNull(b.new_deadline, 'New deadline') ?? null : null;

  await query(
    `UPDATE tickets SET cr_status = $2, cr_decided_by = $3, cr_decided_at = NOW(), cr_new_deadline = $4, updated_at = NOW() WHERE id = $1`,
    [t.id, decision, viewer.userId, newDeadline]
  );
  await recordHistory(t.id, viewer.userId, 'cr_status', 'pending', decision);

  let msg = `${viewer.name} ${decision} change request ${t.key}: ${t.title}`;
  if (newDeadline) {
    await query(`UPDATE projects SET deadline = $2, updated_at = NOW() WHERE id = $1`, [project.id, newDeadline]);
    msg += ` — project deadline moved to ${fmtDay(newDeadline)}`;
  }
  if (b.note) await query(`INSERT INTO ticket_comments (ticket_id, user_id, body) VALUES ($1, $2, $3)`, [t.id, viewer.userId, String(b.note).slice(0, 5000)]);
  await systemMessage(project.id, msg + '.', viewer.userId);
  await notify(new Set([t.created_by, ...(await watcherIds(t.id))]), viewer.userId, `cr_${decision}`, msg, ticketLink(project.id, t.key));
  return ok({ cr_status: decision, new_deadline: newDeadline });
});
