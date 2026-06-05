import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // give the LLM calls room (Vercel Pro)

/**
 * POST /api/cron/weekly-coach
 * Vercel Cron: "0 2 * * 1"  (Monday 07:00 PKT). Requires: Authorization: Bearer <CRON_SECRET>.
 *
 * Generates the previous completed week's coaching report (Mon–Sun shift dates) for
 * every active agent. Map-reduce: reads ONLY pre-distilled daily_scores +
 * call_evaluations (never transcripts), so token usage is flat regardless of volume.
 */

const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const CRON_SECRET = process.env.CRON_SECRET!;
const MIN_CALLS_FOR_COACHING = 10;

// Maps a taxonomy `category` to the numeric rubric dimension we can verify against.
// Categories with no scored dimension (opening/discovery/pitch/closing/delivery)
// can't be cross-checked numerically — we leave the LLM's verdict untouched there.
const CATEGORY_TO_DIMENSION: Record<string, 'avg_engagement' | 'avg_technical' | 'avg_objection'> = {
  engagement: 'avg_engagement',
  knowledge: 'avg_technical',
  objection: 'avg_objection',
};

// ---------- date helpers (PKT, no DST) ----------
function pktTodayYMD(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}
function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + n);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

// ---------- types ----------
interface DailyScore {
  shift_date: string; calls_total: number; calls_evaluated: number;
  avg_engagement: number | null; avg_technical: number | null;
  avg_objection: number | null; meetings_scheduled: number; daily_score: number | null;
}
interface WeekAgg {
  calls_evaluated: number; avg_engagement: number | null; avg_technical: number | null;
  avg_objection: number | null; meetings: number; avg_score: number | null;
}
interface PrevReport {
  id: number;
  weaknesses: Array<{ id: string; title: string; severity: string; recommended_fix: string }> | null;
}
interface TaxonomyRow {
  id: string; label: string; category: string; definition: string; coaching_focus: string;
}
interface LLMWeakness { id: string; title: string; severity: string; evidence: string; recommended_fix: string; }
interface LLMImprovement { prev_weakness_id: string; prev_title: string; verdict: 'improved' | 'same' | 'regressed'; evidence: string; }
interface LLMReport {
  strengths: Array<{ title: string; evidence: string }>;
  weaknesses: LLMWeakness[];
  improvement: LLMImprovement[];
  custom_scripts: Array<{ objection: string; suggested_script: string }>;
  improvement_rate: number | null;
  narrative: string;
}

// ---------- structured output schema (mirrors weekly_reports JSONB) ----------
const REPORT_SCHEMA = {
  name: 'weekly_coaching_report',
  strict: true,
  schema: {
    type: 'object', additionalProperties: false,
    required: ['strengths', 'weaknesses', 'improvement', 'custom_scripts', 'improvement_rate', 'narrative'],
    properties: {
      strengths: { type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['title', 'evidence'],
        properties: { title: { type: 'string' }, evidence: { type: 'string' } } } },
      weaknesses: { type: 'array', items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'title', 'severity', 'evidence', 'recommended_fix'],
        properties: {
          id: { type: 'string' }, title: { type: 'string' },
          severity: { type: 'string', enum: ['low', 'medium', 'high'] },
          evidence: { type: 'string' }, recommended_fix: { type: 'string' } } } },
      improvement: { type: 'array', items: {
        type: 'object', additionalProperties: false,
        required: ['prev_weakness_id', 'prev_title', 'verdict', 'evidence'],
        properties: {
          prev_weakness_id: { type: 'string' }, prev_title: { type: 'string' },
          verdict: { type: 'string', enum: ['improved', 'same', 'regressed'] },
          evidence: { type: 'string' } } } },
      custom_scripts: { type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['objection', 'suggested_script'],
        properties: { objection: { type: 'string' }, suggested_script: { type: 'string' } } } },
      improvement_rate: { type: ['number', 'null'] },
      narrative: { type: 'string' },
    },
  },
};

