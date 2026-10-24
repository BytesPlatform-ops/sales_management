import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { getAuth, handler, ok } from '@/lib/training/http';

export const dynamic = 'force-dynamic';

/** GET /api/training/tracks */
export const GET = handler(async (request: NextRequest) => {
  await getAuth(request);
  const tracks = await query(
    `SELECT t.*, (SELECT COUNT(*) FROM training_courses c WHERE c.track_id = t.id)::int AS course_count
     FROM training_tracks t ORDER BY t.sort_order, t.id`
  );
  return ok(tracks);
});
