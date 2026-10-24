import { NextRequest } from 'next/server';
import { getAuth, handler, ok, HttpError } from '@/lib/training/http';
import { getReview, processReview } from '@/lib/training/call-reviews';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** GET /api/training/call-reviews/{id} */
export const GET = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const auth = await getAuth(request);
  const r = await getReview(Number(params.id));
  if (!r || (auth.role !== 'hr' && Number(r.user_id) !== auth.userId)) throw new HttpError(404, 'Review not found');
  return ok(r);
});

/** POST /api/training/call-reviews/{id} — retry grading (e.g. once AI is back). */
export const POST = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const auth = await getAuth(request);
  const r = await getReview(Number(params.id));
  if (!r || (auth.role !== 'hr' && Number(r.user_id) !== auth.userId)) throw new HttpError(404, 'Review not found');
  if (r.status === 'reviewed') throw new HttpError(400, 'Already reviewed by a trainer');
  return ok(await processReview(r.id, Number(r.user_id)));
});
