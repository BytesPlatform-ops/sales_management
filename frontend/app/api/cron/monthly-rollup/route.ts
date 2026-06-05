import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * POST /api/cron/monthly-rollup
 * Vercel Cron: "0 2 1 * *" (07:00 PKT on the 1st). Requires: Authorization: Bearer <CRON_SECRET>.
 *
 * Rolls up the PREVIOUS month's weekly_reports into one monthly_reports row per agent.
 * Mostly SQL aggregation + one lightweight gpt-4o-mini call to write the trajectory
 * narrative. Reads weekly summaries only (never transcripts/evals) — tokens stay tiny.
 */

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const CRON_SECRET = process.env.CRON_SECRET || '';
const MIN_WEEKS = 2;            // fewer than this -> low_data, skip the LLM
const PERSISTENT_THRESHOLD = 3; // a weakness id in >= this many weeks is "persistent"

interface WeeklyRow {
  week_start: string;
  avg_score: number | string | null;
  improvement_rate: number | string | null;
  narrative: string | null;
  weaknesses: Array<{ id: string; title: string; severity: string }> | null;
}

const TRAJECTORY_SCHEMA = {
  name: 'monthly_trajectory',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['trajectory', 'narrative'],
    properties: {
      trajectory: { type: 'string', enum: ['improving', 'flat', 'declining'] },
      narrative: { type: 'string' },
    },
  },
};

const SYSTEM_PROMPT = `You write a concise MONTHLY trajectory summary for one sales agent, for a manager's performance review.
You receive the month's weekly scores, the persistent weaknesses (ones that recurred across weeks),
and the weekly coach narratives. Decide the trajectory and write 3-4 sentences.

RULES:
- trajectory: "improving" if scores trend up or persistent weaknesses are resolving;
  "declining" if scores trend down or weaknesses are worsening/accumulating;
  "flat" if roughly stable.
- Ground the call in the score trend FIRST, then the weakness pattern. Be honest, not flattering.
- The narrative should name the single biggest persistent issue and the clearest sign of progress (if any).
OUTPUT: the structured schema only.`;

// ---------- month helpers (PKT-agnostic: month boundaries are date-only) ----------
function pktTodayYMD(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}
function firstOfPrevMonth(ymd: string): { monthStart: string; monthEnd: string } {
  const [y, m] = ymd.split('-').map(Number);
  // previous month relative to the run date (the 1st)
  const prev = new Date(Date.UTC(y, m - 1, 1)); // first of THIS month
  prev.setUTCMonth(prev.getUTCMonth() - 1);      // first of PREVIOUS month
  const start = prev;
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)); // last day prev month
  const fmt = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  return { monthStart: fmt(start), monthEnd: fmt(end) };
}

