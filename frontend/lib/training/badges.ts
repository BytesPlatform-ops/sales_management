/**
 * Badges (E.9). Criteria live in training_badges.criteria_json; evaluation is
 * cheap SQL, run after activity and nightly.
 */
import { query, queryOne } from '@/lib/db';
import { notify } from './events';

async function award(userId: number, code: string) {
  const rows = await query<{ title: string }>(
    `INSERT INTO training_user_badges (user_id, badge_id)
     SELECT $1, id FROM training_badges WHERE code = $2
     ON CONFLICT DO NOTHING
     RETURNING (SELECT title FROM training_badges WHERE code = $2) AS title`,
    [userId, code]
  );
  if (rows[0]) await notify(userId, 'badge', `New badge: ${rows[0].title}`, '/agent/training/scoreboard');
  return rows.length > 0;
}

export async function awardCertBadge(userId: number, certCode: string) {
  const badge = await queryOne<{ code: string }>(
    `SELECT code FROM training_badges WHERE criteria_json->>'type' = 'cert' AND criteria_json->>'code' = $1`,
    [certCode]
  );
  if (badge) await award(userId, badge.code);
}

/** Current daily-drill streak (consecutive days with a completed drill, ending today or yesterday). */
export async function drillStreak(userId: number): Promise<number> {
  const rows = await query<{ d: string }>(
    `SELECT drill_date::text AS d FROM training_drill_log
     WHERE user_id = $1 AND completed_at IS NOT NULL ORDER BY drill_date DESC LIMIT 400`,
    [userId]
  );
  if (rows.length === 0) return 0;
  const day = (s: string) => Math.floor(new Date(s + 'T00:00:00Z').getTime() / 86_400_000);
  const today = Math.floor(Date.now() / 86_400_000);
  if (today - day(rows[0].d) > 1) return 0;
  let streak = 1;
  for (let i = 1; i < rows.length; i++) {
    if (day(rows[i - 1].d) - day(rows[i].d) === 1) streak++;
    else break;
  }
  return streak;
}

export async function evaluateBadges(userId: number): Promise<string[]> {
  const earned: string[] = [];
  const badges = await query<{ code: string; criteria_json: any }>(
    `SELECT b.code, b.criteria_json FROM training_badges b
     WHERE NOT EXISTS (SELECT 1 FROM training_user_badges ub WHERE ub.badge_id = b.id AND ub.user_id = $1)`,
    [userId]
  );

  for (const b of badges) {
    const c = b.criteria_json || {};
    let ok = false;
    switch (c.type) {
      case 'first_meeting': {
        // Live calls the QA pipeline marked as booked, or a lead the rep moved to interested.
        const r = await queryOne<{ n: string }>(
          `SELECT (SELECT COUNT(*) FROM call_evaluations WHERE agent_id = $1 AND meeting_scheduled)
                + (SELECT COUNT(*) FROM dialer_call_logs WHERE agent_id = $1 AND call_outcome = 'interested') AS n`,
          [userId]
        );
        ok = Number(r?.n || 0) > 0;
        break;
      }
      case 'drill_streak':
        ok = (await drillStreak(userId)) >= Number(c.days || 10);
        break;
      case 'objection_master': {
        // Every active objection scored ≥ min (out of 10) at least once in drills.
        const r = await queryOne<{ missing: string }>(
          `SELECT COUNT(*) AS missing FROM training_objections o
           WHERE o.active AND NOT EXISTS (
             SELECT 1 FROM training_attempts a, jsonb_array_elements(COALESCE(a.result_json->'items', '[]'::jsonb)) it
             WHERE a.user_id = $1 AND it->>'kind' = 'objection'
               AND (it->>'objection_id')::int = o.id AND (it->>'score')::numeric >= $2)`,
          [userId, Number(c.min || 8)]
        );
        ok = Number(r?.missing ?? 1) === 0;
        break;
      }
      case 'cert': {
        const r = await queryOne(`SELECT 1 FROM training_certifications WHERE user_id = $1 AND code = $2 AND revoked_at IS NULL`, [userId, c.code]);
        ok = !!r;
        break;
      }
      case 'roleplay_score': {
        const r = await queryOne(`SELECT 1 FROM training_roleplay_sessions WHERE user_id = $1 AND final_score >= $2 LIMIT 1`, [userId, Number(c.min || 85)]);
        ok = !!r;
        break;
      }
      case 'flashcards_reviewed': {
        const r = await queryOne<{ n: string }>(`SELECT COALESCE(SUM(review_count), 0) AS n FROM training_flashcard_reviews WHERE user_id = $1`, [userId]);
        ok = Number(r?.n || 0) >= Number(c.count || 100);
        break;
      }
    }
    if (ok && (await award(userId, b.code))) earned.push(b.code);
  }
  return earned;
}
