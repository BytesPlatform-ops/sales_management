import { NextRequest } from 'next/server';
import { getAuth, handler, ok, resolveTargetUser, HttpError } from '@/lib/training/http';
import { repAnalytics } from '@/lib/training/analytics';

export const dynamic = 'force-dynamic';

/** GET /api/training/analytics/rep/{id} — a rep's funnel, learning, quality and AI cost (rep: own id only). */
export const GET = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const auth = await getAuth(request);
  const userId = resolveTargetUser(auth, params.id === 'me' ? null : params.id);
  const data = await repAnalytics(userId);
  if (!data) throw new HttpError(404, 'Rep not found');
  return ok(data);
});
