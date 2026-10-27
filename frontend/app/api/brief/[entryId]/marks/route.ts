import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { entryCtx, onClarificationRequested, onClarificationResolved } from '@/lib/brief/core';
import { canAddBrief, canMarkBrief } from '@/lib/brief/rules';
import { notify } from '@/lib/notifications';
import { str } from '@/lib/tickets/input';

export const dynamic = 'force-dynamic';
type Ctx = { params: { entryId: string } };

/**
 * POST /api/brief/{entryId}/marks
 *   { kind: 'seen' }                                   developers / HR: "I've seen this"
 *   { kind: 'need_clarification', comment }            developers / HR: ask the agent; they're notified
 *   { kind: 'resolve', mark_id, resolution }           the client's agent / HR answers a clarification
 */
export const POST = handler(async (request: NextRequest, { params }: Ctx) => {
  const ctx = await entryCtx(request, Number(params.entryId));
  const { entry: e, actor, project, viewer } = ctx;
  const b = await readJson(request);

  if (b.kind === 'resolve') {
    if (!canAddBrief(actor)) throw new HttpError(403, 'Only the client’s agent or HR can answer');
    const resolution = str(b.resolution, 'Answer', 5000, true)!;
    const mark = await queryOne<{ id: number; user_id: string }>(
      `UPDATE brief_entry_marks SET resolved_at = NOW(), resolved_by = $3, resolution = $4
        WHERE id = $1 AND entry_id = $2 AND kind = 'need_clarification' AND resolved_at IS NULL RETURNING id, user_id`,
      [Number(b.mark_id), e.id, viewer.userId, resolution]
    );
    if (!mark) throw new HttpError(404, 'No open question with that id');
    await onClarificationResolved(mark.id);
    await notify({
      users: [Number(mark.user_id)], actorId: viewer.userId, type: 'brief_clarified',
      body: `${viewer.name} answered your question on ${project.ticket_no}: ${resolution.slice(0, 200)}`,
      link: `/projects/${project.id}?tab=brief#brief-${e.id}`, projectId: project.id,
    });
    return ok({ id: mark.id, resolved: true });
  }

  if (!canMarkBrief(actor)) throw new HttpError(403, 'Only the project’s developers or HR can mark brief updates');
  if (b.kind === 'seen') {
    await query(`INSERT INTO brief_entry_marks (entry_id, user_id, kind) VALUES ($1, $2, 'seen') ON CONFLICT DO NOTHING`, [e.id, viewer.userId]);
    return ok({ seen: true });
  }
  if (b.kind === 'need_clarification') {
    const comment = str(b.comment, 'Question', 5000, true)!;
    const mark = await queryOne<{ id: number }>(
      `INSERT INTO brief_entry_marks (entry_id, user_id, kind, comment) VALUES ($1, $2, 'need_clarification', $3) RETURNING id`,
      [e.id, viewer.userId, comment]
    );
    await onClarificationRequested(ctx, e, mark!.id, comment);
    return ok({ id: mark!.id });
  }
  throw new HttpError(400, 'kind must be seen, need_clarification or resolve');
});

/** DELETE /api/brief/{entryId}/marks — take back your own "seen". */
export const DELETE = handler(async (request: NextRequest, { params }: Ctx) => {
  const { entry: e, viewer } = await entryCtx(request, Number(params.entryId));
  await query(`DELETE FROM brief_entry_marks WHERE entry_id = $1 AND user_id = $2 AND kind = 'seen'`, [e.id, viewer.userId]);
  return ok({ seen: false });
});