async function callOpenAI(weeks: WeeklyRow[], persistent: Array<{ id: string; title: string; weeks: number }>): Promise<{ trajectory: string; narrative: string }> {
  const trend = weeks.map((w) => `  ${w.week_start}: score=${w.avg_score ?? '—'} improvement_rate=${w.improvement_rate ?? 'n/a'}`).join('\n');
  const persistBlock = persistent.length
    ? persistent.map((p) => `  ${p.id} (${p.title}) — appeared in ${p.weeks} weeks`).join('\n')
    : '  (none recurred across multiple weeks)';
  const narratives = weeks.map((w, i) => `  Week ${i + 1} (${w.week_start}): ${w.narrative || '—'}`).join('\n');

  const user = [
    `WEEKLY SCORE TREND (oldest→newest):`, trend, ``,
    `PERSISTENT WEAKNESSES:`, persistBlock, ``,
    `WEEKLY COACH NARRATIVES:`, narratives,
  ].join('\n');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      response_format: { type: 'json_schema', json_schema: TRAJECTORY_SCHEMA },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

// Vercel Cron triggers via GET; external schedulers may POST. Support both.
export async function GET(request: NextRequest) {
  return POST(request);
}

export async function POST(request: NextRequest) {
  const provided = request.headers.get('authorization')?.replace('Bearer ', '');
  if (!provided || provided !== CRON_SECRET) {
    return NextResponse.json({ status: 'error', message: 'Invalid secret' }, { status: 403 });
  }

  try {
    const { monthStart, monthEnd } = firstOfPrevMonth(pktTodayYMD());

    const agents = await query<{ id: number; full_name: string }>(
      `SELECT id, full_name FROM users WHERE role = 'agent' AND is_active = true ORDER BY full_name`
    );

    const results: Array<{ agent: string; trajectory: string }> = [];

    for (const agent of agents) {
      try {
        // Gather the month's weekly reports (up to the last 4), oldest→newest.
        const weeks = await query<WeeklyRow>(
          `SELECT week_start::text AS week_start, avg_score, improvement_rate, narrative, weaknesses
           FROM weekly_reports
           WHERE agent_id = $1 AND week_start BETWEEN $2 AND $3
           ORDER BY week_start ASC
           LIMIT 4`,
          [agent.id, monthStart, monthEnd]
        );

        // Aggregations (pure JS, no LLM).
        const scores = weeks.map((w) => (w.avg_score == null ? null : Number(w.avg_score))).filter((v): v is number => v != null);
        const avgScore = scores.length ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)) : null;
        const rates = weeks.map((w) => (w.improvement_rate == null ? null : Number(w.improvement_rate))).filter((v): v is number => v != null);
        const improvementRate = rates.length ? Number((rates.reduce((a, b) => a + b, 0) / rates.length).toFixed(3)) : null;
        const scoreTrend = weeks.map((w) => ({ week_start: w.week_start, avg_score: w.avg_score == null ? null : Number(w.avg_score) }));

        // Persistent weaknesses: count weakness id occurrences across weeks.
        const counts = new Map<string, { id: string; title: string; weeks: number }>();
        for (const w of weeks) {
          for (const wk of w.weaknesses || []) {
            const cur = counts.get(wk.id) || { id: wk.id, title: wk.title, weeks: 0 };
            cur.weeks += 1;
            counts.set(wk.id, cur);
          }
        }
        const persistent = Array.from(counts.values()).filter((c) => c.weeks >= PERSISTENT_THRESHOLD).sort((a, b) => b.weeks - a.weeks);

        // Pre-check: not enough weeks to judge a trajectory.
        if (weeks.length < MIN_WEEKS) {
          await saveMonthly(agent.id, monthStart, weeks.length, avgScore, scoreTrend, persistent, improvementRate,
            'low_data', `Only ${weeks.length} weekly report(s) in this month — not enough to assess a trajectory.`);
          results.push({ agent: agent.full_name, trajectory: 'low_data' });
          continue;
        }

        const llm = await callOpenAI(weeks, persistent);
        await saveMonthly(agent.id, monthStart, weeks.length, avgScore, scoreTrend, persistent, improvementRate,
          llm.trajectory, llm.narrative);
        results.push({ agent: agent.full_name, trajectory: llm.trajectory });
      } catch (err: any) {
        console.error(`[monthly-rollup] ${agent.full_name} failed:`, err);
        results.push({ agent: agent.full_name, trajectory: `error: ${err.message}` });
      }
    }

    return NextResponse.json({ status: 'success', month: monthStart, results });
  } catch (err: any) {
    console.error('[monthly-rollup] error:', err);
    return NextResponse.json({ status: 'error', message: err.message || 'Internal error' }, { status: 500 });
  }
}

async function saveMonthly(
  agentId: number, month: string, weeksCount: number, avgScore: number | null,
  scoreTrend: any, persistent: any, improvementRate: number | null,
  trajectory: string, narrative: string
) {
  await query(
    `INSERT INTO monthly_reports
       (agent_id, month, weeks_count, avg_score, score_trend, persistent_weaknesses,
        improvement_rate, trajectory, narrative)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (agent_id, month) DO UPDATE SET
       weeks_count = EXCLUDED.weeks_count, avg_score = EXCLUDED.avg_score,
       score_trend = EXCLUDED.score_trend, persistent_weaknesses = EXCLUDED.persistent_weaknesses,
       improvement_rate = EXCLUDED.improvement_rate, trajectory = EXCLUDED.trajectory,
       narrative = EXCLUDED.narrative`,
    [agentId, month, weeksCount, avgScore, JSON.stringify(scoreTrend), JSON.stringify(persistent),
     improvementRate, trajectory, narrative]
  );
}
