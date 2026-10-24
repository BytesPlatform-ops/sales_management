/**
 * Attempts for quiz / exam / drill lessons (B.7 POST /lessons/{id}/attempts,
 * PUT /attempts/{id}). Unlimited retakes with a cooldown after a fail; question
 * sets are re-drawn and shuffled every attempt.
 */
import { query, queryOne } from '@/lib/db';
import { HttpError } from './http';
import { getSettings } from './settings';
import { drawQuestions, gradeOne, loadQuestions, toPublic, ServedQuestion, shuffle } from './quiz';
import { chatJSON, aiStatus, AiUnavailableError } from './ai';
import { SERVICE_LABELS } from './classify';
import { assertLessonUnlocked, evaluateProgress, markLessonComplete, LessonRow } from './progress';
import { evaluateBadges } from './badges';

export async function getLesson(id: number): Promise<LessonRow> {
  const l = await queryOne<LessonRow>(`SELECT * FROM training_lessons WHERE id = $1`, [id]);
  if (!l) throw new HttpError(404, 'Lesson not found');
  return l;
}

// ------------------------------------------------------------------ drill item builders

export async function classificationItems(count: number) {
  const rows = await query<any>(`SELECT * FROM training_classification_items WHERE active`);
  return shuffle(rows).slice(0, count);
}

export function publicClassificationItem(r: any) {
  return {
    kind: 'classification', id: r.id, firm_name: r.firm_name, narrative: r.narrative, city_state: r.city_state,
    website_url: r.website_url, scan_summary: r.scan_summary, scan_flags: r.scan_flags,
  };
}

export async function objectionItems(count: number) {
  const rows = await query<any>(`SELECT * FROM training_objections WHERE active ORDER BY num`);
  // Weight towards the top five (74% of all objections per D.11) but cover the library.
  const top = shuffle(rows.filter((r) => r.num <= 5));
  const rest = shuffle(rows.filter((r) => r.num > 5));
  return shuffle([...top.slice(0, Math.ceil(count / 2)), ...rest].slice(0, count));
}

export function publicObjectionItem(r: any) {
  return { kind: 'objection', id: r.id, num: r.num, objection: r.objection };
}

export const SERVICE_OPTIONS = Object.entries(SERVICE_LABELS).map(([value, label]) => ({ value, label }));

// ------------------------------------------------------------------ grading helpers

export async function gradeObjectionReply(userId: number, objection: any, reply: string, selfScore?: number) {
  const modelAnswers: string[] = objection.responses_json || [];
  try {
    const r = await chatJSON<{ score: number; missing_steps: string[]; better_line: string; feedback: string }>({
      feature: 'drill', userId, promptKey: 'objection_drill_grade',
      vars: { objection: objection.objection, model_answers: modelAnswers.join(' | '), answer: reply },
      maxTokens: 250,
    });
    return {
      score: Math.max(0, Math.min(10, Math.round(Number(r.data.score) || 0))),
      missing_steps: r.data.missing_steps || [], better_line: r.data.better_line, feedback: r.data.feedback,
      model_answers: modelAnswers, engine: 'ai' as const,
    };
  } catch (err) {
    if (!(err instanceof AiUnavailableError)) throw err;
    // E.4 fallback: the rep self-rates against the model answer.
    const score = Math.max(0, Math.min(10, Math.round(Number(selfScore) || 0)));
    return {
      score, missing_steps: [], better_line: objection.quick_response || modelAnswers[0] || '',
      feedback: 'Self-rated against the model answers (standard mode).', model_answers: modelAnswers, engine: 'self' as const,
    };
  }
}

// ------------------------------------------------------------------ start / submit

