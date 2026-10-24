/**
 * Weekly coach digest for the sales lead (E.10): per-rep scores, weakest rubric
 * criteria, items worth listening to, AI-vs-human disagreement and AI spend.
 * AI writes the narrative when available; otherwise a template digest.
 */
import { query, queryOne } from '@/lib/db';
import { chatText, AiUnavailableError } from './ai';
import { activeReps, criteriaAverages, aiHumanGap, liveScorecardAvg } from './analytics';
import { getRampStatus } from './ramp';
import { notifyTrainers } from './events';

/** Monday of the current week (PKT) as YYYY-MM-DD. */
export function weekStartPKT(d = new Date()): string {
  const pkt = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Karachi' }));
  const dow = (pkt.getDay() + 6) % 7; // Mon = 0
  pkt.setDate(pkt.getDate() - dow);
  return `${pkt.getFullYear()}-${String(pkt.getMonth() + 1).padStart(2, '0')}-${String(pkt.getDate()).padStart(2, '0')}`;
}

export async function buildDigestData() {
  const reps = await activeReps();
  const month = new Date().toISOString().slice(0, 7);
  const perRep = [];
  for (const rep of reps) {
    const [ramp, live, roleplay, criteria, lowest, spend, drills] = await Promise.all([
      getRampStatus(rep.id),
      liveScorecardAvg(rep.id, 1),
      queryOne<any>(`SELECT AVG(final_score) AS avg, COUNT(*) AS n FROM training_roleplay_sessions WHERE user_id = $1 AND final_score IS NOT NULL AND started_at >= NOW() - INTERVAL '7 days'`, [rep.id]),
      criteriaAverages(rep.id),
      query<any>(
        `SELECT 'roleplay' AS kind, id, final_score FROM training_roleplay_sessions WHERE user_id = $1 AND final_score IS NOT NULL AND started_at >= NOW() - INTERVAL '7 days'
         UNION ALL
         SELECT 'call', id, final_score FROM training_call_reviews WHERE user_id = $1 AND final_score IS NOT NULL AND created_at >= NOW() - INTERVAL '7 days'
         ORDER BY final_score ASC LIMIT 3`, [rep.id]),
      queryOne<any>(`SELECT spent_usd, cap_usd FROM ai_budgets WHERE user_id = $1 AND month = $2`, [rep.id, month]),
      queryOne<any>(`SELECT COUNT(*) AS n FROM training_drill_log WHERE user_id = $1 AND completed_at >= NOW() - INTERVAL '7 days'`, [rep.id]),
    ]);
    perRep.push({
      rep_id: rep.id, name: rep.full_name, phase: ramp.phase,
      roleplay_avg: roleplay?.avg === null ? null : Math.round(Number(roleplay.avg)), roleplays: Number(roleplay?.n || 0),
      live_scorecard_avg: live.avg, live_calls_graded: live.n,
      strongest: criteria.length ? criteria[criteria.length - 1] : null,
      weakest: criteria[0] || null,
      listen_to: lowest.map((l) => ({ kind: l.kind, id: l.id, score: Number(l.final_score) })),
      drills_completed: Number(drills?.n || 0),
      ai_spend_usd: Number(spend?.spent_usd || 0), ai_cap_usd: spend?.cap_usd ? Number(spend.cap_usd) : null,
    });
  }
  const org = await queryOne<any>(`SELECT spent_usd, cap_usd FROM ai_budgets WHERE user_id = 0 AND month = $1`, [month]);
  return {
    reps: perRep,
    team_criteria: await criteriaAverages(null),
    ai_vs_human: await aiHumanGap(null),
    org_ai: { spent_usd: Number(org?.spent_usd || 0), cap_usd: org?.cap_usd ? Number(org.cap_usd) : null },
  };
}

