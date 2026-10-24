/**
 * Analytics (B.10), leaderboard (E.9) and the data behind the coach digest.
 * Live-call numbers come from the systems that already exist:
 *   dials        → call_logs (3CX) by extension
 *   connects     → call_transcripts with duration ≥ 50 s
 *   conversations→ call_evaluations that were evaluable
 *   meetings     → call_evaluations.meeting_scheduled + dialer "interested"
 *   proposals    → dialer_leads pipeline beyond "new_interested"
 */
import { query, queryOne } from '@/lib/db';
import { buildPath } from './progress';
import { getRampStatus } from './ramp';
import { getSettings } from './settings';
import { drillStreak } from './badges';

interface Rep { id: number; full_name: string; username: string; extension_number: string; created_at: string; is_active: boolean }

export async function activeReps(): Promise<Rep[]> {
  return query<Rep>(
    `SELECT id, full_name, username, extension_number, created_at, COALESCE(is_active, true) AS is_active
     FROM users WHERE role = 'agent' AND COALESCE(is_active, true) ORDER BY full_name`
  );
}

export async function funnel(rep: Rep, days = 30) {
  const r = await queryOne<any>(
    `SELECT
       (SELECT COUNT(*) FROM call_logs WHERE agent_extension = $2 AND call_time >= NOW() - ($3 || ' days')::interval) AS dials,
       (SELECT COUNT(*) FROM call_transcripts WHERE agent_id = $1 AND duration_sec >= 50 AND call_started_at >= NOW() - ($3 || ' days')::interval) AS connects,
       (SELECT COUNT(*) FROM call_evaluations WHERE agent_id = $1 AND NOT COALESCE(not_evaluable, false) AND created_at >= NOW() - ($3 || ' days')::interval) AS conversations,
       (SELECT COUNT(*) FROM call_evaluations WHERE agent_id = $1 AND meeting_scheduled AND created_at >= NOW() - ($3 || ' days')::interval)
         + (SELECT COUNT(*) FROM dialer_call_logs WHERE agent_id = $1 AND call_outcome = 'interested' AND created_at >= NOW() - ($3 || ' days')::interval) AS meetings_booked,
       (SELECT COUNT(*) FROM dialer_leads WHERE assigned_agent_id = $1 AND pipeline_stage IN ('proposal_sent', 'closed_won', 'closed_lost') AND updated_at >= NOW() - ($3 || ' days')::interval) AS meetings_held`,
    [rep.id, rep.extension_number, String(days)]
  );
  const n = (k: string) => Number(r?.[k] || 0);
  return {
    days, dials: n('dials'), connects: n('connects'), conversations: n('conversations'),
    meetings_booked: n('meetings_booked'), meetings_held: n('meetings_held'),
    connect_rate: n('dials') ? Math.round((n('connects') / n('dials')) * 1000) / 10 : null,
    show_rate: n('meetings_booked') ? Math.round((n('meetings_held') / n('meetings_booked')) * 100) : null,
  };
}

/** 4-week rolling average on graded live calls (falls back to QA overall × 10). */
export async function liveScorecardAvg(userId: number, weeks = 4) {
  const r = await queryOne<{ avg: string | null; n: string }>(
    `SELECT AVG(final_score) AS avg, COUNT(*) AS n FROM training_call_reviews
     WHERE user_id = $1 AND final_score IS NOT NULL AND created_at >= NOW() - ($2 || ' weeks')::interval`,
    [userId, String(weeks)]
  );
  if (Number(r?.n || 0) > 0) return { avg: Math.round(Number(r!.avg)), n: Number(r!.n), source: 'scorecard' as const };
  const qa = await queryOne<{ avg: string | null; n: string }>(
    `SELECT AVG(overall_score) * 10 AS avg, COUNT(*) AS n FROM call_evaluations
     WHERE agent_id = $1 AND NOT COALESCE(not_evaluable, false) AND overall_score IS NOT NULL
       AND created_at >= NOW() - ($2 || ' weeks')::interval`,
    [userId, String(weeks)]
  );
  return { avg: Number(qa?.n || 0) ? Math.round(Number(qa!.avg)) : null, n: Number(qa?.n || 0), source: 'qa' as const };
}

