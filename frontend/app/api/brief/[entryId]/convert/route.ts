import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { systemMessage } from '@/lib/projects/core';
import { entryCtx } from '@/lib/brief/core';
import { canAddBrief } from '@/lib/brief/rules';
import { insertTicket, recordHistory, ticketLink, triageRecipients } from '@/lib/tickets/core';
import { notify } from '@/lib/notifications';
import { str } from '@/lib/tickets/input';

export const dynamic = 'force-dynamic';

/**
 * POST /api/brief/{entryId}/convert { title? } — turn a Change-type brief update into a
 * change request ticket in Triage (HR approval still applies before work starts).
 */
export const POST = handler(async (request: NextRequest, { params }: { params: { entryId: string } }) => {
  const ctx = await entryCtx(request, Number(params.entryId));
  const { entry: e, actor, project, viewer } = ctx;
  if (!canAddBrief(actor)) throw new HttpError(403, 'Only the client’s agent or HR can convert brief updates');
  if (e.type !== 'change') throw new HttpError(400, 'Only Change-type updates become change requests');
  const existing = await queryOne<{ key: string }>(`SELECT key FROM tickets WHERE source_brief_entry_id = $1 AND deleted_at IS NULL`, [e.id]);
  if (existing) throw new HttpError(409, `Already converted to ${existing.key}`);

  const b = await readJson(request).catch(() => ({}));
  const firstLine = e.body.split('\n').map((l) => l.replace(/^[#>*\-\s]+/, '').trim()).find(Boolean) || 'Change request from the brief';
  const title = str(b.title, 'Title', 300) || firstLine.slice(0, 300);
  const t = await insertTicket(project, viewer.userId, {
    title, description: `${e.body}\n\n_From brief update #${e.id}._`, type: 'change_request', priority: 'normal', status: 'triage', created_via: 'brief',
  });
  await query(`UPDATE tickets SET cr_status = 'pending', source_brief_entry_id = $2 WHERE id = $1`, [t.id, e.id]);
  await recordHistory(t.id, viewer.userId, 'created', null, { status: 'triage', type: 'change_request', from_brief: e.id });
  await systemMessage(project.id, `${viewer.name} turned a brief change into change request ${t.key} (in Triage): ${title}`, viewer.userId);
  const link = ticketLink(project.id, t.key);
  await notify({ users: await triageRecipients(project as any), actorId: viewer.userId, type: 'ticket_triage', body: `New change request to triage: ${t.key} ${title}`, link });
  if (project.supervisor_id) {
    await notify({ users: [Number(project.supervisor_id)], actorId: viewer.userId, type: 'cr_pending', body: `Change request waiting for approval: ${t.key} ${title}`, link });
  }
  return ok({ id: t.id, key: t.key });
});
