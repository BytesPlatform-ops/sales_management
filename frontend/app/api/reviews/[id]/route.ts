import { NextRequest } from 'next/server';
import { handler, ok, readJson } from '@/lib/training/http';
import { ticketCtx } from '@/lib/tickets/core';
import { decideReview, loadReview } from '@/lib/collab/reviews';

export const dynamic = 'force-dynamic';

/** POST /api/reviews/{id} { action: 'approve' | 'request_changes' | 'cancel', comments?, checklist? } */
export const POST = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const r = await loadReview(Number(params.id));
  const ctx = await ticketCtx(request, r.ticket_id); // must still see the ticket
  return ok(await decideReview(ctx, r, ctx.viewer, await readJson(request)));
});
