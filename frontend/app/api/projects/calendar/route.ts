import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { handler, ok, HttpError } from '@/lib/training/http';
import { getViewer, visibilityClause } from '@/lib/projects/core';

export const dynamic = 'force-dynamic';

/**
 * GET /api/projects/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD[&project_id=][&tickets=all|mine]
 * Calendar events for visible projects: work start, deadlines, expected
 * delivery, milestones, meetings and recurring cycle deadlines.
 */
export const GET = handler(async (request: NextRequest) => {
  const v = await getViewer(request);
  const sp = new URL(request.url).searchParams;
  const from = sp.get('from') || '';
  const to = sp.get('to') || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new HttpError(400, 'from and to (YYYY-MM-DD) are required');
  const projectId = sp.get('project_id') ? Number(sp.get('project_id')) : null;
  const vis = visibilityClause(v);
  const scope = `${vis} AND p.status <> 'cancelled' ${projectId ? 'AND p.id = $4' : ''}`;
  const params: any[] = [v.userId, from, to, ...(projectId ? [projectId] : [])];
  // Optional ticket layer: ?tickets=all (every open ticket due in range) | mine (assigned to me; agents: opened by me).
  const tickets = sp.get('tickets');
  const mine = v.role === 'agent' ? 't.created_by = $1' : 'EXISTS (SELECT 1 FROM ticket_assignees a WHERE a.ticket_id = t.id AND a.user_id = $1)';
  const ticketLayer = tickets === 'all' || tickets === 'mine'
    ? `UNION ALL
       SELECT 'ticket', p.id, p.ticket_no, p.title, t.status, t.key || ' ' || t.title, t.due_date::text, NULL, t.key
       FROM tickets t JOIN projects p ON p.id = t.project_id
       WHERE ${scope} AND t.deleted_at IS NULL AND t.status NOT IN ('closed','declined') AND t.due_date BETWEEN $2 AND $3
         ${tickets === 'mine' ? `AND ${mine}` : ''}`
    : '';

  const events = await query<any>(
    `SELECT * FROM (
       SELECT 'start' AS type, p.id AS project_id, p.ticket_no, p.title AS project_title, p.status, 'Work starts' AS title, p.start_date::text AS date, NULL::timestamptz AS at, NULL::text AS extra
       FROM projects p WHERE ${scope} AND p.start_date BETWEEN $2 AND $3
       UNION ALL
       SELECT 'deadline', p.id, p.ticket_no, p.title, p.status, 'Deadline', p.deadline::text, NULL, NULL
       FROM projects p WHERE ${scope} AND p.deadline BETWEEN $2 AND $3 AND p.project_type = 'one_time'
       UNION ALL
       SELECT 'delivery', p.id, p.ticket_no, p.title, p.status, 'Expected delivery to client', p.expected_delivery::text, NULL, NULL
       FROM projects p WHERE ${scope} AND p.expected_delivery BETWEEN $2 AND $3
       UNION ALL
       SELECT 'milestone', p.id, p.ticket_no, p.title, ms.status, ms.title, ms.due_date::text, NULL, ms.start_date::text
       FROM project_milestones ms JOIN projects p ON p.id = ms.project_id WHERE ${scope} AND ms.due_date BETWEEN $2 AND $3
       UNION ALL
       SELECT 'meeting', p.id, p.ticket_no, p.title, mt.status, mt.title, ((mt.starts_at AT TIME ZONE 'Asia/Karachi')::date)::text, mt.starts_at, mt.kind
       FROM project_meetings mt JOIN projects p ON p.id = mt.project_id
       WHERE ${scope} AND mt.status <> 'cancelled' AND (mt.starts_at AT TIME ZONE 'Asia/Karachi')::date BETWEEN $2 AND $3
       UNION ALL
       SELECT 'cycle', p.id, p.ticket_no, p.title, c.status, 'Cycle ' || c.cycle_no || ' deadline', c.deadline::text, NULL, c.period_start::text
       FROM project_cycles c JOIN projects p ON p.id = c.project_id WHERE ${scope} AND c.deadline BETWEEN $2 AND $3
       ${ticketLayer}
     ) e ORDER BY date, at NULLS FIRST, type`,
    params
  );
  return ok(events);
});
