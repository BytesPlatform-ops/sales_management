import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { handler, ok, HttpError } from '@/lib/training/http';
import { getViewer } from '@/lib/projects/core';

export const dynamic = 'force-dynamic';

const COLS = `h.id, h.status, h.skills, h.message, h.created_at, h.expires_at, h.accepted_at, h.ticket_id, h.project_id,
  h.requested_by, ru.full_name AS requested_by_name, h.accepted_by, au.full_name AS accepted_by_name,
  t.key AS ticket_key, t.title AS ticket_title, p.ticket_no AS project_ticket_no, p.title AS project_title`;
const FROM = `FROM help_requests h JOIN tickets t ON t.id = h.ticket_id JOIN projects p ON p.id = h.project_id
  LEFT JOIN users ru ON ru.id = h.requested_by LEFT JOIN users au ON au.id = h.accepted_by`;

/**
 * GET /api/help-requests?scope=for_me (default) | mine | all (HR)
 *   for_me: open requests I can answer (named, or matching my skills) + ones I accepted
 */
export const GET = handler(async (request: NextRequest) => {
  const v = await getViewer(request);
  const scope = new URL(request.url).searchParams.get('scope') || 'for_me';
  if (scope === 'all') {
    if (v.role !== 'hr') throw new HttpError(403, 'HR only');
    return ok(await query(`SELECT ${COLS} ${FROM} ORDER BY h.id DESC LIMIT 300`));
  }
  if (scope === 'mine') return ok(await query(`SELECT ${COLS} ${FROM} WHERE h.requested_by = $1 ORDER BY h.id DESC LIMIT 200`, [v.userId]));
  if (v.role !== 'developer') return ok([]);
  return ok(await query(
    `SELECT ${COLS} ${FROM}
      WHERE (h.accepted_by = $1)
         OR (h.status = 'open' AND h.requested_by <> $1 AND NOT ($1 = ANY(h.declined_by))
             AND ($1 = ANY(h.target_user_ids)
                  OR (cardinality(h.target_user_ids) = 0
                      AND NOT EXISTS (SELECT 1 FROM developer_profiles dp WHERE dp.user_id = $1 AND dp.is_guest)
                      AND (cardinality(h.skills) = 0
                           OR EXISTS (SELECT 1 FROM developer_profiles dp WHERE dp.user_id = $1 AND dp.skills && h.skills)))))
      ORDER BY (h.status = 'open') DESC, h.id DESC LIMIT 200`,
    [v.userId]
  ));
});