export async function cohortAnalytics() {
  const reps = await activeReps();
  const settings = await getSettings();
  const month = new Date().toISOString().slice(0, 7);

  const rows = [];
  for (const rep of reps) {
    const [{ tracks }, ramp, certs, firstPass, roleplay, retention, spend, live, pending] = await Promise.all([
      buildPath(rep.id),
      getRampStatus(rep.id),
      query<any>(`SELECT code, granted_at, method FROM training_certifications WHERE user_id = $1 AND revoked_at IS NULL`, [rep.id]),
      queryOne<any>(
        `SELECT COUNT(*) AS n, COUNT(*) FILTER (WHERE passed) AS p FROM (
           SELECT DISTINCT ON (lesson_id) lesson_id, passed FROM training_attempts
           WHERE user_id = $1 AND finished_at IS NOT NULL ORDER BY lesson_id, started_at) x`, [rep.id]),
      queryOne<any>(`SELECT AVG(final_score) AS avg, COUNT(*) AS n FROM training_roleplay_sessions WHERE user_id = $1 AND final_score IS NOT NULL AND started_at >= NOW() - INTERVAL '28 days'`, [rep.id]),
      queryOne<any>(`SELECT COALESCE(SUM(good_count), 0) AS g, COALESCE(SUM(review_count), 0) AS r FROM training_flashcard_reviews WHERE user_id = $1`, [rep.id]),
      queryOne<any>(`SELECT COALESCE(spent_usd, 0) AS spent, cap_usd FROM ai_budgets WHERE user_id = $1 AND month = $2`, [rep.id, month]),
      liveScorecardAvg(rep.id),
      queryOne<any>(`SELECT (SELECT COUNT(*) FROM training_roleplay_sessions WHERE user_id = $1 AND status = 'needs_review')
                          + (SELECT COUNT(*) FROM training_call_reviews WHERE user_id = $1 AND status = 'needs_review') AS n`, [rep.id]),
    ]);
    const live_cert = certs.find((c) => c.code === 'LIVE_CALL_CERT');
    const timeToCertDays = live_cert && live_cert.method !== 'grandfathered'
      ? Math.round((new Date(live_cert.granted_at).getTime() - new Date(rep.created_at).getTime()) / 86_400_000 * 10) / 10
      : null;
    rows.push({
      id: rep.id, name: rep.full_name, username: rep.username,
      phase: ramp.phase, quota_multiplier: Number(ramp.quota_multiplier), grandfathered: ramp.grandfathered,
      phase_started_at: ramp.phase_started_at, certified_at: ramp.certified_at,
      tracks: tracks.filter((t) => !t.is_placeholder).map((t) => ({ code: t.code, title: t.title, progress_pct: t.progress_pct, completed: t.completed })),
      certifications: certs,
      time_to_cert_days: timeToCertDays,
      first_attempt_pass_pct: Number(firstPass?.n) ? Math.round((Number(firstPass.p) / Number(firstPass.n)) * 100) : null,
      roleplay_avg_28d: roleplay?.avg === null || roleplay?.avg === undefined ? null : Math.round(Number(roleplay.avg)),
      roleplays_28d: Number(roleplay?.n || 0),
      flashcard_retention_pct: Number(retention?.r) ? Math.round((Number(retention.g) / Number(retention.r)) * 100) : null,
      ai_spend_usd: Number(spend?.spent || 0), ai_cap_usd: spend?.cap_usd ? Number(spend.cap_usd) : null,
      live_scorecard_avg: live.avg, live_scorecard_n: live.n, live_scorecard_source: live.source,
      suggest_supervised: live.avg !== null && live.n >= 3 && live.avg < settings.supervised_threshold && ramp.phase !== 'SUPERVISED' && ramp.phase !== 'TRAINING',
      pending_reviews: Number(pending?.n || 0),
    });
  }

  // Quiz pass rate by question → finds bad questions.
  const questionStats = await query<any>(
    `SELECT q.id, q.prompt, q.tags, l.code AS lesson_code, COUNT(*) AS answered,
            ROUND(100.0 * COUNT(*) FILTER (WHERE (it->>'correct')::boolean) / COUNT(*)) AS correct_pct
     FROM training_attempts a
     CROSS JOIN LATERAL jsonb_array_elements(COALESCE(a.result_json->'items', '[]'::jsonb)) it
     JOIN training_quiz_questions q ON q.id = (it->>'id')::int
     LEFT JOIN training_lessons l ON l.id = q.lesson_id
     WHERE a.finished_at IS NOT NULL AND NOT (it ? 'kind')
     GROUP BY q.id, q.prompt, q.tags, l.code
     HAVING COUNT(*) >= 3
     ORDER BY correct_pct ASC, answered DESC
     LIMIT 25`
  );

  return {
    reps: rows,
    question_stats: questionStats.map((q) => ({ ...q, answered: Number(q.answered), correct_pct: Number(q.correct_pct) })),
    criteria: await criteriaAverages(null),
    ai_vs_human: await aiHumanGap(null),
    correlation: await roleplayMeetingCorrelation(reps),
    kpi_targets: settings.kpi_targets,
  };
}

