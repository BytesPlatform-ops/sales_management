import { NextRequest } from 'next/server';
import { queryOne } from '@/lib/db';
import { handler, ok, requireHr, HttpError } from '@/lib/training/http';

export const dynamic = 'force-dynamic';

/** POST /api/hr/github-events/{deliveryId}/retry — put a failed delivery back in the queue. HR. */
export const POST = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  await requireHr(request);
  const r = await queryOne(
    `UPDATE github_events SET status = 'pending', attempts = 0, next_attempt_at = NOW(), error = NULL
      WHERE delivery_id = $1 AND status = 'failed' RETURNING delivery_id`, [params.id]
  );
  if (!r) throw new HttpError(404, 'No failed delivery with that id');
  return ok({ requeued: params.id });
});
