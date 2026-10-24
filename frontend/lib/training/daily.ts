/**
 * "Today" screen data: flashcard queue (SM-2) and the 5-minute daily drill
 * (E.9): 3 flashcards due + 2 objection drills + 1 "classify this SAM row" +
 * 1 tonality recording (AI-rated from the transcript, or self-rated).
 */
import { query, queryOne } from '@/lib/db';
import { HttpError } from './http';
import { nextReview, ReviewResult } from './srs';
import { classificationItems, objectionItems, publicClassificationItem, publicObjectionItem, gradeObjectionReply, SERVICE_OPTIONS } from './attempts';
import { SERVICE_LABELS } from './classify';
import { evaluateBadges } from './badges';

/** PKT calendar date — reps work night shifts, the drill day follows Karachi time. */
export function todayPKT(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date());
}

/**
 * Cards due now. Cards from decks the rep has unlocked (completed or opened)
 * enter the queue as "new" up to `newLimit` per call.
 */
export async function dueFlashcards(userId: number, limit = 20, newLimit = 10) {
  const due = await query<any>(
    `SELECT f.id, f.front, f.back, f.tags, l.code AS deck_code, l.title AS deck_title, r.due_at, r.repetitions, r.interval_days
     FROM training_flashcard_reviews r
     JOIN training_flashcards f ON f.id = r.flashcard_id
     JOIN training_lessons l ON l.id = f.deck_lesson_id
     WHERE r.user_id = $1 AND r.due_at <= NOW()
     ORDER BY r.due_at LIMIT $2`,
    [userId, limit]
  );
  let fresh: any[] = [];
  if (due.length < limit) {
    fresh = await query<any>(
      `SELECT f.id, f.front, f.back, f.tags, l.code AS deck_code, l.title AS deck_title, NULL AS due_at, 0 AS repetitions, 0 AS interval_days
       FROM training_flashcards f
       JOIN training_lessons l ON l.id = f.deck_lesson_id
       WHERE EXISTS (SELECT 1 FROM training_lesson_progress p WHERE p.user_id = $1 AND p.lesson_id = l.id)
         AND NOT EXISTS (SELECT 1 FROM training_flashcard_reviews r WHERE r.user_id = $1 AND r.flashcard_id = f.id)
       ORDER BY l.sort_order, f.sort_order, f.id LIMIT $2`,
      [userId, Math.min(newLimit, limit - due.length)]
    );
  }
  const stats = await queryOne<any>(
    `SELECT COUNT(*) FILTER (WHERE due_at <= NOW()) AS due_total,
            COUNT(*) AS seen,
            COALESCE(SUM(good_count), 0) AS good, COALESCE(SUM(review_count), 0) AS reviews
     FROM training_flashcard_reviews WHERE user_id = $1`,
    [userId]
  );
  return {
    cards: [...due.map((c) => ({ ...c, is_new: false })), ...fresh.map((c) => ({ ...c, is_new: true }))],
    due_total: Number(stats?.due_total || 0),
    seen: Number(stats?.seen || 0),
    retention_pct: Number(stats?.reviews) ? Math.round((Number(stats.good) / Number(stats.reviews)) * 100) : null,
  };
}

/** Cards of one deck, for the deck lesson (the rep studies the whole deck once). */
export async function deckCards(deckLessonId: number) {
  return query<any>(`SELECT id, front, back, tags FROM training_flashcards WHERE deck_lesson_id = $1 ORDER BY sort_order, id`, [deckLessonId]);
}

