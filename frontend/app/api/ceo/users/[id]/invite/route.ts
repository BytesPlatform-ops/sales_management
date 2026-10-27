import { NextRequest } from 'next/server';
import { queryOne } from '@/lib/db';
import { handler, ok, HttpError } from '@/lib/training/http';
import { requireCeo } from '@/lib/auth/ceo';
import { sendCeoInvite } from '@/lib/auth/ceo-users';

export const dynamic = 'force-dynamic';

/** POST /api/ceo/users/{id}/invite — a fresh invite link (old ones stop working). Admin mode. */
export const POST = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const a = await requireCeo(request);
  const u = await queryOne(`SELECT id FROM users WHERE id = $1 AND role = 'ceo'`, [Number(params.id)]);
  if (!u) throw new HttpError(404, 'CEO account not found');
  return ok({ invite_url: await sendCeoInvite(Number(params.id), a.userId) });
});
