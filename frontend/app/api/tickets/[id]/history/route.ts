import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { handler, ok } from '@/lib/training/http';
import { ticketCtx } from '@/lib/tickets/core';

export const dynamic = 'force-dynamic';

/** GET /api/tickets/{id}/history — every change, newest first, plus triage decisions. */
export const GET = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const { ticket } = await ticketCtx(request, Number(params.id));
  return ok(await query(
    `SELECT h.id, h.field, h.old_value, h.new_value, h.created_at, h.user_id, u.full_name AS user_name
       FROM ticket_history h LEFT JOIN users u ON u.id = h.user_id
      WHERE h.ticket_id = $1 ORDER BY h.id DESC LIMIT 300`,
    [ticket.id]
  ));
});