/** Scorecard average per criterion (what to coach). */
export async function criteriaAverages(userId: number | null) {
  const rows = await query<any>(
    `WITH cards AS (
       SELECT COALESCE(trainer_score_json, ai_score_json) AS card FROM training_roleplay_sessions
       WHERE final_score IS NOT NULL ${userId ? 'AND user_id = $1' : ''} AND started_at >= NOW() - INTERVAL '8 weeks'
       UNION ALL
       SELECT COALESCE(trainer_override_json, ai_score_json) FROM training_call_reviews
       WHERE final_score IS NOT NULL ${userId ? 'AND user_id = $1' : ''} AND created_at >= NOW() - INTERVAL '8 weeks'
     )
     SELECT c->>'id' AS id, c->>'criterion' AS criterion, AVG((c->>'points')::numeric) AS avg_points,
            MAX((c->>'max_points')::numeric) AS max_points, COUNT(*) AS n
     FROM cards, jsonb_array_elements(COALESCE(card->'criteria', '[]'::jsonb)) c
     GROUP BY 1, 2 ORDER BY AVG((c->>'points')::numeric) / NULLIF(MAX((c->>'max_points')::numeric), 0)`,
    userId ? [userId] : []
  );
  return rows.map((r) => ({
    id: r.id, criterion: r.criterion, n: Number(r.n),
    avg_points: Math.round(Number(r.avg_points) * 10) / 10, max_points: Number(r.max_points),
    pct: Number(r.max_points) ? Math.round((Number(r.avg_points) / Number(r.max_points)) * 100) : null,
  }));
}

/** Whether the AI grader can be trusted: mean |AI − human| on reviewed items. */
export async function aiHumanGap(userId: number | null) {
  const r = await queryOne<any>(
    `SELECT AVG(gap) AS avg_gap, COUNT(*) AS n, COUNT(*) FILTER (WHERE gap > 15) AS big FROM (
       SELECT ABS((ai_score_json->>'total')::numeric - final_score) AS gap FROM training_roleplay_sessions
       WHERE human_reviewed AND trainer_score_json IS NOT NULL AND (ai_score_json->>'engine') = 'ai' ${userId ? 'AND user_id = $1' : ''}
       UNION ALL
       SELECT ABS((ai_score_json->>'total')::numeric - final_score) FROM training_call_reviews
       WHERE status = 'reviewed' AND trainer_override_json IS NOT NULL AND ai_score_json IS NOT NULL ${userId ? 'AND user_id = $1' : ''}
     ) x`,
    userId ? [userId] : []
  );
  return { avg_gap: r?.avg_gap === null ? null : Math.round(Number(r?.avg_gap) * 10) / 10, n: Number(r?.n || 0), over_15: Number(r?.big || 0) };
}

