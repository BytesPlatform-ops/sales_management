import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { handler, ok } from '@/lib/training/http';
import { requireCeo } from '@/lib/auth/ceo';

export const dynamic = 'force-dynamic';

/** GET /api/ceo/people?q= — active users to "view as" (CEOs excluded). */
export const GET = handler(async (request: NextRequest) => {
  await requireCeo(request);
  const q = (new URL(request.url).searchParams.get('q') || '').trim();
  return ok(await query(
    `SELECT id, username, full_name, role FROM users
      WHERE COALESCE(is_active, true) AND role <> 'ceo'
        AND ($1 = '' OR full_name ILIKE '%' || $1 || '%' OR username ILIKE '%' || $1 || '%')
      ORDER BY role, full_name LIMIT 50`,
    [q.slice(0, 100)]
  ));
});
