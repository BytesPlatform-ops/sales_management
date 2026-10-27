import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { getViewer } from '@/lib/projects/core';

export const dynamic = 'force-dynamic';
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** POST /api/profile/availability { starts_on, ends_on, note?, user_id? (HR) } — out of office (inclusive). */
export const POST = handler(async (request: NextRequest) => {
  const v = await getViewer(request);
  const b = await readJson(request);
  const userId = b.user_id && v.role === 'hr' ? Number(b.user_id) : v.userId;
  if (!DAY.test(String(b.starts_on)) || !DAY.test(String(b.ends_on))) throw new HttpError(400, 'Dates must be YYYY-MM-DD');
  if (String(b.ends_on) < String(b.starts_on)) throw new HttpError(400, 'End date is before the start');
  return ok(await queryOne(
    `INSERT INTO user_availability (user_id, starts_on, ends_on, note) VALUES ($1, $2, $3, $4)
     RETURNING id, starts_on::text AS starts_on, ends_on::text AS ends_on, note`,
    [userId, b.starts_on, b.ends_on, b.note ? String(b.note).slice(0, 200) : null]
  ));
});

/** DELETE /api/profile/availability?id= — your own entry (HR: anyone's). */
export const DELETE = handler(async (request: NextRequest) => {
  const v = await getViewer(request);
  const id = Number(new URL(request.url).searchParams.get('id'));
  const rows = await query(
    `DELETE FROM user_availability WHERE id = $1 AND (user_id = $2 OR $3) RETURNING id`, [id, v.userId, v.role === 'hr']
  );
  if (!rows.length) throw new HttpError(404, 'Not found');
  return ok({ deleted: id });
});
