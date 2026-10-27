import { NextRequest } from 'next/server';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { capabilities, ticketCtx } from '@/lib/tickets/core';
import { createHelpRequest } from '@/lib/collab/help';

export const dynamic = 'force-dynamic';

/**
 * POST /api/tickets/{id}/help { message, skills?: string[], user_ids?: number[] }
 * Ask for help: named developers, or developers with those skills (never guests or
 * people out of office). Whoever accepts gets temporary access (see lib/collab/help).
 */
export const POST = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const ctx = await ticketCtx(request, Number(params.id));
  if (!capabilities(ctx).work || ctx.actor.grantLevel) throw new HttpError(403, 'Only the project’s developers or HR can ask for help');
  return ok(await createHelpRequest(ctx, await readJson(request)));
});