export async function startAttempt(userId: number, lessonId: number) {
  const lesson = await getLesson(lessonId);
  if (!['quiz', 'exam', 'drill'].includes(lesson.type)) throw new HttpError(400, 'This lesson has no attempts');

  const view = await assertLessonUnlocked(userId, lessonId);
  if (!view || !view.unlocked) throw new HttpError(403, view?.lock_hint || 'Lesson is locked');

  const settings = await getSettings();
  const lastFail = await queryOne<{ finished_at: string }>(
    `SELECT finished_at FROM training_attempts WHERE user_id = $1 AND lesson_id = $2 AND finished_at IS NOT NULL
     ORDER BY finished_at DESC LIMIT 1`,
    [userId, lessonId]
  );
  const lastWasFail = lastFail && !(await queryOne(
    `SELECT 1 FROM training_attempts WHERE user_id = $1 AND lesson_id = $2 AND finished_at = $3 AND passed`,
    [userId, lessonId, lastFail.finished_at]
  ));
  if (lastWasFail) {
    const until = new Date(new Date(lastFail!.finished_at).getTime() + settings.quiz_cooldown_minutes * 60_000);
    if (until > new Date()) {
      throw new HttpError(429, `Cooldown: you can retake this at ${until.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}. Review the lesson meanwhile.`);
    }
  }

  // Resume an unfinished, unexpired attempt instead of re-drawing.
  const open = await queryOne<any>(
    `SELECT * FROM training_attempts WHERE user_id = $1 AND lesson_id = $2 AND finished_at IS NULL
       AND (expires_at IS NULL OR expires_at > NOW()) ORDER BY started_at DESC LIMIT 1`,
    [userId, lessonId]
  );
  const attempt = open || (await createAttempt(userId, lesson));
  return { attempt: await publicAttempt(attempt, lesson), lesson: { id: lesson.id, code: lesson.code, title: lesson.title, type: lesson.type, pass_pct: lesson.pass_pct, config: lesson.config } };
}

async function createAttempt(userId: number, lesson: LessonRow) {
  const cfg = lesson.config || {};
  let served: any[] = [];
  let expiresAt: string | null = null;

  if (lesson.type === 'drill' && cfg.kind === 'classification') {
    served = (await classificationItems(Number(cfg.count || 10))).map((r) => ({ kind: 'classification', id: r.id }));
  } else if (lesson.type === 'drill' && cfg.kind === 'objection') {
    served = (await objectionItems(Number(cfg.count || 10))).map((r) => ({ kind: 'objection', id: r.id }));
  } else {
    served = await drawQuestions(lesson);
    if (lesson.type === 'exam' && cfg.time_limit_min) {
      expiresAt = new Date(Date.now() + Number(cfg.time_limit_min) * 60_000).toISOString();
    }
  }
  if (served.length === 0) throw new HttpError(409, 'No questions are loaded for this lesson yet — ask your trainer');

  return queryOne<any>(
    `INSERT INTO training_attempts (user_id, lesson_id, questions_json, expires_at) VALUES ($1, $2, $3::jsonb, $4) RETURNING *`,
    [userId, lesson.id, JSON.stringify(served), expiresAt]
  );
}

async function publicAttempt(attempt: any, lesson: LessonRow) {
  const served: any[] = attempt.questions_json || [];
  let items: any[] = [];
  if (lesson.type === 'drill' && lesson.config?.kind === 'classification') {
    const rows = await query<any>(`SELECT * FROM training_classification_items WHERE id = ANY($1::int[])`, [served.map((s) => s.id)]);
    const map = new Map(rows.map((r) => [r.id, r]));
    items = served.map((s) => map.get(s.id)).filter(Boolean).map(publicClassificationItem);
  } else if (lesson.type === 'drill' && lesson.config?.kind === 'objection') {
    const rows = await query<any>(`SELECT * FROM training_objections WHERE id = ANY($1::int[])`, [served.map((s) => s.id)]);
    const map = new Map(rows.map((r) => [r.id, r]));
    items = served.map((s) => map.get(s.id)).filter(Boolean).map(publicObjectionItem);
  } else {
    const qs = await loadQuestions(served.map((s: ServedQuestion) => s.id));
    items = served.map((s: ServedQuestion) => qs.get(s.id)).filter(Boolean).map((q, i) => toPublic(q!, served[i].perm));
  }
  const ai = lesson.type === 'drill' && lesson.config?.kind === 'objection' ? await aiStatus(attempt.user_id) : null;
  return {
    id: attempt.id, lesson_id: attempt.lesson_id, started_at: attempt.started_at, expires_at: attempt.expires_at,
    finished_at: attempt.finished_at, items, service_options: lesson.config?.kind === 'classification' ? SERVICE_OPTIONS : undefined,
    ai_available: ai ? ai.available : undefined, ai_message: ai && !ai.available ? ai.message : undefined,
  };
}

/** For self-rating in standard mode the client needs the model answer before rating. */
export async function objectionModelAnswer(attemptId: number, userId: number, objectionId: number) {
  const attempt = await queryOne<any>(`SELECT * FROM training_attempts WHERE id = $1 AND user_id = $2`, [attemptId, userId]);
  if (!attempt) throw new HttpError(404, 'Attempt not found');
  if (!(attempt.questions_json || []).some((s: any) => s.kind === 'objection' && s.id === objectionId)) throw new HttpError(400, 'Not in this drill');
  const o = await queryOne<any>(`SELECT * FROM training_objections WHERE id = $1`, [objectionId]);
  return { objection: o.objection, principle: o.principle, why: o.why_they_say_it, responses: o.responses_json, quick_response: o.quick_response };
}

