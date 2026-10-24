import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { getAuth, handler, ok } from '@/lib/training/http';

export const dynamic = 'force-dynamic';

/** GET /api/training/tracks/{id}/courses */
export const GET = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  await getAuth(request);
  const courses = await query(
    `SELECT c.*, (SELECT COUNT(*) FROM training_lessons l WHERE l.course_id = c.id AND l.published)::int AS lesson_count
     FROM training_courses c WHERE c.track_id = $1 ORDER BY c.sort_order, c.id`,
    [Number(params.id)]
  );
  return ok(courses);
});
