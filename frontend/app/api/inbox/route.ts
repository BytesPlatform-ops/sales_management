import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { handler, ok } from '@/lib/training/http';
import { getViewer } from '@/lib/projects/core';

export const dynamic = 'force-dynamic';

/**
 * GET /api/inbox?tab=unread|all|mentions&project_id=&limit=
 * Your notifications: the inbox (ids "n…") plus older training notifications
 * (ids "t…"), newest first. Snoozed items stay hidden until their time comes.
 * Always returns unread_count for the bell.
 */
export const GET = handler(async (request: NextRequest) => {
  const v = await getViewer(request);
  const sp = new URL(request.url).searchParams;
  const tab = sp.get('tab') || 'all';
  const limit = Math.min(Math.max(Number(sp.get('limit')) || 50, 1), 200);
  const projectId = Number(sp.get('project_id')) || null;

  const inboxWhere = ['n.user_id = $1', '(n.snoozed_until IS NULL OR n.snoozed_until <= NOW())'];
  const trainingWhere = ['t.user_id = $1'];
  if (tab === 'unread') { inboxWhere.push('n.read_at IS NULL'); trainingWhere.push('t.read_at IS NULL'); }
  if (tab === 'mentions') { inboxWhere.push(`n.type = 'mention'`); trainingWhere.push('FALSE'); }
  if (projectId) { inboxWhere.push('n.project_id = $2'); trainingWhere.push('FALSE'); }

  const params: unknown[] = [v.userId];
  if (projectId) params.push(projectId);
  params.push(limit);
  const items = await query(
    `SELECT * FROM (
       SELECT 'n' || n.id AS id, n.type, n.title, n.body, n.link, n.project_id, p.ticket_no AS project_ticket_no,
              n.read_at, n.snoozed_until, n.created_at, a.full_name AS actor_name, n.entity_type, n.entity_id
         FROM notifications_inbox n
         LEFT JOIN projects p ON p.id = n.project_id
         LEFT JOIN users a ON a.id = n.actor_id
        WHERE ${inboxWhere.join(' AND ')}
       UNION ALL
       SELECT 't' || t.id, t.type, NULL, t.body, t.link, NULL, NULL, t.read_at, NULL, t.created_at, NULL, NULL, NULL
         FROM training_notifications t
        WHERE ${trainingWhere.join(' AND ')}
     ) x ORDER BY created_at DESC LIMIT $${params.length}`,
    params
  );
  const counts = await queryOne<{ unread: number; snoozed: number }>(
    `SELECT (SELECT COUNT(*) FROM notifications_inbox WHERE user_id = $1 AND read_at IS NULL AND (snoozed_until IS NULL OR snoozed_until <= NOW()))
          + (SELECT COUNT(*) FROM training_notifications WHERE user_id = $1 AND read_at IS NULL) AS unread,
            (SELECT COUNT(*) FROM notifications_inbox WHERE user_id = $1 AND read_at IS NULL AND snoozed_until > NOW()) AS snoozed`,
    [v.userId]
  );
  return ok({ items, unread_count: Number(counts?.unread || 0), snoozed_count: Number(counts?.snoozed || 0) });
});
