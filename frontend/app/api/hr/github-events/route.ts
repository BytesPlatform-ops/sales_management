import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { handler, ok, requireHr } from '@/lib/training/http';

export const dynamic = 'force-dynamic';

/** GET /api/hr/github-events?status=failed|pending|done|ignored — webhook deliveries (no payloads). HR. */
export const GET = handler(async (request: NextRequest) => {
  await requireHr(request);
  const status = new URL(request.url).searchParams.get('status');
  return ok(await query(
    `SELECT e.delivery_id, e.event, e.action, e.status, e.attempts, e.error, e.received_at, e.processed_at, r.full_name AS repo, p.ticket_no
       FROM github_events e LEFT JOIN project_repos r ON r.github_repo_id = e.repo_id LEFT JOIN projects p ON p.id = r.project_id
      ${status ? 'WHERE e.status = $1' : ''} ORDER BY e.received_at DESC LIMIT 200`,
    status ? [status] : []
  ));
});
