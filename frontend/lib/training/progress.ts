/**
 * Learning path, unlock rules, gate evaluation and certification (B.4–B.6).
 *
 * Lock rules (defaults; gates are trainer-editable in training_gates):
 *  - lessons unlock in order inside a course
 *  - a course unlocks when the previous required course in its track is complete
 *    (each course ends with a quiz ≥80%)
 *  - Track 2 opens after C1–C3 (TRACK2_UNLOCK); its mindset course is open in parallel
 *  - certifications are granted automatically when their gate rule is met
 */
import { query, queryOne } from '@/lib/db';
import { emitEvent, notify, notifyTrainers } from './events';
import { getRampStatus, onLiveCallCertified, setPhase } from './ramp';
import { awardCertBadge } from './badges';
import { getSettings } from './settings';

export interface TrackRow { id: number; code: string; title: string; description: string | null; sort_order: number; is_placeholder: boolean; cert_code: string | null }
export interface CourseRow { id: number; track_id: number; code: string; title: string; description: string | null; sort_order: number; required: boolean; day_number: number | null }
export interface LessonRow {
  id: number; course_id: number; code: string; type: string; title: string; body_md: string; media_url: string | null;
  est_minutes: number; sort_order: number; required: boolean; pass_pct: number; config: any; version: number; published: boolean;
}

export interface Catalog { tracks: TrackRow[]; courses: CourseRow[]; lessons: LessonRow[] }

export async function loadCatalog(includeUnpublished = false): Promise<Catalog> {
  const [tracks, courses, lessons] = await Promise.all([
    query<TrackRow>(`SELECT * FROM training_tracks ORDER BY sort_order, id`),
    query<CourseRow>(`SELECT * FROM training_courses ORDER BY sort_order, id`),
    query<LessonRow>(
      `SELECT id, course_id, code, type, title, '' AS body_md, media_url, est_minutes, sort_order, required, pass_pct, config, version, published
       FROM training_lessons ${includeUnpublished ? '' : 'WHERE published'} ORDER BY sort_order, id`
    ),
  ]);
  return { tracks, courses, lessons };
}

export interface UserState {
  completed: Set<number>;                 // lesson ids
  bestScore: Map<number, number>;         // lesson id → best score_pct
  lastFail: Map<number, string>;          // lesson id → finished_at of latest failed attempt
  certs: Map<string, { granted_at: string; method: string }>;
  roleplays: { scenario_id: number | null; lesson_id: number | null; purpose: string; final_score: number | null; status: string; human_reviewed: boolean; exam_kind: string | null; scenario_code: string | null }[];
}

export async function loadUserState(userId: number): Promise<UserState> {
  const [progress, scores, fails, certs, roleplays] = await Promise.all([
    query<{ lesson_id: number }>(`SELECT lesson_id FROM training_lesson_progress WHERE user_id = $1 AND status = 'completed'`, [userId]),
    query<{ lesson_id: number; best: string }>(
      `SELECT lesson_id, MAX(score_pct) AS best FROM training_attempts WHERE user_id = $1 AND finished_at IS NOT NULL GROUP BY lesson_id`, [userId]),
    query<{ lesson_id: number; at: string }>(
      `SELECT DISTINCT ON (lesson_id) lesson_id, finished_at AS at, passed FROM training_attempts
       WHERE user_id = $1 AND finished_at IS NOT NULL ORDER BY lesson_id, finished_at DESC`, [userId]),
    query<{ code: string; granted_at: string; method: string }>(
      `SELECT code, granted_at, method FROM training_certifications WHERE user_id = $1 AND revoked_at IS NULL`, [userId]),
    query<any>(
      `SELECT s.scenario_id, s.lesson_id, s.purpose, s.final_score, s.status, s.human_reviewed, sc.exam_kind, sc.code AS scenario_code
       FROM training_roleplay_sessions s LEFT JOIN training_roleplay_scenarios sc ON sc.id = s.scenario_id
       WHERE s.user_id = $1 AND s.status IN ('scored', 'needs_review', 'reviewed')`, [userId]),
  ]);
  return {
    completed: new Set(progress.map((p) => p.lesson_id)),
    bestScore: new Map(scores.map((s) => [s.lesson_id, Number(s.best)])),
    lastFail: new Map(fails.filter((f: any) => f.passed === false).map((f) => [f.lesson_id, f.at])),
    certs: new Map(certs.map((c) => [c.code, { granted_at: c.granted_at, method: c.method }])),
    roleplays: roleplays.map((r) => ({ ...r, final_score: r.final_score === null ? null : Number(r.final_score) })),
  };
}

