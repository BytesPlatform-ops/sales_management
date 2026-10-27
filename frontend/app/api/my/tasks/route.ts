import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { handler, ok } from '@/lib/training/http';
import { getViewer, visibilityClause } from '@/lib/projects/core';
import { CARD_SQL } from '@/lib/tickets/cards';

export const dynamic = 'force-dynamic';

/**
 * GET /api/my/tasks — open tickets across every project the viewer can see:
 *   developers/HR: assigned to me; agents: tickets I opened.
 * Grouping (overdue / today / this week / later) happens in the browser.
 */
export const GET = handler(async (request: NextRequest) => {
  const v = await getViewer(request);
  const mine = v.role === 'agent'
    ? 't.created_by = $1'
    : 'EXISTS (SELECT 1 FROM ticket_assignees a WHERE a.ticket_id = t.id AND a.user_id = $1)';
  const rows = await query(
    `SELECT c.*, p.ticket_no AS project_ticket_no, p.title AS project_title, p.client_name
       FROM (${CARD_SQL} WHERE t.deleted_at IS NULL AND t.status NOT IN ('done','closed','declined') AND ${mine}) c
       JOIN projects p ON p.id = c.project_id
      WHERE ${visibilityClause(v)}
      ORDER BY c.due_date NULLS LAST, CASE c.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, c.id
      LIMIT 500`,
    [v.userId]
  );
  return ok(rows);
});