/** B.10: does the roleplay score in week 2 predict meetings in weeks 5–8? (Pearson r) */
async function roleplayMeetingCorrelation(reps: Rep[]) {
  const pairs: { x: number; y: number }[] = [];
  for (const rep of reps) {
    const r = await queryOne<any>(
      `SELECT
         (SELECT AVG(final_score) FROM training_roleplay_sessions WHERE user_id = $1 AND final_score IS NOT NULL
            AND started_at >= $2::timestamptz + INTERVAL '7 days' AND started_at < $2::timestamptz + INTERVAL '14 days') AS rp,
         (SELECT COUNT(*) FROM call_evaluations WHERE agent_id = $1 AND meeting_scheduled
            AND created_at >= $2::timestamptz + INTERVAL '28 days' AND created_at < $2::timestamptz + INTERVAL '56 days') AS mtg,
         ($2::timestamptz + INTERVAL '56 days' < NOW()) AS mature`,
      [rep.id, rep.created_at]
    );
    if (r?.rp !== null && r?.rp !== undefined && r?.mature) pairs.push({ x: Number(r.rp), y: Number(r.mtg) });
  }
  if (pairs.length < 3) return { n: pairs.length, r: null, note: 'Needs at least 3 reps who are 8+ weeks past hire with week-2 roleplays.' };
  const mx = pairs.reduce((s, p) => s + p.x, 0) / pairs.length;
  const my = pairs.reduce((s, p) => s + p.y, 0) / pairs.length;
  const cov = pairs.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0);
  const vx = Math.sqrt(pairs.reduce((s, p) => s + (p.x - mx) ** 2, 0));
  const vy = Math.sqrt(pairs.reduce((s, p) => s + (p.y - my) ** 2, 0));
  const r = vx && vy ? Math.round((cov / (vx * vy)) * 100) / 100 : null;
  return { n: pairs.length, r, note: r !== null && Math.abs(r) < 0.3 ? 'Weak relationship — consider changing the rubric.' : null };
}

export async function repAnalytics(userId: number) {
  const rep = await queryOne<Rep>(`SELECT id, full_name, username, extension_number, created_at, COALESCE(is_active, true) AS is_active FROM users WHERE id = $1`, [userId]);
  if (!rep) return null;
  const month = new Date().toISOString().slice(0, 7);
  const [path, ramp, f, live, trend, calls, attempts, ai, criteria, gap, streak, rampHistory] = await Promise.all([
    buildPath(userId),
    getRampStatus(userId),
    funnel(rep),
    liveScorecardAvg(userId),
    query<any>(`SELECT id, started_at, final_score, purpose, engine, status, human_reviewed, persona_json->>'title' AS title
                FROM training_roleplay_sessions WHERE user_id = $1 AND final_score IS NOT NULL ORDER BY started_at DESC LIMIT 30`, [userId]),
    query<any>(`SELECT id, created_at, final_score, status, source FROM training_call_reviews WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30`, [userId]),
    query<any>(`SELECT a.id, l.code, l.title, l.type, a.started_at, a.finished_at, a.score_pct, a.passed
                FROM training_attempts a JOIN training_lessons l ON l.id = a.lesson_id
                WHERE a.user_id = $1 AND a.finished_at IS NOT NULL ORDER BY a.finished_at DESC LIMIT 50`, [userId]),
    query<any>(`SELECT feature, COUNT(*) AS calls, SUM(cost_usd) AS cost, SUM(input_tokens) AS input, SUM(output_tokens) AS output
                FROM ai_sessions WHERE user_id = $1 AND to_char(created_at, 'YYYY-MM') = $2 GROUP BY feature`, [userId, month]),
    criteriaAverages(userId),
    aiHumanGap(userId),
    drillStreak(userId),
    query<any>(`SELECT phase, quota_multiplier, started_at, ended_at, reason FROM training_ramp_history WHERE user_id = $1 ORDER BY started_at`, [userId]),
  ]);
  return {
    rep: { id: rep.id, name: rep.full_name, username: rep.username, extension: rep.extension_number, created_at: rep.created_at },
    ramp, ramp_history: rampHistory, tracks: path.tracks, funnel: f, live_scorecard: live, drill_streak: streak,
    roleplay_trend: trend.map((t) => ({ ...t, final_score: Number(t.final_score) })),
    call_reviews: calls.map((c) => ({ ...c, final_score: c.final_score === null ? null : Number(c.final_score) })),
    attempts: attempts.map((a) => ({ ...a, score_pct: Number(a.score_pct) })),
    ai_usage: ai.map((a) => ({ feature: a.feature, calls: Number(a.calls), cost_usd: Number(a.cost), input_tokens: Number(a.input), output_tokens: Number(a.output) })),
    criteria, ai_vs_human: gap,
  };
}