/** Roleplay lessons complete themselves from session results. */
function roleplayLessonComplete(lesson: LessonRow, state: UserState): boolean {
  const cfg = lesson.config || {};
  const codes: string[] = cfg.scenario_codes || [];
  const minScore = Number(cfg.min_score || 0);
  const need = Number(cfg.min_sessions || 1);
  const qualifying = state.roleplays.filter((r) =>
    (codes.length === 0 || (r.scenario_code && codes.includes(r.scenario_code)) || r.lesson_id === lesson.id) &&
    (cfg.purpose ? r.purpose === cfg.purpose : true) &&
    (r.final_score ?? 0) >= minScore);
  return qualifying.length >= need;
}

export function isLessonComplete(lesson: LessonRow, state: UserState): boolean {
  if (state.completed.has(lesson.id)) return true;
  if (lesson.type === 'roleplay') return roleplayLessonComplete(lesson, state);
  if (['quiz', 'exam', 'drill'].includes(lesson.type)) return (state.bestScore.get(lesson.id) ?? -1) >= lesson.pass_pct;
  return false;
}

// ------------------------------------------------------------------ gates

export interface GateRow { code: string; target_type: string; target_ref: string; rule_json: any; description: string | null; active: boolean }

export async function loadGates(): Promise<Map<string, GateRow>> {
  const rows = await query<GateRow>(`SELECT * FROM training_gates WHERE active`);
  return new Map(rows.map((g) => [g.code, g]));
}

export interface RequirementStatus { label: string; met: boolean; detail: string }

export function evaluateRule(rule: any, state: UserState, catalog: Catalog): { met: boolean; items: RequirementStatus[] } {
  const items: RequirementStatus[] = [];
  const lessonByCode = new Map(catalog.lessons.map((l) => [l.code, l]));
  const courseByCode = new Map(catalog.courses.map((c) => [c.code, c]));

  for (const req of rule?.requires || []) {
    if (req.lesson) {
      const lesson = lessonByCode.get(req.lesson);
      const best = lesson ? state.bestScore.get(lesson.id) : undefined;
      const min = Number(req.min_score ?? lesson?.pass_pct ?? 80);
      items.push({
        label: `${lesson?.title || req.lesson} ≥ ${min}%`,
        met: best !== undefined && best >= min,
        detail: best === undefined ? 'not attempted yet' : `best ${Math.round(best)}%`,
      });
    } else if (req.cert) {
      items.push({ label: req.cert.replace(/_/g, ' '), met: state.certs.has(req.cert), detail: state.certs.has(req.cert) ? 'earned' : 'not yet' });
    } else if (req.courses_completed) {
      for (const code of req.courses_completed as string[]) {
        const course = courseByCode.get(code);
        const lessons = catalog.lessons.filter((l) => l.course_id === course?.id && l.required);
        const done = lessons.filter((l) => isLessonComplete(l, state)).length;
        items.push({ label: `Complete ${course?.title || code}`, met: !!course && done === lessons.length, detail: `${done}/${lessons.length} lessons` });
      }
    } else if (req.roleplays) {
      const r = req.roleplays;
      const qualifying = state.roleplays.filter((s) =>
        (r.purpose ? s.purpose === r.purpose : true) &&
        (r.exam_kind ? s.exam_kind === r.exam_kind : true) &&
        (s.final_score ?? 0) >= Number(r.min_score || 0));
      const count = Number(r.count || 1);
      const human = qualifying.filter((s) => s.human_reviewed).length;
      const kinds: string[] = r.distinct_exam_kinds || [];
      const kindsMet = kinds.every((k) => qualifying.some((s) => s.exam_kind === k));
      const met = qualifying.length >= count && human >= Number(r.human_reviewed || 0) && kindsMet;
      const parts = [`${qualifying.length}/${count} scored ≥${r.min_score}`];
      if (r.human_reviewed) parts.push(`${human}/${r.human_reviewed} trainer-reviewed`);
      if (kinds.length) parts.push(`kinds: ${kinds.map((k) => `${k} ${qualifying.some((s) => s.exam_kind === k) ? '✓' : '✗'}`).join(', ')}`);
      items.push({
        label: `${count} ${r.purpose === 'exam' ? 'graded ' : ''}roleplay${count > 1 ? 's' : ''} ≥ ${r.min_score}/100${r.human_reviewed ? ` (${r.human_reviewed} human-reviewed)` : ''}`,
        met, detail: parts.join(' · '),
      });
    }
  }
  return { met: items.length > 0 && items.every((i) => i.met), items };
}

// ------------------------------------------------------------------ path

export interface LessonView extends Omit<LessonRow, 'body_md'> {
  completed: boolean; unlocked: boolean; best_score: number | null; lock_hint: string | null; cooldown_until: string | null;
}
export interface CourseView extends CourseRow { unlocked: boolean; completed: boolean; progress_pct: number; lock_hint: string | null; lessons: LessonView[] }
export interface TrackView extends TrackRow { unlocked: boolean; completed: boolean; progress_pct: number; lock_hint: string | null; courses: CourseView[]; cert: { code: string; earned: boolean; requirements: RequirementStatus[] } | null }