export async function submitAttempt(userId: number, attemptId: number, answers: any) {
  const attempt = await queryOne<any>(`SELECT * FROM training_attempts WHERE id = $1`, [attemptId]);
  if (!attempt || Number(attempt.user_id) !== userId) throw new HttpError(404, 'Attempt not found');
  if (attempt.finished_at) throw new HttpError(400, 'Attempt already submitted');
  const lesson = await getLesson(attempt.lesson_id);
  const served: any[] = attempt.questions_json || [];
  const late = attempt.expires_at && Date.now() > new Date(attempt.expires_at).getTime() + 120_000;

  let results: any[] = [];
  let scorePct = 0;

  if (lesson.type === 'drill' && lesson.config?.kind === 'classification') {
    const rows = await query<any>(`SELECT * FROM training_classification_items WHERE id = ANY($1::int[])`, [served.map((s) => s.id)]);
    const map = new Map(rows.map((r) => [r.id, r]));
    const byId = new Map<number, any>((answers?.items || []).map((a: any) => [Number(a.id), a]));
    results = served.map((s) => {
      const item = map.get(s.id);
      const a = byId.get(s.id) || {};
      const correct = !!item && (a.service === item.correct_service || (item.acceptable_services || []).includes(a.service));
      return {
        kind: 'classification', id: s.id, correct, answer: a.service || null, reason_given: a.reason || '',
        correct_service: item?.correct_service, correct_label: SERVICE_LABELS[item?.correct_service as keyof typeof SERVICE_LABELS] || item?.correct_service,
        acceptable_services: item?.acceptable_services || [], explanation: item?.reason,
      };
    });
    scorePct = (results.filter((r) => r.correct).length / Math.max(1, results.length)) * 100;
  } else if (lesson.type === 'drill' && lesson.config?.kind === 'objection') {
    const rows = await query<any>(`SELECT * FROM training_objections WHERE id = ANY($1::int[])`, [served.map((s) => s.id)]);
    const map = new Map(rows.map((r) => [r.id, r]));
    const byId = new Map<number, any>((answers?.items || []).map((a: any) => [Number(a.id), a]));
    results = [];
    for (const s of served) {
      const o = map.get(s.id);
      const a = byId.get(s.id) || {};
      const graded = o && String(a.reply || '').trim()
        ? await gradeObjectionReply(userId, o, String(a.reply), a.self_score)
        : { score: 0, missing_steps: ['acknowledge', 'clarify', 'isolate', 'respond', 're_ask'], better_line: o?.quick_response || '', feedback: 'No reply given.', model_answers: o?.responses_json || [], engine: 'none' };
      results.push({ kind: 'objection', objection_id: s.id, id: s.id, objection: o?.objection, reply: a.reply || '', ...graded });
    }
    scorePct = (results.reduce((sum, r) => sum + r.score, 0) / Math.max(1, results.length)) * 10;
  } else {
    const qs = await loadQuestions(served.map((s: ServedQuestion) => s.id));
    const given = answers?.answers || {};
    for (const s of served as ServedQuestion[]) {
      const q = qs.get(s.id);
      if (!q) continue;
      results.push({ ...(await gradeOne(q, s.perm, given[s.id], userId)), answer: given[s.id] ?? null });
    }
    scorePct = (results.filter((r) => r.correct).length / Math.max(1, results.length)) * 100;
  }

  scorePct = Math.round(scorePct * 100) / 100;
  const passed = !late && scorePct >= lesson.pass_pct;

  await query(
    `UPDATE training_attempts SET finished_at = NOW(), answers_json = $2::jsonb, result_json = $3::jsonb, score_pct = $4, passed = $5 WHERE id = $1`,
    [attemptId, JSON.stringify(answers || {}), JSON.stringify({ items: results, late: !!late }), scorePct, passed]
  );
  if (passed) await markLessonComplete(userId, lesson.id, scorePct);

  const certs = await evaluateProgress(userId);
  const badges = await evaluateBadges(userId);
  const settings = await getSettings();
  return {
    attempt_id: attemptId, score_pct: scorePct, passed, pass_pct: lesson.pass_pct, late: !!late, results,
    new_certifications: certs, new_badges: badges,
    retake_after: passed ? null : new Date(Date.now() + settings.quiz_cooldown_minutes * 60_000).toISOString(),
  };
}
