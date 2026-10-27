import { NextRequest } from 'next/server';
import { handler, ok, readJson } from '@/lib/training/http';
import { ticketCtx } from '@/lib/tickets/core';
import { requestReview } from '@/lib/collab/reviews';

export const dynamic = 'force-dynamic';

/**
 * POST /api/tickets/{id}/reviews { reviewer_id? (omit for round-robin), pr_url?, checklist?: string[] }
 * Moves the ticket to In review when the normal rules allow it.
 */
export const POST = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const ctx = await ticketCtx(request, Number(params.id));
  return ok(await requestReview(ctx, await readJson(request)));
});
