import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { handler, ok } from '@/lib/training/http';
import { ticketCtx, watch } from '@/lib/tickets/core';

export const dynamic = 'force-dynamic';

/** POST /api/tickets/{id}/watchers — watch it yourself. */
export const POST = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const { ticket, viewer } = await ticketCtx(request, Number(params.id));
  await watch(ticket.id, [viewer.userId], 'manual');
  return ok({ watching: true });
});

/** DELETE /api/tickets/{id}/watchers — stop watching. */
export const DELETE = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const { ticket, viewer } = await ticketCtx(request, Number(params.id));
  await query(`DELETE FROM ticket_watchers WHERE ticket_id = $1 AND user_id = $2`, [ticket.id, viewer.userId]);
  return ok({ watching: false });
});
