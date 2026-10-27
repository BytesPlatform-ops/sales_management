import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { ticketCtx } from '@/lib/tickets/core';
import { str } from '@/lib/tickets/input';

export const dynamic = 'force-dynamic';
type Ctx = { params: { id: string } };

async function load(request: NextRequest, id: number) {
  const c = await queryOne<{ id: number; ticket_id: number; user_id: string; deleted_at: string | null }>(
    `SELECT id, ticket_id, user_id, deleted_at FROM ticket_comments WHERE id = $1`, [id]
  );
  if (!c || c.deleted_at) throw new HttpError(404, 'Comment not found');
  const ctx = await ticketCtx(request, c.ticket_id); // also enforces project access
  return { c, ctx, mine: Number(c.user_id) === ctx.viewer.userId };
}

/** PATCH /api/ticket-comments/{id} { body } — your own comments. */
export const PATCH = handler(async (request: NextRequest, { params }: Ctx) => {
  const { c, mine } = await load(request, Number(params.id));
  if (!mine) throw new HttpError(403, 'You can only edit your own comments');
  const body = str((await readJson(request)).body, 'Comment', 20_000, true);
  return ok(await queryOne(
    `UPDATE ticket_comments SET body = $2, edited_at = NOW() WHERE id = $1 RETURNING id, body, edited_at`, [c.id, body]
  ));
});

/** DELETE /api/ticket-comments/{id} — your own, or any as HR. Leaves a "deleted" placeholder. */
export const DELETE = handler(async (request: NextRequest, { params }: Ctx) => {
  const { c, ctx, mine } = await load(request, Number(params.id));
  if (!mine && ctx.viewer.role !== 'hr') throw new HttpError(403, 'You can only delete your own comments');
  await query(`UPDATE ticket_comments SET deleted_at = NOW() WHERE id = $1`, [c.id]);
  await query(`UPDATE media_files SET deleted_at = NOW(), deleted_by = $2 WHERE entity_type = 'ticket_comment' AND entity_id = $1::text AND deleted_at IS NULL`,
    [c.id, ctx.viewer.userId]);
  return ok({ deleted: c.id });
});