export async function buildPath(userId: number, cooldownMinutes = 10): Promise<{ tracks: TrackView[]; state: UserState; catalog: Catalog; gates: Map<string, GateRow> }> {
  const [catalog, state, gates] = await Promise.all([loadCatalog(), loadUserState(userId), loadGates()]);
  const t2Gate = gates.get('TRACK2_UNLOCK');
  const t2Rule = t2Gate ? evaluateRule(t2Gate.rule_json, state, catalog) : { met: true, items: [] };
  const alwaysOpen = new Set<string>(t2Gate?.rule_json?.always_open_courses || []);

  const tracks: TrackView[] = catalog.tracks.map((track) => {
    const trackGate = Array.from(gates.values()).find((g) => g.target_type === 'track' && g.target_ref === track.code);
    const trackRule = trackGate ? (trackGate.code === 'TRACK2_UNLOCK' ? t2Rule : evaluateRule(trackGate.rule_json, state, catalog)) : { met: true, items: [] };
    const courses = catalog.courses.filter((c) => c.track_id === track.id);
    let prevRequiredComplete = true;
    let prevTitle = '';

    const courseViews: CourseView[] = courses.map((course) => {
      const lessons = catalog.lessons.filter((l) => l.course_id === course.id);
      const openByGate = trackRule.met || alwaysOpen.has(course.code);
      const courseUnlocked = track.is_placeholder || (openByGate && (prevRequiredComplete || alwaysOpen.has(course.code)));
      let lockHint: string | null = null;
      if (!courseUnlocked) {
        lockHint = !openByGate
          ? `Unlock by: ${trackRule.items.filter((i) => !i.met).map((i) => i.label).join(', ')}`
          : `Unlock by passing the ${prevTitle} quiz (≥80%)`;
      }

      let prevLessonDone = true;
      const lessonViews: LessonView[] = lessons.map((lesson) => {
        const completed = isLessonComplete(lesson, state);
        const unlocked = courseUnlocked && (prevLessonDone || !lesson.required);
        const failAt = state.lastFail.get(lesson.id);
        const cooldownUntil = failAt && !completed
          ? new Date(new Date(failAt).getTime() + cooldownMinutes * 60_000)
          : null;
        const view: LessonView = {
          ...lesson, completed, unlocked,
          best_score: state.bestScore.has(lesson.id) ? Math.round(state.bestScore.get(lesson.id)!) : null,
          lock_hint: unlocked ? null : courseUnlocked ? 'Finish the previous lesson first' : lockHint,
          cooldown_until: cooldownUntil && cooldownUntil > new Date() ? cooldownUntil.toISOString() : null,
        };
        delete (view as any).body_md;
        if (lesson.required && !completed) prevLessonDone = false;
        return view;
      });

      const required = lessonViews.filter((l) => l.required);
      const done = required.filter((l) => l.completed).length;
      const completed = required.length > 0 && done === required.length;
      if (course.required) {
        prevRequiredComplete = completed;
        prevTitle = course.title;
      }
      return {
        ...course, unlocked: courseUnlocked, completed, lock_hint: lockHint,
        progress_pct: required.length ? Math.round((done / required.length) * 100) : 0, lessons: lessonViews,
      };
    });

    const reqCourses = courseViews.filter((c) => c.required && c.lessons.some((l) => l.required));
    const allReqLessons = reqCourses.flatMap((c) => c.lessons.filter((l) => l.required));
    const doneLessons = allReqLessons.filter((l) => l.completed).length;
    const certGate = track.cert_code ? gates.get(track.cert_code) : undefined;
    const certEval = certGate ? evaluateRule(certGate.rule_json, state, catalog) : null;

    return {
      ...track,
      unlocked: track.is_placeholder || trackRule.met || courseViews.some((c) => c.unlocked),
      completed: allReqLessons.length > 0 && doneLessons === allReqLessons.length,
      progress_pct: allReqLessons.length ? Math.round((doneLessons / allReqLessons.length) * 100) : 0,
      lock_hint: trackRule.met ? null : `Unlock by: ${trackRule.items.filter((i) => !i.met).map((i) => i.label).join(', ')}`,
      courses: courseViews,
      cert: track.cert_code ? { code: track.cert_code, earned: state.certs.has(track.cert_code), requirements: certEval?.items || [] } : null,
    };
  });

  return { tracks, state, catalog, gates };
}

