import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { handler, ok } from '@/lib/training/http';
import { requireCeo } from '@/lib/auth/ceo';

export const dynamic = 'force-dynamic';

/**
 * GET /api/ceo/access-log?type=access|audit&ceo_id= — what CEOs looked at (vault values, pay,
 * view-as…) or changed in Admin mode. Every CEO sees their own and the other CEOs' entries.
 */
export const GET = handler(async (request: NextRequest) => {
  await requireCeo(request);
  const sp = new URL(request.url).searchParams;
  const ceoId = Number(sp.get('ceo_id')) || null;
  if (sp.get('type') === 'audit') {
    return ok(await query(
      `SELECT l.id, l.ceo_id, u.full_name AS ceo_name, l.method, l.path, l.target, l.ip, l.created_at
         FROM ceo_audit_log l LEFT JOIN users u ON u.id = l.ceo_id
        WHERE ($1::bigint IS NULL OR l.ceo_id = $1) ORDER BY l.id DESC LIMIT 300`, [ceoId]
    ));
  }
  return ok(await query(
    `SELECT l.id, l.ceo_id, u.full_name AS ceo_name, l.kind, l.target, l.reason, l.ip, l.created_at
       FROM ceo_access_log l LEFT JOIN users u ON u.id = l.ceo_id
      WHERE ($1::bigint IS NULL OR l.ceo_id = $1) ORDER BY l.id DESC LIMIT 300`, [ceoId]
  ));
});
