import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { afterPost, fullMessage, markRead, MESSAGE_SELECT, participants, threadCtx } from '@/lib/chat/project-thread';
import { cleanVoiceMeta } from '@/lib/chat/rules';
import { editMessage } from '@/lib/chat/project-thread-actions';

export const dynamic = 'force-dynamic';

/**
 * GET /api/projects/{id}/messages[?after=<id>&since=<iso>]
 *   messages      oldest first; with `after`, only newer ones (polling)
 *   changed       with `since`, older messages edited/deleted/pinned since then
 *   reads         every participant's read pointer (✓✓ and "Seen by")
 *   participants  user ids who take part in the thread
 *   last_read     the viewer's read pointer BEFORE this call (for "jump to first unread")
 *   now           server time to pass back as `since`
 * Marks the thread read up to the newest message returned.
 */
export const GET = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const ctx = await threadCtx(request, Number(params.id));
  const { project, viewer } = ctx;
  const sp = new URL(request.url).searchParams;
  const after = Number(sp.get('after') || 0);
  const since = sp.get('since');
  const now = (await queryOne<{ now: string }>(`SELECT NOW() AS now`))!.now;

  const before = await queryOne<{ last_read_message_id: number }>(
    `SELECT last_read_message_id FROM project_reads WHERE project_id = $1 AND user_id = $2`, [project.id, viewer.userId]
  );
  const messages = await query<any>(
    `${MESSAGE_SELECT} WHERE m.project_id = $1 AND NOT m.is_draft AND m.id > $2 ORDER BY m.id ASC LIMIT 500`, [project.id, after]
  );
  const changed = after && since && !Number.isNaN(Date.parse(since))
    ? await query<any>(`${MESSAGE_SELECT} WHERE m.project_id = $1 AND NOT m.is_draft AND m.id <= $2 AND m.updated_at > $3 ORDER BY m.id`, [project.id, after, since])
    : [];
  const last = messages.length ? messages[messages.length - 1].id : 0;
  // A CEO's read-only "view as" must not mark anything read for the person being viewed.
  if (last && !viewer.readonly) await markRead(project.id, viewer.userId, last);

  const people = await participants(project);
  const reads = await query(
    `SELECT u.id AS user_id, u.full_name AS name, COALESCE(r.last_read_message_id, 0) AS last_read
       FROM users u LEFT JOIN project_reads r ON r.user_id = u.id AND r.project_id = $1
      WHERE u.id = ANY($2::bigint[])`,
    [project.id, people]
  );
  return ok({ messages, changed, reads, participants: people, last_read: before?.last_read_message_id ?? 0, now });
});

/**
 * POST /api/projects/{id}/messages { body?, reply_to?, kind?: 'message'|'media'|'voice', draft?, meta? }
 * A text message posts immediately. Messages with files are created as a draft
 * (`draft: true`, invisible to others), files are uploaded to it, then
 * POST …/messages/{id}/publish sends it.
 */
export const POST = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const ctx = await threadCtx(request, Number(params.id));
  const { project, viewer } = ctx;
  const b = await readJson(request);
  const kind = ['message', 'media', 'voice'].includes(b.kind) ? b.kind : 'message';
  const body = String(b.body ?? '').trim();
  if (body.length > 10000) throw new HttpError(400, 'Message is too long');
  if (kind === 'message' && !body) throw new HttpError(400, 'Write a message');
  if (kind !== 'message' && !b.draft) throw new HttpError(400, 'Messages with files are sent as a draft first');
  let meta = null;
  if (kind === 'voice') {
    meta = cleanVoiceMeta(b.meta);
    if (!meta) throw new HttpError(400, 'Voice notes must be 5 minutes or shorter');
  }
  let replyTo: number | null = null;
  if (b.reply_to) {
    const r = await queryOne<{ id: number }>(
      `SELECT id FROM project_messages WHERE id = $1 AND project_id = $2 AND NOT is_draft`, [Number(b.reply_to), project.id]
    );
    replyTo = r ? r.id : null;
  }
  const row = await queryOne<{ id: number }>(
    `INSERT INTO project_messages (project_id, user_id, kind, body, reply_to, meta, is_draft) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [project.id, viewer.userId, kind, body, replyTo, meta ? JSON.stringify(meta) : null, kind !== 'message']
  );
  if (kind !== 'message') return ok({ id: row!.id, draft: true });
  await afterPost(ctx, row!.id, body);
  return ok(await fullMessage(row!.id));
});

/** PATCH /api/projects/{id}/messages { id, body } — kept for older clients; same rules as PATCH …/messages/{id}. */
export const PATCH = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const ctx = await threadCtx(request, Number(params.id));
  const b = await readJson(request);
  return ok(await editMessage(ctx, Number(b.id), b.body));
});
