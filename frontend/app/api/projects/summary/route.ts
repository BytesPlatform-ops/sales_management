import { NextRequest } from 'next/server';
import { queryOne } from '@/lib/db';
import { handler, ok } from '@/lib/training/http';
import { getViewer, visibilityClause } from '@/lib/projects/core';

export const dynamic = 'force-dynamic';

/** GET /api/projects/summary — unread messages, overdue and due-this-week counts (sidebar badge). */
export const GET = handler(async (request: NextRequest) => {
  const v = await getViewer(request);
  try {
    const row = await queryOne<any>(
      `SELECT
         (SELECT COUNT(*) FROM project_messages msg JOIN projects p ON p.id = msg.project_id
          WHERE ${visibilityClause(v)} AND COALESCE(msg.user_id, 0) <> $1
            AND msg.id > COALESCE((SELECT last_read_message_id FROM project_reads r WHERE r.project_id = p.id AND r.user_id = $1), 0))::int AS unread,
         (SELECT COUNT(*) FROM projects p WHERE ${visibilityClause(v)} AND p.deadline < CURRENT_DATE
            AND p.status NOT IN ('delivered', 'closed', 'cancelled'))::int AS overdue,
         (SELECT COUNT(*) FROM projects p WHERE ${visibilityClause(v)} AND p.deadline BETWEEN CURRENT_DATE AND CURRENT_DATE + 7
            AND p.status NOT IN ('delivered', 'closed', 'cancelled'))::int AS due_this_week`,
      [v.userId]
    );
    return ok(row);
  } catch {
    // Module not installed yet — the sidebar badge just stays empty.
    return ok({ unread: 0, overdue: 0, due_this_week: 0 });
  }
});
