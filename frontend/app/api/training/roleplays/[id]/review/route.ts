import { NextRequest } from 'next/server';
import { queryOne } from '@/lib/db';
import { handler, ok, readJson, requireHr, HttpError } from '@/lib/training/http';
import { trainerScore, confirmRoleplay } from '@/lib/training/call-reviews';
import { evaluateProgress } from '@/lib/training/progress';
import { evaluateBadges } from '@/lib/training/badges';
import { notify } from '@/lib/training/events';

export const dynamic = 'force-dynamic';

/**
 * POST /api/training/roleplays/{id}/review (trainer)
 *   { confirm: true, comment? }                       accept the AI score (human-reviewed)
 *   { criteria: [{id, points}], auto_fail?, comment? } override / grade manually
 */
export const POST = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const auth = await requireHr(request);
  const id = Number(params.id);
  const s = await queryOne<any>(`SELECT id, user_id, final_score FROM training_roleplay_sessions WHERE id = $1`, [id]);
  if (!s) throw new HttpError(404, 'Session not found');
  const b = await readJson(request);

  let card = null;
  if (b.confirm) {
    if (s.final_score === null) throw new HttpError(400, 'Nothing to confirm — grade it with the rubric');
    await confirmRoleplay(id, auth.userId, b.comment);
  } else {
    card = await trainerScore('roleplay', id, auth.userId, b);
  }
  await notify(Number(s.user_id), 'review', `Your trainer reviewed roleplay #${id}${card ? ` (${card.total}/100)` : ''}.`, `/agent/training/roleplay/${id}`);
  const certs = await evaluateProgress(Number(s.user_id));
  await evaluateBadges(Number(s.user_id));
  return ok({ reviewed: id, card, new_certifications: certs });
});
