import { NextRequest } from 'next/server';
import { handler, ok, readJson, requireHr, HttpError } from '@/lib/training/http';
import { getReview, trainerScore } from '@/lib/training/call-reviews';
import { notify } from '@/lib/training/events';

export const dynamic = 'force-dynamic';

/** PUT /api/training/call-reviews/{id}/override (trainer) { criteria:[{id, points}], auto_fail?, comment? } */
export const PUT = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const auth = await requireHr(request);
  const id = Number(params.id);
  const r = await getReview(id);
  if (!r) throw new HttpError(404, 'Review not found');
  const b = await readJson(request);
  const card = await trainerScore('call', id, auth.userId, b);
  await notify(Number(r.user_id), 'review', `Your trainer graded call #${id}: ${card.total}/100.`, '/agent/training/calls');
  return ok({ id, card });
});
