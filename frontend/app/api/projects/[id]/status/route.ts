import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { getViewer, loadProject, systemMessage, canSetStatus, STATUSES, STATUS_LABELS, Status, normalizeProject } from '@/lib/projects/core';

export const dynamic = 'force-dynamic';

/**
 * POST /api/projects/{id}/status { status, note? }
 * Developers: new/in_progress/review/on_hold → in_progress | review.
 * Supervisor (HR): any change, incl. delivered, closed, cancelled and reopening.
 */
export const POST = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const v = await getViewer(request);
  const p = await loadProject(Number(params.id), v);
  const { status, note } = await readJson(request);
  if (!STATUSES.includes(status)) throw new HttpError(400, 'Unknown status');
  if (!canSetStatus(v.role, p.status, status as Status)) throw new HttpError(403, `You can’t move this ticket from ${STATUS_LABELS[p.status]} to ${STATUS_LABELS[status as Status]}`);

  const updated = await queryOne<any>(
    `UPDATE projects SET status = $2, updated_at = NOW(),
       delivered_at = CASE WHEN $2::varchar = 'delivered' THEN COALESCE(delivered_at, NOW()) ELSE delivered_at END,
       closed_at = CASE WHEN $2::varchar IN ('closed', 'cancelled') THEN NOW() WHEN $2::varchar NOT IN ('closed', 'cancelled') THEN NULL ELSE closed_at END
     WHERE id = $1 RETURNING *`,
    [p.id, status]
  );
  const reopened = ['closed', 'cancelled'].includes(p.status) && !['closed', 'cancelled'].includes(status);
  await systemMessage(
    p.id,
    `${v.name} ${reopened ? 'reopened the project' : 'moved this'} to ${STATUS_LABELS[status as Status]}${note ? `: “${String(note).slice(0, 500)}”` : '.'}`,
    v.userId
  );
  if (status === 'closed' || status === 'cancelled') {
    // Nothing more is due: close the open recurring cycle.
    await query(`UPDATE project_cycles SET status = 'skipped' WHERE project_id = $1 AND status = 'open' AND period_start > CURRENT_DATE`, [p.id]);
  }
  return ok(normalizeProject(updated));
});
