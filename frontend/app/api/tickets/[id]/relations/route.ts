import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { capabilities, recordHistory, ticketCtx, wouldCreateBlockCycle } from '@/lib/tickets/core';

export const dynamic = 'force-dynamic';

/**
 * POST /api/tickets/{id}/relations { relation: 'blocks' | 'blocked_by' | 'relates_to' | 'duplicate_of', key }
 * Links within the same project. Circular "blocks" chains are rejected.
 */
export const POST = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const ctx = await ticketCtx(request, Number(params.id));
  if (!capabilities(ctx).work) throw new HttpError(403, 'Only the project’s developers or HR can link tickets');
  const b = await readJson(request);
  const other = await queryOne<{ id: number; key: string }>(
    `SELECT id, key FROM tickets WHERE key = $1 AND project_id = $2 AND deleted_at IS NULL`,
    [String(b.key || '').trim().toUpperCase(), ctx.project.id]
  );
  if (!other) throw new HttpError(400, 'No ticket with that key in this project');
  if (other.id === ctx.ticket.id) throw new HttpError(400, 'A ticket can’t be linked to itself');

  const rel = String(b.relation);
  let from = ctx.ticket.id, to = other.id, kind: string;
  if (rel === 'blocks') kind = 'blocks';
  else if (rel === 'blocked_by') { kind = 'blocks'; from = other.id; to = ctx.ticket.id; }
  else if (rel === 'relates_to' || rel === 'duplicate_of') kind = rel;
  else throw new HttpError(400, 'Unknown relation');

  if (kind === 'blocks' && await wouldCreateBlockCycle(from, to)) {
    throw new HttpError(400, 'That would create a circular dependency');
  }
  const row = await queryOne(
    `INSERT INTO ticket_relations (from_ticket_id, to_ticket_id, kind, created_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (from_ticket_id, to_ticket_id, kind) DO NOTHING RETURNING id`,
    [from, to, kind, ctx.viewer.userId]
  );
  await recordHistory(ctx.ticket.id, ctx.viewer.userId, 'relation', null, { relation: rel, key: other.key });
  return ok({ id: row?.id ?? null });
});

/** DELETE /api/tickets/{id}/relations?relation_id= */
export const DELETE = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const ctx = await ticketCtx(request, Number(params.id));
  if (!capabilities(ctx).work) throw new HttpError(403, 'Only the project’s developers or HR can unlink tickets');
  const id = Number(new URL(request.url).searchParams.get('relation_id'));
  const rows = await query(
    `DELETE FROM ticket_relations WHERE id = $1 AND (from_ticket_id = $2 OR to_ticket_id = $2) RETURNING id`, [id, ctx.ticket.id]
  );
  if (!rows.length) throw new HttpError(404, 'Link not found');
  await recordHistory(ctx.ticket.id, ctx.viewer.userId, 'relation', { relation_id: id }, null);
  return ok({ deleted: id });
});
