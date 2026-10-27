import { NextRequest } from 'next/server';
import { handler, ok, readJson } from '@/lib/training/http';
import { acceptInvite, lookupInvite } from '@/lib/auth/invites';

export const dynamic = 'force-dynamic';
type Ctx = { params: { token: string } };

/** GET /api/auth/invite/{token} — who the link is for, if it's still valid. Public. */
export const GET = handler(async (_request: NextRequest, { params }: Ctx) => {
  const inv = await lookupInvite(params.token);
  return ok({ username: inv.username, full_name: inv.full_name, role: inv.role });
});

/** POST /api/auth/invite/{token} { password } — set your password (single use). Then sign in. */
export const POST = handler(async (request: NextRequest, { params }: Ctx) => {
  const b = await readJson(request);
  return ok(await acceptInvite(params.token, String(b.password || '')));
});
