import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { handler, ok, readJson } from '@/lib/training/http';
import { getViewer, loadProject } from '@/lib/projects/core';
import { canPostWorkUpdate, createWorkUpdate } from '@/lib/work-updates';

export const dynamic = 'force-dynamic';

/** GET /api/projects/{id}/work-updates — newest first, with linked ticket keys. */
export const GET = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const v = await getViewer(request);
  const p = await loadProject(Number(params.id), v);
  const rows = await query(
    `SELECT w.id, w.user_id, u.full_name AS user_name, w.body, w.ticket_ids, w.created_at, w.edited_at,
            COALESCE((SELECT json_agg(json_build_object('id', t.id, 'key', t.key, 'title', t.title) ORDER BY t.number)
                        FROM tickets t WHERE t.id = ANY(w.ticket_ids)), '[]') AS tickets
       FROM work_updates w LEFT JOIN users u ON u.id = w.user_id
      WHERE w.project_id = $1 AND w.deleted_at IS NULL ORDER BY w.created_at DESC LIMIT 100`, [p.id]
  );
  return ok({ updates: rows, can_post: await canPostWorkUpdate(v, p.id) });
});

/** POST /api/projects/{id}/work-updates { body, ticket_ids?, status_moves?: [{ticket_id, status, confirm_blocked?}] } */
export const POST = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const v = await getViewer(request);
  const p = await loadProject(Number(params.id), v);
  return ok(await createWorkUpdate(v, p, await readJson(request)));
});
