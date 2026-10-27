import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { handler, ok } from '@/lib/training/http';
import { getViewer, loadProject } from '@/lib/projects/core';
import { ticketCtx } from '@/lib/tickets/core';

export const dynamic = 'force-dynamic';

/**
 * GET /api/projects/{id}/activity?ticket_id=&limit=  — plain-language feed, newest first.
 * With ticket_id the ticket's own access rules apply (so a ticket-only share sees its feed).
 */
export const GET = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const sp = new URL(request.url).searchParams;
  const limit = Math.min(Math.max(Number(sp.get('limit')) || 50, 1), 200);
  const ticketId = Number(sp.get('ticket_id')) || null;
  let projectId: number;
  if (ticketId) {
    const t = await ticketCtx(request, ticketId);
    projectId = t.project.id;
  } else {
    projectId = (await loadProject(Number(params.id), await getViewer(request))).id;
  }
  return ok(await query(
    `SELECT a.id, a.project_id, a.ticket_id, t.key AS ticket_key, a.actor_user_id, u.full_name AS actor_name, a.github_login,
            a.kind, a.summary, a.url, a.occurred_at, a.source
       FROM project_activity a LEFT JOIN users u ON u.id = a.actor_user_id LEFT JOIN tickets t ON t.id = a.ticket_id
      WHERE a.project_id = $1 ${ticketId ? 'AND a.ticket_id = $3' : ''}
      ORDER BY a.occurred_at DESC, a.id DESC LIMIT $2`,
    ticketId ? [projectId, limit, ticketId] : [projectId, limit]
  ));
});