/** Next lesson to do (first unlocked, incomplete, required). */
export function nextLesson(tracks: TrackView[]): LessonView | null {
  for (const t of tracks) for (const c of t.courses) for (const l of c.lessons) {
    if (l.unlocked && !l.completed && l.required) return l;
  }
  return null;
}

export async function assertLessonUnlocked(userId: number, lessonId: number) {
  const { tracks } = await buildPath(userId, (await getSettings()).quiz_cooldown_minutes);
  for (const t of tracks) for (const c of t.courses) for (const l of c.lessons) {
    if (l.id === lessonId) return l;
  }
  return null;
}

export async function markLessonComplete(userId: number, lessonId: number, score?: number) {
  await query(
    `INSERT INTO training_lesson_progress (user_id, lesson_id, status, best_score, completed_at)
     VALUES ($1, $2, 'completed', $3, CURRENT_TIMESTAMP)
     ON CONFLICT (user_id, lesson_id) DO UPDATE SET status = 'completed',
       best_score = GREATEST(COALESCE(training_lesson_progress.best_score, 0), COALESCE(EXCLUDED.best_score, 0)),
       completed_at = COALESCE(training_lesson_progress.completed_at, CURRENT_TIMESTAMP)`,
    [userId, lessonId, score ?? null]
  );
}

// ------------------------------------------------------------------ certifications

const CERT_ORDER = ['PRODUCT_CERT', 'LIVE_CALL_CERT', 'BYTESCON_CERT'];

export async function grantCertification(userId: number, code: string, method: 'auto' | 'manual', grantedBy: number | null, notes?: string) {
  const existing = await queryOne(`SELECT id FROM training_certifications WHERE user_id = $1 AND code = $2 AND revoked_at IS NULL`, [userId, code]);
  if (existing) return false;
  await query(
    `INSERT INTO training_certifications (code, user_id, granted_by, method, notes) VALUES ($1, $2, $3, $4, $5)`,
    [code, userId, grantedBy, method, notes ?? null]
  );
  await notify(userId, 'certified', `You earned ${code.replace(/_/g, ' ')}!`, '/agent/training');
  const user = await queryOne<{ full_name: string }>(`SELECT full_name FROM users WHERE id = $1`, [userId]);
  await notifyTrainers('certified', `${user?.full_name || 'A rep'} earned ${code.replace(/_/g, ' ')} (${method}).`, '/hr/training');
  await awardCertBadge(userId, code);
  if (code === 'LIVE_CALL_CERT') await onLiveCallCertified(userId);
  return true;
}

export async function revokeCertification(userId: number, code: string, by: number, notes?: string) {
  const res = await query(
    `UPDATE training_certifications SET revoked_at = CURRENT_TIMESTAMP, revoked_by = $3, notes = COALESCE($4, notes)
     WHERE user_id = $1 AND code = $2 AND revoked_at IS NULL RETURNING id`,
    [userId, code, by, notes ?? null]
  );
  if (res.length && code === 'LIVE_CALL_CERT') {
    // Quota credit stops until re-certified.
    await query(`UPDATE training_ramp_status SET certified_at = NULL, grandfathered = false WHERE user_id = $1`, [userId]);
    await setPhase(userId, 'TRAINING', `LIVE_CALL_CERT revoked${notes ? `: ${notes}` : ''}`);
  }
  return res.length > 0;
}

/**
 * Re-check every gate for a rep and grant anything newly earned. Also emits
 * training.track_completed once per track. Safe to call after any activity.
 */
export async function evaluateProgress(userId: number): Promise<string[]> {
  const granted: string[] = [];
  // Ensure ramp row exists (new reps start in TRAINING).
  await getRampStatus(userId);

  for (let pass = 0; pass < CERT_ORDER.length; pass++) {
    const [catalog, state, gates] = await Promise.all([loadCatalog(), loadUserState(userId), loadGates()]);
    let changed = false;
    for (const code of CERT_ORDER) {
      if (state.certs.has(code)) continue;
      const gate = gates.get(code);
      if (!gate) continue;
      if (evaluateRule(gate.rule_json, state, catalog).met) {
        if (await grantCertification(userId, code, 'auto', null)) {
          granted.push(code);
          changed = true;
        }
      }
    }
    if (!changed) break; // certs can unlock each other (PRODUCT → LIVE), loop until stable
  }

  const { tracks } = await buildPath(userId);
  for (const t of tracks) {
    if (!t.completed || t.is_placeholder) continue;
    const already = await queryOne(
      `SELECT 1 FROM training_events_outbox WHERE type = 'training.track_completed'
       AND payload_json->>'user_id' = $1 AND payload_json->>'track' = $2`,
      [String(userId), t.code]
    );
    if (!already) {
      await emitEvent('training.track_completed', { user_id: userId, track: t.code, track_title: t.title, date: new Date().toISOString() });
    }
  }
  return granted;
}