export async function reviewFlashcard(userId: number, flashcardId: number, result: ReviewResult) {
  if (!['again', 'hard', 'good', 'easy'].includes(result)) throw new HttpError(400, 'result must be again|hard|good|easy');
  const card = await queryOne(`SELECT id FROM training_flashcards WHERE id = $1`, [flashcardId]);
  if (!card) throw new HttpError(404, 'Flashcard not found');
  const current = await queryOne<any>(
    `SELECT ease, interval_days, repetitions FROM training_flashcard_reviews WHERE user_id = $1 AND flashcard_id = $2`,
    [userId, flashcardId]
  );
  const next = nextReview(current || { ease: 2.5, interval_days: 0, repetitions: 0 }, result);
  const good = result === 'good' || result === 'easy' ? 1 : 0;
  await query(
    `INSERT INTO training_flashcard_reviews (user_id, flashcard_id, ease, interval_days, repetitions, due_at, last_result, review_count, good_count, last_reviewed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8, NOW())
     ON CONFLICT (user_id, flashcard_id) DO UPDATE SET
       ease = EXCLUDED.ease, interval_days = EXCLUDED.interval_days, repetitions = EXCLUDED.repetitions,
       due_at = EXCLUDED.due_at, last_result = EXCLUDED.last_result, last_reviewed_at = NOW(),
       review_count = training_flashcard_reviews.review_count + 1,
       good_count = training_flashcard_reviews.good_count + EXCLUDED.good_count`,
    [userId, flashcardId, next.ease, next.interval_days, next.repetitions, next.due_at.toISOString(), result, good]
  );
  await evaluateBadges(userId);
  return { flashcard_id: flashcardId, ...next, due_at: next.due_at.toISOString() };
}

// ------------------------------------------------------------------ daily drill

export async function getTodayDrill(userId: number) {
  const date = todayPKT();
  let row = await queryOne<any>(`SELECT * FROM training_drill_log WHERE user_id = $1 AND drill_date = $2`, [userId, date]);
  if (!row) {
    const cards = (await dueFlashcards(userId, 3, 3)).cards.slice(0, 3).map((c) => ({ kind: 'flashcard', id: c.id }));
    const objections = (await objectionItems(2)).map((o) => ({ kind: 'objection', id: o.id }));
    const cls = (await classificationItems(1)).map((c) => ({ kind: 'classification', id: c.id }));
    const items = [...cards, ...objections, ...cls, { kind: 'tonality', id: 0 }];
    row = await queryOne<any>(
      `INSERT INTO training_drill_log (user_id, drill_date, items_json) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (user_id, drill_date) DO UPDATE SET items_json = training_drill_log.items_json RETURNING *`,
      [userId, date, JSON.stringify(items)]
    );
  }
  return publicDrill(row);
}

async function publicDrill(row: any) {
  const items: any[] = row.items_json || [];
  const ids = (k: string) => items.filter((i) => i.kind === k).map((i) => i.id);
  const [cards, objections, cls] = await Promise.all([
    query<any>(`SELECT id, front, back FROM training_flashcards WHERE id = ANY($1::int[])`, [ids('flashcard')]),
    query<any>(`SELECT * FROM training_objections WHERE id = ANY($1::int[])`, [ids('objection')]),
    query<any>(`SELECT * FROM training_classification_items WHERE id = ANY($1::int[])`, [ids('classification')]),
  ]);
  const opener = 'Hi [First name], it’s [Your name] with Bytes Platform. How have you been? … The reason for my call is: we work with contractors registered on SAM.gov, and I was just looking at your website. Quick question: is it bringing you any work right now, or is it more of a business card?';
  return {
    // pg parses DATE as local midnight; send the plain YYYY-MM-DD (PKT drill day) instead.
    drill_date: row.drill_date instanceof Date
      ? `${row.drill_date.getFullYear()}-${String(row.drill_date.getMonth() + 1).padStart(2, '0')}-${String(row.drill_date.getDate()).padStart(2, '0')}`
      : String(row.drill_date).slice(0, 10),
    completed_at: row.completed_at,
    score_pct: row.score_pct === null ? null : Number(row.score_pct),
    results: row.results_json || {},
    items: items.map((i) => {
      if (i.kind === 'flashcard') return { kind: 'flashcard', ...(cards.find((c) => c.id === i.id) || { id: i.id }) };
      if (i.kind === 'objection') {
        const o = objections.find((x) => x.id === i.id);
        // Model answers are needed for self-rating in standard mode; the UI reveals them only after the rep replies.
        return o
          ? { ...publicObjectionItem(o), model_answers: o.responses_json || [], quick_response: o.quick_response, principle: o.principle }
          : { kind: 'objection', id: i.id };
      }
      if (i.kind === 'classification') {
        const c = cls.find((x) => x.id === i.id);
        return c ? publicClassificationItem(c) : { kind: 'classification', id: i.id };
      }
      return { kind: 'tonality', id: 0, script: opener, target_wpm: 140 };
    }),
    service_options: SERVICE_OPTIONS,
  };
}

