import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { systemMessage } from '@/lib/projects/core';
import { canCreateTicket, initialStatus, isStatus, statusMoveError, STATUS_LABELS, TYPE_LABELS, TicketType, FINISHED, WORK_STATUSES } from '@/lib/tickets/rules';
import { insertTicket, notify, projectCtx, recordHistory, ticketLink, triageRecipients, watch } from '@/lib/tickets/core';
import { CARD_SQL } from '@/lib/tickets/cards';
import { dateOrNull, epicInProject, hoursOrNull, parentInProject, priorityOf, projectDevIds, str, typeOf } from '@/lib/tickets/input';

export const dynamic = 'force-dynamic';

/**
 * GET /api/projects/{id}/tickets
 *   ?view=work (default: accepted, not closed) | triage | closed | backlog | all
 *   &created_by=me|<id> &blocked=1 &no_estimate=1 &due_from=&due_to= (YYYY-MM-DD)
 *   &assignee=me|<id> &type= &priority= &label=<id> &epic=<id>|none &due=overdue|week &q=<search> &top=1 (no subtasks)
 */
export const GET = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const { viewer, project } = await projectCtx(request, Number(params.id));
  const sp = new URL(request.url).searchParams;
  const where = ['t.project_id = $1', 't.deleted_at IS NULL'];
  const args: any[] = [project.id];
  const add = (sql: string, v: unknown) => { args.push(v); where.push(sql.replaceAll('?', `$${args.length}`)); };

  const view = sp.get('view') || 'work';
  if (view === 'work') where.push(`t.status NOT IN ('triage','declined','closed')`, 't.archived_at IS NULL');
  else if (view === 'triage') where.push(`t.status = 'triage'`);
  else if (view === 'closed') where.push(`t.status IN ('closed','declined')`);
  // Backlog: accepted, not finished, top-level, in rank order.
  else if (view === 'backlog') where.push(`t.status IN ('open','in_progress','in_review','in_qa')`, 't.parent_id IS NULL', 't.archived_at IS NULL');

  const assignee = sp.get('assignee');
  if (assignee) add('EXISTS (SELECT 1 FROM ticket_assignees a WHERE a.ticket_id = t.id AND a.user_id = ?)', assignee === 'me' ? viewer.userId : Number(assignee));
  if (sp.get('type')) add('t.type = ?', sp.get('type'));
  if (sp.get('priority')) add('t.priority = ?', sp.get('priority'));
  if (sp.get('label')) add('EXISTS (SELECT 1 FROM ticket_labels tl WHERE tl.ticket_id = t.id AND tl.label_id = ?)', Number(sp.get('label')));
  const epic = sp.get('epic');
  if (epic === 'none') where.push('t.epic_id IS NULL');
  else if (epic) add('t.epic_id = ?', Number(epic));
  if (sp.get('due') === 'overdue') where.push(`t.due_date < CURRENT_DATE AND t.status NOT IN ('done','closed','declined')`);
  if (sp.get('due') === 'week') where.push(`t.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7`);
  if (sp.get('top') === '1') where.push('t.parent_id IS NULL');
  if (sp.get('created_by')) add('t.created_by = ?', sp.get('created_by') === 'me' ? viewer.userId : Number(sp.get('created_by')));
  if (sp.get('blocked') === '1') {
    where.push(`EXISTS (SELECT 1 FROM ticket_relations r JOIN tickets b ON b.id = r.from_ticket_id
                 WHERE r.to_ticket_id = t.id AND r.kind = 'blocks' AND b.deleted_at IS NULL AND b.status NOT IN ('done','closed','declined'))`);
  }
  if (sp.get('no_estimate') === '1') where.push('t.estimate_hours IS NULL');
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  if (ymd.test(sp.get('due_from') || '')) add('t.due_date >= ?::date', sp.get('due_from'));
  if (ymd.test(sp.get('due_to') || '')) add('t.due_date <= ?::date', sp.get('due_to'));
  const q = (sp.get('q') || '').trim();
  if (q) {
    if (/^PRJ-\d+-T\d+$/i.test(q)) add('t.key = ?', q.toUpperCase());
    else add(`(t.search @@ websearch_to_tsquery('english', ?) OR t.title ILIKE '%' || ? || '%')`, q.slice(0, 200));
  }

  const rows = await query(`${CARD_SQL} WHERE ${where.join(' AND ')} ORDER BY t.rank, t.id LIMIT 1000`, args);
  return ok(rows);
});

/**
 * POST /api/projects/{id}/tickets
 * { title, description?, type?, priority?, epic_id?, parent_id?, due_date?, start_date?, estimate_hours?,
 *   assignee_ids?, label_ids?, checklist?: string[], template_id? }
 * Agent tickets land in Triage; developer/HR tickets start Open.
 */
