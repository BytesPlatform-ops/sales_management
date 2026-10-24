import { NextRequest } from 'next/server';
import { queryOne } from '@/lib/db';
import { getAuth, handler, ok, readJson, HttpError } from '@/lib/training/http';
import { submitAttempt } from '@/lib/training/attempts';

export const dynamic = 'force-dynamic';

/**
 * PUT /api/training/attempts/{id} — submit answers → score, pass/fail, unlocks.
 * quiz/exam: { answers: { [questionId]: displayIndex | displayIndex[] | text } }
 * classification drill: { items: [{ id, service, reason }] }
 * objection drill: { items: [{ id, reply, self_score? }] }
 */
export const PUT = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const auth = await getAuth(request);
  const body = await readJson(request);
  return ok(await submitAttempt(auth.userId, Number(params.id), body));
});

/** GET /api/training/attempts/{id} — a finished attempt's results. */
export const GET = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const auth = await getAuth(request);
  const a = await queryOne<any>(`SELECT * FROM training_attempts WHERE id = $1`, [Number(params.id)]);
  if (!a || (Number(a.user_id) !== auth.userId && auth.role !== 'hr')) throw new HttpError(404, 'Attempt not found');
  if (!a.finished_at && auth.role !== 'hr') throw new HttpError(400, 'Attempt not submitted yet');
  return ok({ id: a.id, lesson_id: a.lesson_id, started_at: a.started_at, finished_at: a.finished_at, score_pct: Number(a.score_pct), passed: a.passed, results: a.result_json?.items || [] });
});
