import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { getViewer, loadProject } from '@/lib/projects/core';

export const dynamic = 'force-dynamic';

const SELECT = `SELECT m.id, m.project_id, m.user_id, m.kind, m.body, m.reply_to, m.edited_at, m.created_at,
                       u.full_name AS author, u.role AS author_role,
                       r.body AS reply_body, ru.full_name AS reply_author
                FROM project_messages m
                LEFT JOIN users u ON u.id = m.user_id
                LEFT JOIN project_messages r ON r.id = m.reply_to
                LEFT JOIN users ru ON ru.id = r.user_id`;

/**
 * GET /api/projects/{id}/messages[?after=<id>] — the thread (oldest first).
 * With `after`, only newer messages (for polling). Marks the thread as read.
 */
export const GET = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const v = await getViewer(request);
  const p = await loadProject(Number(params.id), v);
  const after = Number(new URL(request.url).searchParams.get('after') || 0);
  const rows = await query<any>(
    `${SELECT} WHERE m.project_id = $1 AND m.id > $2 ORDER BY m.id ASC LIMIT 500`,
    [p.id, after]
  );
  const lastId = rows.length ? rows[rows.length - 1].id : after;
  if (lastId) {
    await query(
      `INSERT INTO project_reads (project_id, user_id, last_read_message_id) VALUES ($1, $2, $3)
       ON CONFLICT (project_id, user_id) DO UPDATE SET last_read_message_id = GREATEST(project_reads.last_read_message_id, EXCLUDED.last_read_message_id)`,
      [p.id, v.userId, lastId]
    );
  }
  return ok(rows);
});

/** POST /api/projects/{id}/messages { body, reply_to? } — post to the thread. */
export const POST = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const v = await getViewer(request);
  const p = await loadProject(Number(params.id), v);
  const b = await readJson(request);
  const body = String(b.body || '').trim();
  if (!body) throw new HttpError(400, 'Write a message');
  if (body.length > 10000) throw new HttpError(400, 'Message is too long');
  let replyTo: number | null = null;
  if (b.reply_to) {
    const r = await queryOne<{ id: number }>(`SELECT id FROM project_messages WHERE id = $1 AND project_id = $2`, [Number(b.reply_to), p.id]);
    replyTo = r ? r.id : null;
  }
  const row = await queryOne<{ id: number }>(
    `INSERT INTO project_messages (project_id, user_id, body, reply_to) VALUES ($1, $2, $3, $4) RETURNING id`,
    [p.id, v.userId, body, replyTo]
  );
  await query(`UPDATE projects SET updated_at = NOW() WHERE id = $1`, [p.id]);
  await query(
    `INSERT INTO project_reads (project_id, user_id, last_read_message_id) VALUES ($1, $2, $3)
     ON CONFLICT (project_id, user_id) DO UPDATE SET last_read_message_id = GREATEST(project_reads.last_read_message_id, EXCLUDED.last_read_message_id)`,
    [p.id, v.userId, row!.id]
  );
  return ok((await query<any>(`${SELECT} WHERE m.id = $1`, [row!.id]))[0]);
});

/** PATCH /api/projects/{id}/messages { id, body } — edit your own message. */
export const PATCH = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const v = await getViewer(request);
  const p = await loadProject(Number(params.id), v);
  const b = await readJson(request);
  const body = String(b.body || '').trim();
  if (!body) throw new HttpError(400, 'Message can’t be empty');
  const rows = await query(
    `UPDATE project_messages SET body = $3, edited_at = NOW() WHERE id = $1 AND project_id = $2 AND user_id = $4 AND kind = 'message' RETURNING id`,
    [Number(b.id), p.id, body, v.userId]
  );
  if (!rows.length) throw new HttpError(404, 'You can only edit your own messages');
  return ok((await query<any>(`${SELECT} WHERE m.id = $1`, [Number(b.id)]))[0]);
});