const DRILL_FOR: Record<string, string> = {
  opener: 'Read the opener 5× with downward inflection (D.14 drill 1)',
  reason: 'Practise the live-observation opener (Opener 6) on 3 SAM rows',
  tonality: 'Slow-down drill at ~140 wpm (D.14 drill 2)',
  problem_questions: 'Write 2 consequence questions per service from the D.7 bank',
  listening: 'Mirror-and-pause drill (D.14 drill 3)',
  classification_bridge: 'Classification drill (C3-DRILL) + Label → Link → Light pitch → Question',
  objection_handling: 'Objection drill on the top 5 objections (A-C-I-R-R)',
  next_step: 'Two-option close practice: "Wednesday at 10 or Thursday at 2?"',
  accuracy: 'Re-read the "Do NOT promise" lists in C2',
  notes_disposition: 'Disposition codes flashcards (D.16)',
};

function templateDigest(weekStart: string, data: Awaited<ReturnType<typeof buildDigestData>>) {
  const lines = [`# Coach digest — week of ${weekStart}`, ''];
  for (const r of data.reps) {
    lines.push(`## ${r.name} · ${r.phase.replace('_', ' ')}`);
    lines.push(`- Roleplay avg: ${r.roleplay_avg ?? '—'} (${r.roleplays} sessions) · Live scorecard: ${r.live_scorecard_avg ?? '—'} (${r.live_calls_graded} graded) · Drills: ${r.drills_completed}/7`);
    if (r.strongest) lines.push(`- **Strength:** ${r.strongest.criterion} (${r.strongest.pct}%)`);
    if (r.weakest) {
      lines.push(`- **Priority skill:** ${r.weakest.criterion} (${r.weakest.pct}%)`);
      lines.push(`- **Suggested drill:** ${DRILL_FOR[r.weakest.id] || 'Daily drill'}`);
    }
    if (r.listen_to.length) lines.push(`- **Listen to:** ${r.listen_to.map((l) => `${l.kind} #${l.id} (${l.score})`).join(', ')}`);
    lines.push('');
  }
  lines.push('## Team');
  const weak = data.team_criteria.slice(0, 3).map((c) => `${c.criterion} ${c.pct}%`).join(', ');
  lines.push(`- Lowest criteria: ${weak || 'not enough graded calls yet'}`);
  lines.push(`- AI vs human gap: ${data.ai_vs_human.avg_gap ?? '—'} pts avg over ${data.ai_vs_human.n} reviewed (${data.ai_vs_human.over_15} > 15)`);
  lines.push(`- AI spend this month: $${data.org_ai.spent_usd.toFixed(2)}${data.org_ai.cap_usd ? ` of $${data.org_ai.cap_usd}` : ''}`);
  return lines.join('\n');
}

export async function generateCoachDigest(force = false) {
  const weekStart = weekStartPKT();
  if (!force) {
    const existing = await queryOne(`SELECT 1 FROM training_coach_digests WHERE week_start = $1`, [weekStart]);
    if (existing) return null;
  }
  const data = await buildDigestData();
  let body = templateDigest(weekStart, data);
  let aiUsed = false;
  try {
    const r = await chatText({
      feature: 'digest', userId: null, promptKey: 'coach_digest',
      vars: { week_start: weekStart, metrics: JSON.stringify(data) }, maxTokens: 2500,
    });
    if (r.text.trim()) {
      body = r.text.trim();
      aiUsed = true;
    }
  } catch (err) {
    if (!(err instanceof AiUnavailableError)) console.error('[training] digest', err);
  }
  await query(
    `INSERT INTO training_coach_digests (week_start, body_md, data_json, ai_used) VALUES ($1, $2, $3::jsonb, $4)
     ON CONFLICT (week_start) DO UPDATE SET body_md = EXCLUDED.body_md, data_json = EXCLUDED.data_json, ai_used = EXCLUDED.ai_used, created_at = NOW()`,
    [weekStart, body, JSON.stringify(data), aiUsed]
  );
  await notifyTrainers('coach_digest', `Coach digest for the week of ${weekStart} is ready.`, '/hr/training/digest');
  return { week_start: weekStart, ai_used: aiUsed };
}
