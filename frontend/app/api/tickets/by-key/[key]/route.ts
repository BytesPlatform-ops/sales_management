import { NextRequest } from 'next/server';
import { queryOne } from '@/lib/db';
import { handler, ok, HttpError } from '@/lib/training/http';
import { ticketCtx } from '@/lib/tickets/core';

export const dynamic = 'force-dynamic';

/** GET /api/tickets/by-key/PRJ-0012-T5 → { id, project_id, key } (only if you can see it). */
export const GET = handler(async (request: NextRequest, { params }: { params: { key: string } }) => {
  const row = await queryOne<{ id: number }>(
    `SELECT id FROM tickets WHERE key = $1 AND deleted_at IS NULL`, [decodeURIComponent(params.key).toUpperCase()]
  );
  if (!row) throw new HttpError(404, 'Ticket not found');
  const { ticket } = await ticketCtx(request, row.id);
  return ok({ id: ticket.id, project_id: ticket.project_id, key: ticket.key });
});