const SYSTEM_PROMPT = `You are an expert B2B sales coach writing this week's coaching report for ONE agent.
You receive: (A) this week's performance data and real call evidence, (B) the controlled
weakness vocabulary you MUST use, and (C) last week's identified weaknesses with prescribed fixes.

YOUR TASKS:
1. STRENGTHS: top 2-3 things the agent did well, each tied to a real quote from this week.
2. WEAKNESSES: top 3. You MUST use \`id\` values from the provided taxonomy ONLY. If a real
   weakness isn't covered, pick the closest id and explain in \`evidence\`. Never invent ids.
   Assign severity low|medium|high.
3. ITERATIVE CHECK (most important): For EACH weakness from LAST week, judge improved|same|regressed,
   grounded in THIS week's evidence or score movement. Rules:
     - "improved" requires positive evidence this week OR a clear score rise on the related dimension.
       Absence of evidence is NOT improvement — default to "same".
     - If the related dimension score did not rise, you may NOT say "improved".
     - Be honest and specific. Do not be encouraging at the expense of accuracy.
4. CUSTOM SCRIPTS: for each CURRENT weakness, a short verbatim line the agent can use next week,
   drawing on the taxonomy's coaching_focus.
5. NARRATIVE: a warm but direct 4-6 sentence summary for the agent to read.

OUTPUT: the structured schema only.`;

// ============================================================
// Vercel Cron triggers via GET; external schedulers may POST. Support both.
export async function GET(request: NextRequest) {
  return POST(request);
}

