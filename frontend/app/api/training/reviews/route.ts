import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { handler, ok, requireHr } from '@/lib/training/http';

export const dynamic = 'force-dynamic';

/**
 * GET /api/training/reviews?sort=lowest|disagreement|oldest&status=needs_review|all (trainer)
 * The review queue (B.8 trainer screen 3): AI-graded roleplays and calls in one list.
 * "disagreement" sorts by this rep's last AI-vs-trainer gap.
 */
export const GET = handler(async (request: NextRequest) => {
  await requireHr(request);
  const sp = new URL(request.url).searchParams;
  const sort = sp.get('sort') || 'lowest';
  const all = sp.get('status') === 'all';

  const rows = await query<any>(
    `WITH gaps AS (
       SELECT DISTINCT ON (user_id) user_id, ABS((ai_score_json->>'total')::numeric - final_score) AS gap
       FROM (
         SELECT user_id, ai_score_json, final_score, reviewed_at FROM training_roleplay_sessions WHERE human_reviewed AND trainer_score_json IS NOT NULL AND ai_score_json IS NOT NULL
         UNION ALL
         SELECT user_id, ai_score_json, final_score, reviewed_at FROM training_call_reviews WHERE status = 'reviewed' AND trainer_override_json IS NOT NULL AND ai_score_json IS NOT NULL
       ) x ORDER BY user_id, reviewed_at DESC
     )
     SELECT q.*, g.gap FROM (
       SELECT 'roleplay' AS kind, s.id, s.user_id, u.full_name, s.persona_json->>'title' AS title, s.purpose, s.engine,
              s.final_score, (s.ai_score_json->>'total')::numeric AS ai_total, s.status, s.human_reviewed,
              COALESCE(s.finished_at, s.started_at) AS at, sc.exam_kind
       FROM training_roleplay_sessions s JOIN users u ON u.id = s.user_id LEFT JOIN training_roleplay_scenarios sc ON sc.id = s.scenario_id
       WHERE ${all ? "s.status IN ('scored', 'needs_review', 'reviewed')" : "s.status = 'needs_review'"}
       UNION ALL
       SELECT 'call', r.id, r.user_id, u.full_name, 'Live call (' || r.source || ')', NULL, NULL,
              r.final_score, (r.ai_score_json->>'total')::numeric, r.status, r.status = 'reviewed', r.created_at, NULL
       FROM training_call_reviews r JOIN users u ON u.id = r.user_id
       WHERE ${all ? "r.status IN ('scored', 'needs_review', 'reviewed')" : "r.status = 'needs_review'"}
     ) q LEFT JOIN gaps g ON g.user_id = q.user_id
     ORDER BY ${sort === 'disagreement' ? 'g.gap DESC NULLS LAST, q.final_score ASC NULLS FIRST' : sort === 'oldest' ? 'q.at ASC' : 'q.final_score ASC NULLS FIRST, q.at ASC'}
     LIMIT 200`
  );
  return ok(rows.map((r) => ({
    ...r,
    final_score: r.final_score === null ? null : Number(r.final_score),
    ai_total: r.ai_total === null ? null : Number(r.ai_total),
    last_gap: r.gap === null || r.gap === undefined ? null : Number(r.gap),
  })));
});
