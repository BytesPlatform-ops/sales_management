import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { entryCtx, touchActivity } from '@/lib/brief/core';
import { briefEditMode, canEditBrief, cleanTags, isBriefType } from '@/lib/brief/rules';
import { str } from '@/lib/tickets/input';

export const dynamic = 'force-dynamic';
type Ctx = { params: { entryId: string } };

/**
 * PATCH /api/brief/{entryId} { body?, type?, tags? } — the author or HR.
 * Within 24h the text is replaced in place; after that the edit becomes a new version.
 * The previous text is always kept in history.
 */
export const PATCH = handler(async (request: NextRequest, { params }: Ctx) => {
  const { entry: e, actor, project } = await entryCtx(request, Number(params.entryId));
  if (!canEditBrief(actor, e)) throw new HttpError(403, 'Only the author or HR can edit this');
  if (e.is_original && actor.role !== 'hr' && Number(project.created_by) !== actor.userId) throw new HttpError(403, 'Not allowed');
  const b = await readJson(request);
  const body = b.body !== undefined ? str(b.body, 'Text', 50_000) ?? '' : e.body;
  const type = b.type !== undefined ? (isBriefType(b.type) ? b.type : (() => { throw new HttpError(400, 'Unknown type'); })()) : e.type;
  const tags = b.tags !== undefined ? cleanTags(b.tags) : e.tags;
  if (body === e.body && type === e.type && JSON.stringify(tags) === JSON.stringify(e.tags)) return ok({ id: e.id, version: e.version });

  const mode = briefEditMode(e.created_at);
  await query(`INSERT INTO brief_entry_versions (entry_id, version, type, body, tags, edited_by) VALUES ($1, $2, $3, $4, $5, $6)`,
    [e.id, e.version, e.type, e.body, e.tags, actor.userId]);
  const rows = await query<{ version: number }>(
    `UPDATE brief_entries SET body = $2, type = $3, tags = $4, edited_at = NOW(), edited_by = $5,
            version = version + $6 WHERE id = $1 RETURNING version`,
    [e.id, body, type, tags, actor.userId, mode === 'new_version' ? 1 : 0]
  );
  // The original brief mirrors the project description shown on the details card.
  if (e.is_original && body !== e.body) await query(`UPDATE projects SET description = $2, updated_at = NOW() WHERE id = $1`, [project.id, body]);
  await touchActivity(project.id);
  return ok({ id: e.id, version: rows[0].version, mode });
});

/** DELETE /api/brief/{entryId} — the author or HR; soft delete (HR can restore). The original brief can't be deleted. */
export const DELETE = handler(async (request: NextRequest, { params }: Ctx) => {
  const { entry: e, actor } = await entryCtx(request, Number(params.entryId));
  if (!canEditBrief(actor, e)) throw new HttpError(403, 'Only the author or HR can delete this');
  if (e.is_original) throw new HttpError(400, 'The original brief can’t be deleted — edit it instead');
  await query(`UPDATE brief_entries SET deleted_at = NOW(), deleted_by = $2 WHERE id = $1`, [e.id, actor.userId]);
  return ok({ deleted: e.id });
});