export const POST = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const { viewer, project, actor } = await projectCtx(request, Number(params.id));
  if (!canCreateTicket(actor)) throw new HttpError(403, 'You can’t create tickets on this project');
  const b = await readJson(request);

  let tpl: { title_prefix: string; description: string; checklist: string[]; type: string } | null = null;
  if (b.template_id) {
    tpl = await queryOne(`SELECT title_prefix, description, checklist, type FROM ticket_templates WHERE id = $1 AND (project_id IS NULL OR project_id = $2)`,
      [Number(b.template_id), project.id]);
    if (!tpl) throw new HttpError(400, 'Template not found');
  }

  const type = typeOf(b.type, tpl?.type || 'task') as TicketType;
  const priority = priorityOf(b.priority, 'normal');
  let status = initialStatus(actor, b.created_via);
  // Quick-add on a board column: developers/HR may create straight into that column.
  if (b.status !== undefined && b.status !== status && status === 'open') {
    if (!isStatus(b.status) || !WORK_STATUSES.includes(b.status)) throw new HttpError(400, 'Unknown status');
    const err = statusMoveError(actor, { status: 'open', type, cr_status: type === 'change_request' ? 'pending' : null }, b.status);
    if (err) throw new HttpError(400, err);
    status = b.status;
  }
  // Agents can't pre-assign; triage decides.
  const assigneeIds = actor.role === 'agent' || b.assignee_ids === undefined ? [] : await projectDevIds(project.id, b.assignee_ids);

  const t = await insertTicket(project, viewer.userId, {
    title: str(b.title, 'Title', 300, true)!,
    description: str(b.description, 'Description', 50_000) ?? tpl?.description ?? '',
    type, priority, status,
    epic_id: await epicInProject(b.epic_id, project.id),
    parent_id: await parentInProject(b.parent_id, project.id),
    estimate_hours: actor.role === 'agent' ? null : hoursOrNull(b.estimate_hours),
    start_date: dateOrNull(b.start_date, 'Start date'),
    due_date: dateOrNull(b.due_date, 'Due date'),
    created_via: ['manual', 'brief', 'meeting', 'template', 'client_link', 'import'].includes(b.created_via) ? b.created_via : (tpl ? 'template' : 'manual'),
  });

  if (type === 'change_request') await query(`UPDATE tickets SET cr_status = 'pending' WHERE id = $1`, [t.id]);
  if (status === 'done') await query(`UPDATE tickets SET done_at = NOW() WHERE id = $1`, [t.id]);
  if (assigneeIds.length) {
    await query(`INSERT INTO ticket_assignees (ticket_id, user_id, assigned_by) SELECT $1, u, $3 FROM unnest($2::bigint[]) u`, [t.id, assigneeIds, viewer.userId]);
    await watch(t.id, assigneeIds, 'assignee');
    await notify(assigneeIds, viewer.userId, 'ticket_assigned', `${viewer.name} assigned you ${t.key}: ${t.title}`, ticketLink(project.id, t.key));
  }
  if (Array.isArray(b.label_ids) && b.label_ids.length) {
    await query(
      `INSERT INTO ticket_labels (ticket_id, label_id) SELECT $1, l.id FROM labels l
        WHERE l.id = ANY($2::int[]) AND (l.project_id IS NULL OR l.project_id = $3) ON CONFLICT DO NOTHING`,
      [t.id, b.label_ids.map(Number), project.id]
    );
  }
  const checklist: string[] = [...(tpl?.checklist || []), ...(Array.isArray(b.checklist) ? b.checklist : [])]
    .map((s) => String(s).trim().slice(0, 500)).filter(Boolean).slice(0, 100);
  if (checklist.length) {
    await query(
      `INSERT INTO ticket_checklist_items (ticket_id, body, sort_order) SELECT $1, body, ord FROM unnest($2::text[]) WITH ORDINALITY AS x(body, ord)`,
      [t.id, checklist]
    );
  }
  await recordHistory(t.id, viewer.userId, 'created', null, { status, type });

  const where = status === 'triage' ? ' (in Triage)' : '';
  await systemMessage(project.id, `${viewer.name} opened ${t.key}${where}: ${t.title}`, viewer.userId);
  if (status === 'triage') {
    await notify(await triageRecipients(project), viewer.userId, 'ticket_triage',
      `New ${TYPE_LABELS[type].toLowerCase()} to triage: ${t.key} ${t.title}`, ticketLink(project.id, t.key));
  }
  if (type === 'change_request' && project.supervisor_id) {
    await notify([Number(project.supervisor_id)], viewer.userId, 'cr_pending', `Change request waiting for approval: ${t.key} ${t.title}`, ticketLink(project.id, t.key));
  }
  return ok({ ...t, status_label: STATUS_LABELS[status], finished: FINISHED.includes(status) });
});
