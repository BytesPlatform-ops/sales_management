import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { handler, ok, requireHr } from '@/lib/training/http';

export const dynamic = 'force-dynamic';

/** GET /api/training/users?role=rep[&include_inactive=1] (trainer) — reps with ramp phase + cert flags. */
export const GET = handler(async (request: NextRequest) => {
  await requireHr(request);
  const sp = new URL(request.url).searchParams;
  const role = sp.get('role') === 'trainer' ? 'hr' : 'agent';
  const inactive = sp.get('include_inactive') === '1';
  return ok(await query(
    `SELECT u.id, u.username, u.full_name, u.extension_number, u.created_at, COALESCE(u.is_active, true) AS is_active,
            COALESCE(r.phase, 'FULL') AS phase, r.quota_multiplier, r.certified_at, COALESCE(r.grandfathered, true) AS grandfathered,
            ARRAY(SELECT code FROM training_certifications c WHERE c.user_id = u.id AND c.revoked_at IS NULL ORDER BY code) AS certifications
     FROM users u LEFT JOIN training_ramp_status r ON r.user_id = u.id
     WHERE u.role = $1 ${inactive ? '' : 'AND COALESCE(u.is_active, true)'}
     ORDER BY u.full_name`,
    [role]
  ));
});