export async function POST(request: NextRequest) {
  // --- auth ---
  const provided = request.headers.get('authorization')?.replace('Bearer ', '');
  if (!provided || provided !== CRON_SECRET) {
    return NextResponse.json({ status: 'error', message: 'Invalid secret' }, { status: 403 });
  }

  // --- week windows (previous completed Mon–Sun of shift dates) ---
  const today = pktTodayYMD();              // Monday
  const weekEnd = addDays(today, -1);       // Sunday
  const weekStart = addDays(weekEnd, -6);   // Monday
  const prevStart = addDays(weekStart, -7);
  const prevEnd = addDays(weekEnd, -7);

  // --- taxonomy loaded once, shared across all agents ---
  const taxonomy = await query<TaxonomyRow>(
    `SELECT id, label, category, definition, coaching_focus
     FROM weakness_taxonomy WHERE deprecated = false ORDER BY category, id`
  );
  const taxoById = new Map(taxonomy.map((t) => [t.id, t]));
  const taxonomyBlock = taxonomy
    .map((t) => `- ${t.id} (${t.label}, ${t.category}): ${t.definition} | fix: ${t.coaching_focus}`)
    .join('\n');

  const agents = await query<{ id: number; full_name: string }>(
    `SELECT id, full_name FROM users WHERE role = 'agent' AND is_active = true ORDER BY full_name`
  );

  const results: Array<{ agent: string; status: string }> = [];

  for (const agent of agents) {
    try {
      // ===== GATHER PHASE (pure SQL) =====
      const daily = await query<DailyScore>(
        `SELECT shift_date, calls_total, calls_evaluated, avg_engagement, avg_technical,
                avg_objection, meetings_scheduled, daily_score
         FROM daily_scores
         WHERE agent_id = $1 AND shift_date BETWEEN $2 AND $3
         ORDER BY shift_date ASC`,
        [agent.id, weekStart, weekEnd]
      );

      // This week's per-dimension aggregate (the numeric basis for the guardrail)
      const thisAgg = await queryOne<WeekAgg>(
        `SELECT
           COUNT(*) FILTER (WHERE NOT not_evaluable)::int AS calls_evaluated,
           AVG(engagement)          FILTER (WHERE engagement IS NOT NULL)          AS avg_engagement,
           AVG(technical_knowledge) FILTER (WHERE technical_knowledge IS NOT NULL) AS avg_technical,
           AVG(objection_handling)  FILTER (WHERE objection_handling IS NOT NULL)  AS avg_objection,
           COUNT(*) FILTER (WHERE meeting_scheduled)::int AS meetings,
           AVG(overall_score)       FILTER (WHERE NOT not_evaluable)              AS avg_score
         FROM call_evaluations
         WHERE agent_id = $1 AND shift_date BETWEEN $2 AND $3`,
        [agent.id, weekStart, weekEnd]
      );
      const callsEvaluated = thisAgg?.calls_evaluated ?? 0;

      // ===== PRE-CHECK: not enough data to coach on =====
      if (callsEvaluated < MIN_CALLS_FOR_COACHING) {
        await saveReport(agent.id, weekStart, weekEnd, null, {
          strengths: [], weaknesses: [], improvement: [], custom_scripts: [],
          improvement_rate: null,
          narrative: `Only ${callsEvaluated} evaluable call(s) this week — too few for reliable coaching. No coaching generated; encourage more call volume.`,
        }, thisAgg, 'low_data');
        results.push({ agent: agent.full_name, status: `low_data (${callsEvaluated} calls)` });
        continue;
      }

      // Worst 3 evidence quotes per dimension (the coachable moments)
      const worstEvidence = await query<any>(
        `SELECT dimension, quote, speaker, rationale, overall_score FROM (
           SELECT e.overall_score, ev->>'dimension' AS dimension, ev->>'quote' AS quote,
                  ev->>'speaker' AS speaker, ev->>'rationale' AS rationale,
                  ROW_NUMBER() OVER (PARTITION BY ev->>'dimension' ORDER BY e.overall_score ASC) AS rn
           FROM call_evaluations e, jsonb_array_elements(e.evidence) ev
           WHERE e.agent_id = $1 AND e.shift_date BETWEEN $2 AND $3 AND NOT e.not_evaluable
         ) ranked WHERE rn <= 3`,
        [agent.id, weekStart, weekEnd]
      );

      // A few "wins" — evidence from calls that booked a meeting (feeds strengths)
      const winEvidence = await query<any>(
        `SELECT ev->>'dimension' AS dimension, ev->>'quote' AS quote, ev->>'rationale' AS rationale
         FROM call_evaluations e, jsonb_array_elements(e.evidence) ev
         WHERE e.agent_id = $1 AND e.shift_date BETWEEN $2 AND $3 AND e.meeting_scheduled = true
         LIMIT 5`,
        [agent.id, weekStart, weekEnd]
      );

      // Last week's report (the iterative chain) + last week's per-dimension averages
      const prev = await queryOne<PrevReport>(
        `SELECT id, weaknesses FROM weekly_reports
         WHERE agent_id = $1 AND week_start = $2 LIMIT 1`,
        [agent.id, prevStart]
      );
      const prevAgg = await queryOne<WeekAgg>(
        `SELECT
           AVG(engagement)          FILTER (WHERE engagement IS NOT NULL)          AS avg_engagement,
           AVG(technical_knowledge) FILTER (WHERE technical_knowledge IS NOT NULL) AS avg_technical,
           AVG(objection_handling)  FILTER (WHERE objection_handling IS NOT NULL)  AS avg_objection
         FROM call_evaluations
         WHERE agent_id = $1 AND shift_date BETWEEN $2 AND $3`,
        [agent.id, prevStart, prevEnd]
      );
      const prevWeaknesses = prev?.weaknesses ?? [];

      // ===== BUILD MESSAGES =====
      const userContent = [
        `AGENT: ${agent.full_name}`,
        `WEEK: ${weekStart} to ${weekEnd}`,
        ``,
        `== (A) THIS WEEK'S DATA ==`,
        `Daily scores:`,
        ...daily.map((d) =>
          `  ${d.shift_date}: calls=${d.calls_evaluated}/${d.calls_total} eng=${fmt(d.avg_engagement)} tech=${fmt(d.avg_technical)} obj=${fmt(d.avg_objection)} meetings=${d.meetings_scheduled} score=${fmt(d.daily_score)}`),
        `Week averages: engagement=${fmt(thisAgg?.avg_engagement)} technical=${fmt(thisAgg?.avg_technical)} objection=${fmt(thisAgg?.avg_objection)} meetings=${thisAgg?.meetings} overall=${fmt(thisAgg?.avg_score)}`,
        ``,
        `Worst-scoring moments (per dimension):`,
        ...worstEvidence.map((e) => `  [${e.dimension}] ${e.speaker}: "${e.quote}" — ${e.rationale}`),
        ``,
        `Wins (from calls that booked a meeting):`,
        ...winEvidence.map((e) => `  [${e.dimension}] "${e.quote}" — ${e.rationale}`),
        ``,
        `== (B) WEAKNESS TAXONOMY (use these ids ONLY) ==`,
        taxonomyBlock,
        ``,
        `== (C) LAST WEEK'S WEAKNESSES (check improvement on each) ==`,
        prevWeaknesses.length
          ? prevWeaknesses.map((w) => `  ${w.id} (${w.title}) — fix prescribed: ${w.recommended_fix}`).join('\n')
          : `  (none — this is the agent's BASELINE week; return improvement: [] and improvement_rate: null)`,
      ].join('\n');

      // ===== OPENAI CALL (gpt-4o) =====
      const llm = await callOpenAI([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ]);

      // ===== CODE GUARDRAIL: cross-check improvement verdicts against the math =====
      const guarded = applyImprovementGuardrail(llm, prevWeaknesses, taxoById, thisAgg, prevAgg);

      await saveReport(agent.id, weekStart, weekEnd, prev?.id ?? null, guarded, thisAgg, 'draft');
      results.push({ agent: agent.full_name, status: `draft (rate ${guarded.improvement_rate ?? 'n/a'})` });
    } catch (err: any) {
      console.error(`[weekly-coach] ${agent.full_name} failed:`, err);
      results.push({ agent: agent.full_name, status: `error: ${err.message}` });
    }
  }

  return NextResponse.json({ status: 'success', weekStart, weekEnd, results });
}

