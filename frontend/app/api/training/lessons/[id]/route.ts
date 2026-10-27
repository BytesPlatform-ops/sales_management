import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { getAuth, handler, ok, readJson, requireHr, HttpError } from '@/lib/training/http';
import { assertLessonUnlocked } from '@/lib/training/progress';
import { deckCards } from '@/lib/training/daily';
import { aiStatus } from '@/lib/training/ai';

export const dynamic = 'force-dynamic';

/** GET /api/training/lessons/{id} — lesson player payload. Reps only see unlocked lessons. */
export const GET = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const auth = await getAuth(request);
  const id = Number(params.id);
  const lesson = await queryOne<any>(
    `SELECT l.*, c.code AS course_code, c.title AS course_title, t.code AS track_code, t.title AS track_title
     FROM training_lessons l JOIN training_courses c ON c.id = l.course_id JOIN training_tracks t ON t.id = c.track_id
     WHERE l.id = $1`,
    [id]
  );
  if (!lesson || (!lesson.published && auth.role !== 'hr')) throw new HttpError(404, 'Lesson not found');

  let view: any = null;
  if (auth.role !== 'hr') {
    view = await assertLessonUnlocked(auth.userId, id);
    if (!view?.unlocked) throw new HttpError(403, view?.lock_hint || 'This lesson is locked');
    // Opening a lesson marks it in progress (also unlocks its flashcards for review) — not in view-as.
    if (!auth.readonly) await query(
      `INSERT INTO training_lesson_progress (user_id, lesson_id, status) VALUES ($1, $2, 'in_progress') ON CONFLICT DO NOTHING`,
      [auth.userId, id]
    );
  }

  const extra: Record<string, unknown> = {};
  if (lesson.type === 'flashcard_deck') extra.cards = await deckCards(id);
  if (lesson.type === 'roleplay') {
    const codes: string[] = lesson.config?.scenario_codes || [];
    extra.scenarios = await query(
      `SELECT id, code, title, objective, difficulty, exam_kind, persona_json->>'firm_type' AS firm_type, persona_json->>'state' AS state
       FROM training_roleplay_scenarios WHERE active AND ($1::text[] = '{}' OR code = ANY($1::text[])) ORDER BY code`,
      [codes]
    );
    extra.my_sessions = auth.role === 'hr' ? [] : await query(
      `SELECT s.id, sc.code AS scenario_code, s.final_score, s.status, s.human_reviewed, s.engine, s.started_at
       FROM training_roleplay_sessions s LEFT JOIN training_roleplay_scenarios sc ON sc.id = s.scenario_id
       WHERE s.user_id = $1 AND (s.lesson_id = $2 OR sc.code = ANY($3::text[])) ORDER BY s.started_at DESC LIMIT 20`,
      [auth.userId, id, codes]
    );
    extra.ai = await aiStatus(auth.userId);
  }
  if (['quiz', 'exam', 'drill'].includes(lesson.type) && auth.role !== 'hr') {
    extra.attempts = await query(
      `SELECT id, started_at, finished_at, score_pct, passed FROM training_attempts WHERE user_id = $1 AND lesson_id = $2 ORDER BY started_at DESC LIMIT 10`,
      [auth.userId, id]
    );
    if (lesson.type !== 'drill') {
      const n = await queryOne<{ n: string }>(`SELECT COUNT(*) AS n FROM training_quiz_questions WHERE lesson_id = $1 AND active`, [id]);
      extra.question_count = lesson.type === 'exam'
        ? Object.values(lesson.config?.draw_tags || {}).reduce((s: number, v: any) => s + Number(v), 0)
        : Number(n?.n || 0);
    }
  }

  // Previous / next lesson in the same course for navigation.
  const siblings = await query<any>(
    `SELECT id, title, sort_order FROM training_lessons WHERE course_id = $1 AND published ORDER BY sort_order, id`,
    [lesson.course_id]
  );
  const idx = siblings.findIndex((s) => s.id === id);

  return ok({
    lesson, status: view ? { completed: view.completed, best_score: view.best_score, cooldown_until: view.cooldown_until } : null,
    prev: idx > 0 ? siblings[idx - 1] : null, next: idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null,
    ...extra,
  });
});

/** PUT /api/training/lessons/{id} (trainer) — edits the draft; publish to version it. */
export const PUT = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  await requireHr(request);
  const b = await readJson(request);
  const fields: [string, any, string?][] = [
    ['title', b.title], ['body_md', b.body_md], ['media_url', b.media_url], ['est_minutes', b.est_minutes],
    ['sort_order', b.sort_order], ['required', b.required], ['pass_pct', b.pass_pct], ['type', b.type],
    ['config', b.config === undefined ? undefined : JSON.stringify(b.config), '::jsonb'], ['published', b.published],
    ['course_id', b.course_id], ['code', b.code],
  ];
  const set = fields.filter(([, v]) => v !== undefined);
  if (!set.length) throw new HttpError(400, 'Nothing to update');
  const vals = set.map(([, v]) => v);
  vals.push(Number(params.id));
  const row = await queryOne(
    `UPDATE training_lessons SET ${set.map(([k, , cast], i) => `${k} = $${i + 1}${cast || ''}`).join(', ')}, updated_at = NOW()
     WHERE id = $${vals.length} RETURNING *`,
    vals
  );
  if (!row) throw new HttpError(404, 'Lesson not found');
  return ok(row);
});

/** DELETE /api/training/lessons/{id} (trainer) — unpublishes if reps have progress, else deletes. */
export const DELETE = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  await requireHr(request);
  const id = Number(params.id);
  const used = await queryOne(
    `SELECT 1 FROM training_lesson_progress WHERE lesson_id = $1 UNION SELECT 1 FROM training_attempts WHERE lesson_id = $1 LIMIT 1`,
    [id]
  );
  if (used) {
    await query(`UPDATE training_lessons SET published = false, updated_at = NOW() WHERE id = $1`, [id]);
    return ok({ unpublished: id, note: 'Reps have progress on this lesson, so it was unpublished instead of deleted.' });
  }
  await query(`DELETE FROM training_lessons WHERE id = $1`, [id]);
  return ok({ deleted: id });
});
