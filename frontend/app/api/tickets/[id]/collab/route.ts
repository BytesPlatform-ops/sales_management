import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { handler, ok } from '@/lib/training/http';
import { ticketCtx } from '@/lib/tickets/core';
import { isOutOfOffice } from '@/lib/access/grants';

export const dynamic = 'force-dynamic';

/**
 * GET /api/tickets/{id}/collab — handoff notes (newest first, the latest is pinned),
 * help requests, review requests, and which assignees are out of office.
 */
export const GET = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const { ticket: t, actor } = await ticketCtx(request, Number(params.id));
  const [handoffs, help, reviews, assignees] = await Promise.all([
    query(`SELECT h.id, h.done, h.left_todo, h.branch, h.gotchas, h.created_at, h.from_user_ids, h.to_user_ids, u.full_name AS created_by_name,
                  (SELECT string_agg(full_name, ', ') FROM users WHERE id = ANY(h.from_user_ids)) AS from_names,
                  (SELECT string_agg(full_name, ', ') FROM users WHERE id = ANY(h.to_user_ids)) AS to_names
             FROM handoff_notes h LEFT JOIN users u ON u.id = h.created_by WHERE h.ticket_id = $1 ORDER BY h.id DESC`, [t.id]),
    query(`SELECT h.id, h.status, h.skills, h.message, h.created_at, h.expires_at, h.accepted_at, h.requested_by, h.accepted_by,
                  ru.full_name AS requested_by_name, au.full_name AS accepted_by_name, cardinality(h.target_user_ids) AS asked
             FROM help_requests h LEFT JOIN users ru ON ru.id = h.requested_by LEFT JOIN users au ON au.id = h.accepted_by
            WHERE h.ticket_id = $1 ORDER BY h.id DESC`, [t.id]),
    query(`SELECT r.id, r.status, r.pr_url, r.checklist, r.comments, r.created_at, r.decided_at, r.requested_by, r.reviewer_id,
                  ru.full_name AS requested_by_name, vu.full_name AS reviewer_name
             FROM review_requests r LEFT JOIN users ru ON ru.id = r.requested_by LEFT JOIN users vu ON vu.id = r.reviewer_id
            WHERE r.ticket_id = $1 ORDER BY r.id DESC`, [t.id]),
    query<{ id: string; name: string }>(`SELECT a.user_id AS id, u.full_name AS name FROM ticket_assignees a JOIN users u ON u.id = a.user_id WHERE a.ticket_id = $1`, [t.id]),
  ]);
  const ooo = [];
  for (const a of assignees) {
    const o = await isOutOfOffice(Number(a.id));
    if (o) ooo.push({ id: Number(a.id), name: a.name, until: o.until, note: o.note });
  }
  return ok({ handoffs, help_requests: help, reviews, out_of_office: ooo, access: actor.grantLevel ? { via: 'grant', level: actor.grantLevel } : { via: 'own' } });
});