const FILLERS = /\b(um+|uh+|like|you know|basically|actually|so yeah|kind of|sort of)\b/gi;

/** Words-per-minute + filler words from a tonality recording transcript (D.14). */
export function tonalityStats(transcript: string, seconds: number) {
  const words = transcript.trim().split(/\s+/).filter(Boolean).length;
  const wpm = seconds > 0 ? Math.round((words / seconds) * 60) : 0;
  const fillers = (transcript.match(FILLERS) || []).length;
  const pace = wpm === 0 ? 'unknown' : wpm < 120 ? 'a bit slow' : wpm <= 160 ? 'good (target ~140)' : 'too fast — slow down';
  return { words, wpm, fillers, pace };
}

/**
 * Submit one drill item. kind-specific payloads:
 *   flashcard: { result }                          (also updates SM-2)
 *   objection: { reply, self_score? }
 *   classification: { service, reason }
 *   tonality: { self_score } | { transcript, seconds } (from /drills/tonality upload)
 */
export async function submitDrillItem(userId: number, item: { kind: string; id: number }, payload: any) {
  const date = todayPKT();
  const row = await queryOne<any>(`SELECT * FROM training_drill_log WHERE user_id = $1 AND drill_date = $2`, [userId, date]);
  if (!row) throw new HttpError(400, 'Open today’s drill first');
  const items: any[] = row.items_json || [];
  if (!items.some((i) => i.kind === item.kind && Number(i.id) === Number(item.id))) throw new HttpError(400, 'Not part of today’s drill');
  const key = `${item.kind}:${item.id}`;
  let result: any;

  if (item.kind === 'flashcard') {
    const r = await reviewFlashcard(userId, Number(item.id), payload.result);
    result = { done: true, score: payload.result === 'good' || payload.result === 'easy' ? 1 : 0.5, next_due: r.due_at };
  } else if (item.kind === 'objection') {
    const o = await queryOne<any>(`SELECT * FROM training_objections WHERE id = $1`, [item.id]);
    const g = await gradeObjectionReply(userId, o, String(payload.reply || ''), payload.self_score);
    result = { ...g, done: true, score: g.score / 10, score_10: g.score };
  } else if (item.kind === 'classification') {
    const c = await queryOne<any>(`SELECT * FROM training_classification_items WHERE id = $1`, [item.id]);
    const correct = payload.service === c.correct_service || (c.acceptable_services || []).includes(payload.service);
    result = {
      done: true, score: correct ? 1 : 0, correct, correct_service: c.correct_service,
      correct_label: SERVICE_LABELS[c.correct_service as keyof typeof SERVICE_LABELS], explanation: c.reason,
    };
  } else if (item.kind === 'tonality') {
    if (payload.transcript) {
      const stats = tonalityStats(String(payload.transcript), Number(payload.seconds || 0));
      const paceOk = stats.wpm >= 115 && stats.wpm <= 165;
      result = { done: true, score: (paceOk ? 0.6 : 0.3) + (stats.fillers <= 1 ? 0.4 : stats.fillers <= 3 ? 0.2 : 0), ...stats, transcript: payload.transcript };
    } else {
      const self = Math.max(0, Math.min(10, Number(payload.self_score) || 0));
      result = { done: true, score: self / 10, self_rated: true };
    }
  } else {
    throw new HttpError(400, 'Unknown drill item');
  }

  const results = { ...(row.results_json || {}), [key]: result };
  const done = items.every((i) => results[`${i.kind}:${i.id}`]?.done);
  const scorePct = done
    ? Math.round((items.reduce((s, i) => s + Number(results[`${i.kind}:${i.id}`]?.score || 0), 0) / items.length) * 100)
    : null;
  await query(
    `UPDATE training_drill_log SET results_json = $3::jsonb, score_pct = $4, completed_at = CASE WHEN $5 THEN COALESCE(completed_at, NOW()) ELSE completed_at END
     WHERE user_id = $1 AND drill_date = $2`,
    [userId, date, JSON.stringify(results), scorePct, done]
  );
  if (done) await evaluateBadges(userId);
  return { item: key, result, drill_completed: done, score_pct: scorePct };
}