// ---------- the guardrail ----------
function applyImprovementGuardrail(
  llm: LLMReport,
  prevWeaknesses: PrevReport['weaknesses'],
  taxoById: Map<string, TaxonomyRow>,
  thisAgg: WeekAgg | null,
  prevAgg: WeekAgg | null
): LLMReport {
  const downgrades: string[] = [];

  const improvement = (llm.improvement || []).map((imp) => {
    if (imp.verdict !== 'improved') return imp;

    // Which numeric dimension (if any) backs this weakness?
    const taxo = taxoById.get(imp.prev_weakness_id);
    const dimKey = taxo ? CATEGORY_TO_DIMENSION[taxo.category] : undefined;
    if (!dimKey) return imp; // non-numeric category (opening/pitch/etc.) — trust the LLM

    const now = thisAgg?.[dimKey] != null ? Number(thisAgg[dimKey]) : null;
    const before = prevAgg?.[dimKey] != null ? Number(prevAgg[dimKey]) : null;

    // If we have both numbers and the score did NOT rise, the LLM may not claim "improved".
    if (now != null && before != null && now <= before) {
      downgrades.push(`${imp.prev_weakness_id}: claimed improved but ${dimKey} ${before.toFixed(1)}→${now.toFixed(1)}`);
      return {
        ...imp,
        verdict: 'same' as const,
        evidence: `${imp.evidence} [Auto-adjusted to "same": ${dimKey.replace('avg_', '')} score did not rise (${before.toFixed(1)}→${now.toFixed(1)}).]`,
      };
    }
    return imp;
  });

  if (downgrades.length) console.warn('[weekly-coach] guardrail downgrades:', downgrades);

  // Recompute improvement_rate from the FINAL (post-guardrail) verdicts — never trust the LLM's number.
  const total = prevWeaknesses?.length ?? 0;
  const improvedCount = improvement.filter((i) => i.verdict === 'improved').length;
  const improvement_rate = total > 0 ? Number((improvedCount / total).toFixed(3)) : null;

  return { ...llm, improvement, improvement_rate };
}

// ---------- OpenAI via fetch (no SDK dependency) ----------
async function callOpenAI(messages: Array<{ role: string; content: string }>): Promise<LLMReport> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      temperature: 0.4, // a little warmth for coaching prose; structure is enforced by schema
      response_format: { type: 'json_schema', json_schema: REPORT_SCHEMA },
      messages,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content) as LLMReport;
}

// ---------- save as draft ----------
async function saveReport(
  agentId: number, weekStart: string, weekEnd: string,
  prevReportId: number | null, report: LLMReport, agg: WeekAgg | null,
  status: 'draft' | 'low_data'
) {
  await query(
    `INSERT INTO weekly_reports
       (agent_id, week_start, week_end, prev_report_id, avg_score, calls_count, meetings_count,
        strengths, weaknesses, custom_scripts, improvement, improvement_rate, narrative, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (agent_id, week_start) DO UPDATE SET
       week_end = EXCLUDED.week_end, prev_report_id = EXCLUDED.prev_report_id,
       avg_score = EXCLUDED.avg_score, calls_count = EXCLUDED.calls_count,
       meetings_count = EXCLUDED.meetings_count, strengths = EXCLUDED.strengths,
       weaknesses = EXCLUDED.weaknesses, custom_scripts = EXCLUDED.custom_scripts,
       improvement = EXCLUDED.improvement, improvement_rate = EXCLUDED.improvement_rate,
       narrative = EXCLUDED.narrative, status = EXCLUDED.status`,
    [
      agentId, weekStart, weekEnd, prevReportId,
      agg?.avg_score ?? null, agg?.calls_evaluated ?? 0, agg?.meetings ?? 0,
      JSON.stringify(report.strengths), JSON.stringify(report.weaknesses),
      JSON.stringify(report.custom_scripts), JSON.stringify(report.improvement),
      report.improvement_rate, report.narrative, status,
    ]
  );
}

const fmt = (n: number | null | undefined) => (n == null ? '—' : Number(n).toFixed(1));