/** Weekly scoreboard (E.9): effort metrics so new reps can compete too. */
export async function leaderboard(period: 'week' | 'month' = 'week') {
  const reps = await activeReps();
  const interval = period === 'month' ? '30 days' : '7 days';
  const rows = [];
  for (const rep of reps) {
    const r = await queryOne<any>(
      `SELECT
         (SELECT COUNT(*) FROM training_drill_log WHERE user_id = $1 AND completed_at IS NOT NULL AND completed_at >= NOW() - $2::interval) AS drills,
         (SELECT AVG(final_score) FROM training_roleplay_sessions WHERE user_id = $1 AND final_score IS NOT NULL AND started_at >= NOW() - $2::interval) AS roleplay_avg,
         (SELECT COUNT(*) FROM training_roleplay_sessions WHERE user_id = $1 AND final_score IS NOT NULL AND started_at >= NOW() - $2::interval) AS roleplays,
         (SELECT AVG(final_score) FROM training_call_reviews WHERE user_id = $1 AND final_score IS NOT NULL AND created_at >= NOW() - $2::interval) AS live_avg,
         (SELECT COUNT(*) FROM call_evaluations WHERE agent_id = $1 AND meeting_scheduled AND created_at >= NOW() - $2::interval)
           + (SELECT COUNT(*) FROM dialer_call_logs WHERE agent_id = $1 AND call_outcome = 'interested' AND created_at >= NOW() - $2::interval) AS meetings,
         (SELECT COUNT(*) FROM training_user_badges WHERE user_id = $1) AS badges`,
      [rep.id, interval]
    );
    const streak = await drillStreak(rep.id);
    const badges = await query<any>(
      `SELECT b.code, b.title, b.icon FROM training_user_badges ub JOIN training_badges b ON b.id = ub.badge_id WHERE ub.user_id = $1 ORDER BY ub.earned_at`,
      [rep.id]
    );
    const roleplayAvg = r?.roleplay_avg === null ? null : Math.round(Number(r.roleplay_avg));
    const liveAvg = r?.live_avg === null ? null : Math.round(Number(r.live_avg));
    const points = Number(r?.drills || 0) * 10 + streak * 5 + (roleplayAvg || 0) * Math.min(Number(r?.roleplays || 0), 5) / 5 + Number(r?.meetings || 0) * 25 + (liveAvg || 0) / 2;
    rows.push({
      user_id: rep.id, name: rep.full_name, drills: Number(r?.drills || 0), streak, roleplay_avg: roleplayAvg,
      roleplays: Number(r?.roleplays || 0), live_avg: liveAvg, meetings: Number(r?.meetings || 0), badges, points: Math.round(points),
    });
  }
  rows.sort((a, b) => b.points - a.points);
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}
