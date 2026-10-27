import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { handler, ok, readJson } from '@/lib/training/http';
import { requireCeo } from '@/lib/auth/ceo';
import { createCeoAccount } from '@/lib/auth/ceo-users';

export const dynamic = 'force-dynamic';

/** GET /api/ceo/users — CEO accounts (only CEOs can see them). */
export const GET = handler(async (request: NextRequest) => {
  await requireCeo(request);
  return ok(await query(
    `SELECT u.id, u.username, u.full_name, u.email_address AS email, COALESCE(u.is_active, true) AS is_active, u.created_at,
            (SELECT enabled_at FROM user_totp t WHERE t.user_id = u.id) AS totp_enabled_at,
            EXISTS (SELECT 1 FROM user_invites i WHERE i.user_id = u.id AND i.used_at IS NULL AND i.expires_at > NOW()) AS invite_pending
       FROM users u WHERE u.role = 'ceo' ORDER BY u.full_name`
  ));
});

/** POST /api/ceo/users { username, full_name, email } — Admin mode. Returns the invite link (also emailed). */
export const POST = handler(async (request: NextRequest) => {
  const a = await requireCeo(request); // Admin mode already enforced for CEO writes
  const b = await readJson(request);
  return ok(await createCeoAccount({ username: String(b.username || ''), full_name: String(b.full_name || ''), email: String(b.email || '') }, a.userId));
});
