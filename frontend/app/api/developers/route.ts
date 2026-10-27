import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { handler, ok } from '@/lib/training/http';
import { getViewer } from '@/lib/projects/core';

export const dynamic = 'force-dynamic';

/**
 * GET /api/developers?skill= — active developers for pickers (share, help request),
 * with skills and whether they're out of office today. Guests are listed for HR only.
 */
export const GET = handler(async (request: NextRequest) => {
  const v = await getViewer(request);
  const skill = new URL(request.url).searchParams.get('skill');
  return ok(await query(
    `SELECT u.id, u.full_name AS name, COALESCE(dp.skills, '{}') AS skills, COALESCE(dp.is_guest, false) AS is_guest,
            (SELECT a.ends_on::text FROM user_availability a WHERE a.user_id = u.id
               AND (NOW() AT TIME ZONE 'Asia/Karachi')::date BETWEEN a.starts_on AND a.ends_on ORDER BY a.ends_on DESC LIMIT 1) AS out_until
       FROM users u LEFT JOIN developer_profiles dp ON dp.user_id = u.id
      WHERE u.role = 'developer' AND COALESCE(u.is_active, true)
        AND ($2 OR NOT COALESCE(dp.is_guest, false))
        AND ($3::text IS NULL OR $3 = ANY(dp.skills))
        AND u.id <> $1
      ORDER BY u.full_name`,
    [v.userId, v.role === 'hr', skill ? skill.toLowerCase() : null]
  ));
});
