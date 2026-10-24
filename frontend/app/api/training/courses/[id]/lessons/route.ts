import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { getAuth, handler, ok } from '@/lib/training/http';

export const dynamic = 'force-dynamic';

/** GET /api/training/courses/{id}/lessons — trainers also see unpublished lessons. */
export const GET = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const auth = await getAuth(request);
  const lessons = await query(
    `SELECT id, course_id, code, type, title, est_minutes, sort_order, required, pass_pct, config, version, published, updated_at
     FROM training_lessons WHERE course_id = $1 ${auth.role === 'hr' ? '' : 'AND published'} ORDER BY sort_order, id`,
    [Number(params.id)]
  );
  return ok(lessons);
});
