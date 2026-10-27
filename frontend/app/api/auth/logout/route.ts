import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { handler, ok } from '@/lib/training/http';
import { verifyRequest } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

/** POST /api/auth/logout — ends this session (the token stops working for HR/CEO at once). */
export const POST = handler(async (request: NextRequest) => {
  const a = await verifyRequest(request);
  if (a.sid && !a.readonly) await query(`UPDATE user_sessions SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL`, [a.sid]);
  return ok({ signed_out: true });
});
