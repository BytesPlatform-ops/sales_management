import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { getAuth, handler, ok, readJson, requireHr, resolveTargetUser, HttpError } from '@/lib/training/http';
import { notify } from '@/lib/training/events';

export const dynamic = 'force-dynamic';

/** GET /api/training/assignments?user_id= */
export const GET = handler(async (request: NextRequest) => {
  const auth = await getAuth(request);
  const param = new URL(request.url).searchParams.get('user_id');
  const all = auth.role === 'hr' && !param;
  const rows = await query(
    `SELECT a.id, a.user_id, u.full_name, a.track_id, t.code AS track_code, t.title AS track_title,
            a.course_id, c.code AS course_code, c.title AS course_title, a.due_at, a.created_at, b.full_name AS assigned_by_name
     FROM training_assignments a
     JOIN users u ON u.id = a.user_id
     LEFT JOIN training_tracks t ON t.id = a.track_id
     LEFT JOIN training_courses c ON c.id = a.course_id
     LEFT JOIN users b ON b.id = a.assigned_by
     ${all ? '' : 'WHERE a.user_id = $1'} ORDER BY a.due_at NULLS LAST, a.created_at DESC`,
    all ? [] : [resolveTargetUser(auth, param)]
  );
  return ok(rows);
});

/** POST /api/training/assignments (trainer) { user_ids: [], track_id? | course_id?, due_at? } — assign to reps or a cohort. */
export const POST = handler(async (request: NextRequest) => {
  const auth = await requireHr(request);
  const b = await readJson(request);
  const ids: number[] = (Array.isArray(b.user_ids) ? b.user_ids : b.user_id ? [b.user_id] : []).map(Number);
  if (!ids.length) throw new HttpError(400, 'user_ids is required');
  if (!b.track_id && !b.course_id) throw new HttpError(400, 'track_id or course_id is required');
  const created = [];
  for (const id of ids) {
    const rows = await query(
      `INSERT INTO training_assignments (user_id, track_id, course_id, assigned_by, due_at) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [id, b.track_id || null, b.course_id || null, auth.userId, b.due_at || null]
    );
    created.push(rows[0]);
    await notify(id, 'assignment', `New training assigned${b.due_at ? ` — due ${new Date(b.due_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}.`, '/agent/training');
  }
  return ok(created);
});

/** DELETE /api/training/assignments?id= (trainer) */
export const DELETE = handler(async (request: NextRequest) => {
  await requireHr(request);
  const id = Number(new URL(request.url).searchParams.get('id'));
  const rows = await query(`DELETE FROM training_assignments WHERE id = $1 RETURNING id`, [id]);
  if (!rows.length) throw new HttpError(404, 'Assignment not found');
  return ok({ deleted: id });
});
