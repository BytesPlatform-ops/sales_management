import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { capabilities, notify, ticketCtx, ticketLink, watch, watcherIds } from '@/lib/tickets/core';
import { mentionedUserIds } from '@/lib/tickets/mentions';
import { str } from '@/lib/tickets/input';

export const dynamic = 'force-dynamic';

/** GET /api/tickets/{id}/comments — oldest first; deleted comments come back as tombstones. */
export const GET = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const { ticket } = await ticketCtx(request, Number(params.id));
  return ok(await query(
    `SELECT c.id, c.user_id, u.full_name AS user_name, u.role AS user_role,
            CASE WHEN c.deleted_at IS NULL THEN c.body ELSE '' END AS body,
            c.edited_at, c.deleted_at, c.created_at
       FROM ticket_comments c LEFT JOIN users u ON u.id = c.user_id
      WHERE c.ticket_id = $1 ORDER BY c.id`,
    [ticket.id]
  ));
});

/** POST /api/tickets/{id}/comments { body } — anyone who can see the ticket. Mentions notify. */
export const POST = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const ctx = await ticketCtx(request, Number(params.id));
  if (!capabilities(ctx).comment) throw new HttpError(403, 'Your access to this ticket is view-only');
  const { ticket: t, viewer, project } = ctx;
  const body = str((await readJson(request)).body, 'Comment', 20_000, true)!;
  const row = await queryOne(
    `INSERT INTO ticket_comments (ticket_id, user_id, body) VALUES ($1, $2, $3) RETURNING id, user_id, body, edited_at, deleted_at, created_at`,
    [t.id, viewer.userId, body]
  );
  await query(`UPDATE tickets SET updated_at = NOW() WHERE id = $1`, [t.id]);
  const link = ticketLink(project.id, t.key);
  const mentioned = await mentionedUserIds(project.id, body);
  await watch(t.id, [viewer.userId], 'commenter');
  await watch(t.id, mentioned, 'mention');
  await notify(mentioned, viewer.userId, 'mention', `${viewer.name} mentioned you on ${t.key}: ${body.slice(0, 140)}`, link);
  const others = (await watcherIds(t.id)).filter((id) => !mentioned.includes(id));
  await notify(others, viewer.userId, 'ticket_comment', `${viewer.name} commented on ${t.key}: ${body.slice(0, 140)}`, link);
  return ok({ ...row, user_name: viewer.name, user_role: viewer.role });
});
