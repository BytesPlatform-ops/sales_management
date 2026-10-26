import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { getViewer, loadProject, systemMessage } from '@/lib/projects/core';

export const dynamic = 'force-dynamic';

const fmtWhen = (iso: string, tz: string) =>
  new Date(iso).toLocaleString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });

/** POST /api/projects/{id}/meetings { title, kind, starts_at (ISO), duration_min?, location?, agenda? } */
export const POST = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const v = await getViewer(request);
  const p = await loadProject(Number(params.id), v);
  const b = await readJson(request);
  if (!String(b.title || '').trim()) throw new HttpError(400, 'Meeting title is required');
  const starts = new Date(b.starts_at);
  if (isNaN(starts.getTime())) throw new HttpError(400, 'Pick a date and time');
  const kind = b.kind === 'internal' ? 'internal' : 'client';
  const row = await queryOne<any>(
    `INSERT INTO project_meetings (project_id, title, kind, starts_at, duration_min, location, agenda, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [p.id, String(b.title).trim().slice(0, 200), kind, starts.toISOString(), Math.max(5, Math.min(480, Number(b.duration_min) || 30)),
      b.location || null, b.agenda || null, v.userId]
  );
  await systemMessage(
    p.id,
    `${v.name} scheduled a ${kind} meeting “${row.title}” for ${fmtWhen(row.starts_at, p.client_timezone || 'America/New_York')} (${fmtWhen(row.starts_at, 'Asia/Karachi')}).`,
    v.userId
  );
  return ok(row);
});

/** PATCH /api/projects/{id}/meetings { id, title?, starts_at?, duration_min?, location?, agenda?, outcome?, status? } */
export const PATCH = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const v = await getViewer(request);
  const p = await loadProject(Number(params.id), v);
  const b = await readJson(request);
  const mt = await queryOne<any>(`SELECT * FROM project_meetings WHERE id = $1 AND project_id = $2`, [Number(b.id), p.id]);
  if (!mt) throw new HttpError(404, 'Meeting not found');
  const fields = ['title', 'kind', 'starts_at', 'duration_min', 'location', 'agenda', 'outcome', 'status'].filter((k) => k in b);
  if (!fields.length) throw new HttpError(400, 'Nothing to update');
  if ('status' in b && !['scheduled', 'done', 'cancelled'].includes(b.status)) throw new HttpError(400, 'Unknown meeting status');
  const vals = fields.map((k) => (b[k] === '' ? null : k === 'starts_at' ? new Date(b[k]).toISOString() : b[k]));
  vals.push(mt.id);
  const row = await queryOne<any>(
    `UPDATE project_meetings SET ${fields.map((k, i) => `${k} = $${i + 1}`).join(', ')} WHERE id = $${vals.length} RETURNING *`,
    vals
  );
  const tz = p.client_timezone || 'America/New_York';
  if ('status' in b && b.status !== mt.status) {
    await systemMessage(p.id, `${v.name} marked the meeting “${mt.title}” as ${b.status}${b.outcome ? `. Notes: ${String(b.outcome).slice(0, 500)}` : '.'}`, v.userId);
  } else if ('starts_at' in b && new Date(b.starts_at).getTime() !== new Date(mt.starts_at).getTime()) {
    await systemMessage(p.id, `${v.name} moved the meeting “${mt.title}” to ${fmtWhen(row.starts_at, tz)}.`, v.userId);
  }
  return ok(row);
});

/** DELETE /api/projects/{id}/meetings?meeting_id= */
export const DELETE = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const v = await getViewer(request);
  const p = await loadProject(Number(params.id), v);
  const id = Number(new URL(request.url).searchParams.get('meeting_id'));
  const rows = await query<{ title: string }>(`DELETE FROM project_meetings WHERE id = $1 AND project_id = $2 RETURNING title`, [id, p.id]);
  if (!rows.length) throw new HttpError(404, 'Meeting not found');
  await systemMessage(p.id, `${v.name} removed the meeting “${rows[0].title}”.`, v.userId);
  return ok({ deleted: id });
});
