import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { handler, ok } from '@/lib/training/http';
import { getViewer, visibilityClause } from '@/lib/projects/core';
import { CARD_SQL } from '@/lib/tickets/cards';

export const dynamic = 'force-dynamic';

const OPEN = `('new','in_progress','review','on_hold')`;
const FINISHED_TICKET = `('done','closed','declined')`;

/** Projects with health, last activity and the latest plain-language update. */
const PROJECT_SQL = (where: string) => `
  SELECT p.id, p.ticket_no, p.title, p.client_name, p.client_company, p.status, p.health, p.last_activity_at, p.deadline::text AS deadline,
         p.tracking_source, p.staging_url, p.ready_to_deliver_at,
         (SELECT json_build_object('summary', a.summary, 'occurred_at', a.occurred_at, 'url', a.url)
            FROM project_activity a WHERE a.project_id = p.id ORDER BY a.occurred_at DESC, a.id DESC LIMIT 1) AS latest,
         (SELECT COUNT(*) FROM tickets t WHERE t.project_id = p.id AND t.deleted_at IS NULL AND t.status NOT IN ${FINISHED_TICKET} AND t.status <> 'triage')::int AS open_tickets,
         (SELECT COUNT(*) FROM tickets t WHERE t.project_id = p.id AND t.deleted_at IS NULL AND t.due_date < CURRENT_DATE AND t.status NOT IN ${FINISHED_TICKET})::int AS overdue_tickets
    FROM projects p WHERE ${where}
   ORDER BY CASE p.health WHEN 'red' THEN 0 WHEN 'yellow' THEN 1 ELSE 2 END, p.deadline NULLS LAST, p.id`;

const MEETINGS_SQL = (where: string, from: string, to: string) => `
  SELECT mt.id, mt.project_id, p.ticket_no, p.client_name, mt.title, mt.kind, mt.starts_at, mt.duration_min, mt.location
    FROM project_meetings mt JOIN projects p ON p.id = mt.project_id
   WHERE ${where} AND mt.status = 'scheduled' AND mt.starts_at >= ${from} AND mt.starts_at < ${to}
   ORDER BY mt.starts_at LIMIT 50`;

/** Today in PKT as [start, end) timestamps. */
const PKT_TODAY_FROM = `((NOW() AT TIME ZONE 'Asia/Karachi')::date::timestamp AT TIME ZONE 'Asia/Karachi')`;
const PKT_TODAY_TO = `(((NOW() AT TIME ZONE 'Asia/Karachi')::date + 1)::timestamp AT TIME ZONE 'Asia/Karachi')`;

/**
 * GET /api/overview — the role home for project work (polled every 30s).
 *   developer: my tasks (overdue first), my projects (health, last activity), today's meetings
 *   agent:     my clients' projects (status, health, latest update), tickets I opened, upcoming meetings
 *   hr / CEO:  every project by health, CRs waiting, ready to deliver, developer workload
 */
export const GET = handler(async (request: NextRequest) => {
  const v = await getViewer(request);
  const vis = visibilityClause(v, 'p');

  if (v.role === 'developer') {
    const [tasks, projects, meetings] = await Promise.all([
      query(
        `SELECT c.*, p.ticket_no AS project_ticket_no, p.client_name FROM (${CARD_SQL}
           WHERE t.deleted_at IS NULL AND t.status NOT IN ${FINISHED_TICKET}
             AND EXISTS (SELECT 1 FROM ticket_assignees a WHERE a.ticket_id = t.id AND a.user_id = $1)) c
           JOIN projects p ON p.id = c.project_id
          WHERE ${vis}
          ORDER BY (c.due_date < CURRENT_DATE::text) DESC NULLS LAST, c.due_date NULLS LAST,
                   CASE c.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END LIMIT 100`, [v.userId]),
      query(PROJECT_SQL(`${vis} AND p.status IN ${OPEN} AND EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = $1)`), [v.userId]),
      query(MEETINGS_SQL(vis, PKT_TODAY_FROM, PKT_TODAY_TO), [v.userId]),
    ]);
    return ok({ role: 'developer', tasks, projects, meetings });
  }

  if (v.role === 'agent') {
    const [projects, tickets, meetings] = await Promise.all([
      query(PROJECT_SQL(`p.created_by = $1 AND p.status IN ${OPEN}`), [v.userId]),
      query(
        `SELECT c.*, p.ticket_no AS project_ticket_no, p.client_name FROM (${CARD_SQL}
           WHERE t.deleted_at IS NULL AND t.created_by = $1 AND t.status NOT IN ${FINISHED_TICKET}) c
           JOIN projects p ON p.id = c.project_id WHERE ${vis}
          ORDER BY c.updated_at DESC LIMIT 100`, [v.userId]),
      query(MEETINGS_SQL(`p.created_by = $1`, 'NOW()', `NOW() + INTERVAL '7 days'`), [v.userId]),
    ]);
    return ok({ role: 'agent', projects, tickets, meetings });
  }

  // HR (and a CEO, who sees HR's view)
  const [projects, crs, ready, workload] = await Promise.all([
    query(PROJECT_SQL(`p.status IN ${OPEN} AND $1::bigint IS NOT NULL`), [v.userId]),
    query(
      `SELECT t.id, t.key, t.title, t.project_id, p.ticket_no, p.client_name, t.created_at, u.full_name AS created_by_name
         FROM tickets t JOIN projects p ON p.id = t.project_id LEFT JOIN users u ON u.id = t.created_by
        WHERE t.type = 'change_request' AND t.cr_status = 'pending' AND t.deleted_at IS NULL AND t.status <> 'declined'
        ORDER BY t.created_at LIMIT 100`),
    query(PROJECT_SQL(`p.ready_to_deliver_at IS NOT NULL AND p.status IN ('in_progress','review','on_hold','new')`), []),
    query(
      `SELECT u.id, u.full_name AS name,
              COUNT(t.id) FILTER (WHERE t.id IS NOT NULL)::int AS open_tickets,
              COUNT(t.id) FILTER (WHERE t.due_date < CURRENT_DATE)::int AS overdue,
              COALESCE(SUM(t.estimate_hours), 0)::float AS estimate_hours,
              dp.weekly_capacity_hours,
              EXISTS (SELECT 1 FROM user_availability a WHERE a.user_id = u.id
                       AND (NOW() AT TIME ZONE 'Asia/Karachi')::date BETWEEN a.starts_on AND a.ends_on) AS out_of_office
         FROM users u
         LEFT JOIN developer_profiles dp ON dp.user_id = u.id
         LEFT JOIN ticket_assignees ta ON ta.user_id = u.id
         LEFT JOIN tickets t ON t.id = ta.ticket_id AND t.deleted_at IS NULL AND t.status NOT IN ${FINISHED_TICKET} AND t.status <> 'triage'
        WHERE u.role = 'developer' AND COALESCE(u.is_active, true)
        GROUP BY u.id, u.full_name, dp.weekly_capacity_hours
        ORDER BY open_tickets DESC, u.full_name`),
  ]);
  return ok({ role: 'hr', projects, change_requests: crs, ready_to_deliver: ready, workload });
});
