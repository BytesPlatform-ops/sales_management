import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { capabilities, recordHistory, ticketCtx } from '@/lib/tickets/core';
import { str } from '@/lib/tickets/input';

export const dynamic = 'force-dynamic';

/** POST /api/tickets/{id}/checklist { body } — add an item. Developers and HR. */
export const POST = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const ctx = await ticketCtx(request, Number(params.id));
  if (!capabilities(ctx).work) throw new HttpError(403, 'Only the project’s developers or HR can edit the checklist');
  const body = str((await readJson(request)).body, 'Item', 500, true);
  const row = await queryOne(
    `INSERT INTO ticket_checklist_items (ticket_id, body, sort_order)
     VALUES ($1, $2, COALESCE((SELECT MAX(sort_order) + 1 FROM ticket_checklist_items WHERE ticket_id = $1), 0))
     RETURNING id, body, done, done_at, sort_order`,
    [ctx.ticket.id, body]
  );
  return ok(row);
});

/** PATCH /api/tickets/{id}/checklist { item_id, done?, body? } */
export const PATCH = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const ctx = await ticketCtx(request, Number(params.id));
  if (!capabilities(ctx).work) throw new HttpError(403, 'Only the project’s developers or HR can edit the checklist');
  const b = await readJson(request);
  const item = await queryOne<{ id: number; body: string; done: boolean }>(
    `SELECT id, body, done FROM ticket_checklist_items WHERE id = $1 AND ticket_id = $2`, [Number(b.item_id), ctx.ticket.id]
  );
  if (!item) throw new HttpError(404, 'Checklist item not found');
  const body = b.body !== undefined ? str(b.body, 'Item', 500, true) : item.body;
  const done = b.done !== undefined ? !!b.done : item.done;
  const row = await queryOne(
    `UPDATE ticket_checklist_items SET body = $2, done = $3,
            done_by = CASE WHEN $3 THEN $4::bigint ELSE NULL END,
            done_at = CASE WHEN $3 AND NOT done THEN NOW() WHEN $3 THEN done_at ELSE NULL END
      WHERE id = $1 RETURNING id, body, done, done_at, sort_order`,
    [item.id, body, done, ctx.viewer.userId]
  );
  if (done !== item.done) await recordHistory(ctx.ticket.id, ctx.viewer.userId, 'checklist', { item: item.body, done: item.done }, { item: body, done });
  return ok(row);
});

/** DELETE /api/tickets/{id}/checklist?item_id= */
export const DELETE = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const ctx = await ticketCtx(request, Number(params.id));
  if (!capabilities(ctx).work) throw new HttpError(403, 'Only the project’s developers or HR can edit the checklist');
  const id = Number(new URL(request.url).searchParams.get('item_id'));
  await query(`DELETE FROM ticket_checklist_items WHERE id = $1 AND ticket_id = $2`, [id, ctx.ticket.id]);
  return ok({ deleted: id });
});
