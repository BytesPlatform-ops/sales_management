import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getShiftDate } from '@/lib/shift-date';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST (or GET) /api/cron/daily-eval  — rubric_v3 (DUAL RUBRIC)
 * Render Cron: drained by scripts/drain-eval.sh. Auth: Bearer <CRON_SECRET>.
 *
 * Routing by call length (so 2-min cold calls aren't judged like 30-min discovery calls):
 *   duration_sec <  180  -> COLD_CALL rubric   (goal: earn a meeting)
 *   duration_sec >= 180  -> DISCOVERY rubric    (full MEDDIC/SPIN scorecard)
 *
 * Both rubrics run on UN-DIARIZED text: gpt-4o first classifies `disposition`
 * and reconstructs `reconstructed_turns` (agent/prospect attribution) before scoring.
 * Only `connected_conversation` is scored; everything else -> not_evaluable.
 *
 * overall_score is computed in code (mean of non-null numeric dims) — not trusted to the LLM.
 * The full scorecard is stored in the call_evaluations.scorecard JSONB column.
 *
 * Optional ?date=YYYY-MM-DD and ?limit=N (batch drain).
 */

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const CRON_SECRET = process.env.CRON_SECRET || '';
const MODEL_VERSION = 'gpt-4o | rubric_v3_2_dual';
const PROMPT_VERSION = 'daily_eval_v3_2_coach';

const VALID_CALL_TYPES = new Set(['OutboundExternal', 'InboundExternal']);
// Below this, the call never became a real conversation (instant rejection / hang-up) — not gradeable.
const MIN_DURATION_SEC = 50;
const MIN_WORDS = 25;
const DISCOVERY_THRESHOLD_SEC = 180;

// numeric dims that feed overall_score (simple mean of non-nulls), per rubric
const COLD_NUMERIC = ['up_front_contract', 'rapport_tone', 'objection_validation'];
const DISCOVERY_NUMERIC = [
  'up_front_contract', 'pain_identification', 'cost_of_inaction',
  'budget_qualification', 'timeline_urgency', 'feature_to_value', 'objection_validation',
];
// union, for the daily_scores.metrics roll-up
const ALL_NUMERIC = Array.from(new Set([...COLD_NUMERIC, ...DISCOVERY_NUMERIC, 'rapport_tone']));

interface TranscriptRow {
  id: number; agent_id: number; shift_date: string; duration_sec: number;
  call_type: string | null; word_count: number | null; transcript: string | null;
}

// ---------- shared schema fragments (un-diarized guardrails) ----------
const DISPOSITION_ENUM = ['connected_conversation', 'voicemail', 'ivr_navigation', 'gatekeeper_only', 'no_answer', 'wrong_number'];
const RECONSTRUCTED_TURNS = {
  type: 'array',
  items: {
    type: 'object', additionalProperties: false, required: ['speaker', 'text'],
    properties: { speaker: { type: 'string', enum: ['agent', 'prospect', 'unclear'] }, text: { type: 'string' } },
  },
};
const EVIDENCE = {
  type: 'array',
  items: {
    type: 'object', additionalProperties: false,
    required: ['parameter', 'quote', 'attributed_to', 'rationale'],
    properties: {
      parameter: { type: 'string' },
      quote: { type: 'string' },
      attributed_to: { type: 'string', enum: ['agent', 'prospect', 'unclear'] },
      rationale: { type: 'string' },
    },
  },
};
const score10 = { type: ['integer', 'null'], minimum: 0, maximum: 10 } as const;

// ---------- coaching fragment (per-call actionable feedback, both rubrics) ----------
const COACHING = {
  type: 'object',
  additionalProperties: false,
  required: ['did_well', 'key_fix', 'say_this_instead', 'next_call_focus'],
  properties: {
    // the single best real thing the agent did, quoting the moment. Never invented praise.
    did_well: { type: 'string' },
    // the ONE highest-leverage change — name the behavior and its cost, never personality.
    key_fix: { type: 'string' },
    // 1-2 weak->strong rewrites. `moment` MUST be quoted from the transcript (never invented).
    say_this_instead: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['moment', 'rewrite', 'why'],
        properties: {
          moment: { type: 'string' },   // what the agent actually said
          rewrite: { type: 'string' },  // a stronger line in the rep's natural spoken register
          why: { type: 'string' },      // one-sentence mechanism
        },
      },
    },
    // one short line — the only thing to remember on the next dial.
    next_call_focus: { type: 'string' },
  },
};

// ---------- Schema A: COLD CALL ----------
const COLD_SCHEMA = {
  name: 'cold_call_scorecard',
  strict: true,
  schema: {
    type: 'object', additionalProperties: false,
    required: ['disposition', 'reconstructed_turns', 'attribution_confidence',
      'up_front_contract', 'rapport_tone', 'objection_validation',
      'explicit_ask', 'firm_future_commit', 'evidence', 'summary', 'coaching'],
    properties: {
      disposition: { type: 'string', enum: DISPOSITION_ENUM },
      reconstructed_turns: RECONSTRUCTED_TURNS,
      attribution_confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
      up_front_contract: score10,
      rapport_tone: score10,
      objection_validation: score10,        // null-safe
      explicit_ask: { type: 'boolean' },
      firm_future_commit: { type: 'boolean' },
      evidence: EVIDENCE,
      summary: { type: 'string' },
      coaching: COACHING,
    },
  },
};

// ---------- Schema B: DISCOVERY CALL ----------
const DISCOVERY_SCHEMA = {
  name: 'discovery_call_scorecard',
  strict: true,
  schema: {
    type: 'object', additionalProperties: false,
    required: ['disposition', 'reconstructed_turns', 'attribution_confidence',
      'up_front_contract', 'pain_identification', 'cost_of_inaction',
      'budget_qualification', 'timeline_urgency', 'feature_to_value', 'objection_validation',
      'decision_maker_discovery', 'firm_future_commit', 'evidence', 'summary', 'coaching'],
    properties: {
      disposition: { type: 'string', enum: DISPOSITION_ENUM },
      reconstructed_turns: RECONSTRUCTED_TURNS,
      attribution_confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
      up_front_contract: score10,
      pain_identification: score10,
      cost_of_inaction: score10,             // null-safe
      budget_qualification: score10,         // null-safe
      timeline_urgency: score10,             // null-safe
      feature_to_value: score10,
      objection_validation: score10,         // null-safe
      decision_maker_discovery: { type: 'boolean' },
      firm_future_commit: { type: 'boolean' },
      evidence: EVIDENCE,
      summary: { type: 'string' },
      coaching: COACHING,
    },
  },
};

// ---------- shared guardrail (prepended to both prompts) ----------
const GUARDRAIL = `The transcript is UN-DIARIZED (no speaker labels). FIRST do these, THEN score:
1. disposition — classify the call: connected_conversation | voicemail | ivr_navigation |
   gatekeeper_only | no_answer | wrong_number. Only score a connected_conversation; if it is
   anything else, still output the schema but you may leave scores at their lowest/false.
2. reconstructed_turns — attribute each turn to agent | prospect | unclear:
   - The AGENT opens, asks questions, pitches, knows the product/offer, asks for a meeting.
   - The PROSPECT answers, raises concerns, references THEIR company, is skeptical.
   - On outbound calls the first substantive speaker is almost always the agent.
   - If unsure who spoke, mark "unclear", LOWER attribution_confidence, and do NOT credit the agent.
SCORING BANDS: 0-2 absent/not attempted · 3-5 attempted but weak/generic · 6-7 solid & competent ·
8-10 strong/expert. A clear, courteous, professional delivery defaults to 5-6 (NOT 3) — only score
below 3 when the dimension was essentially absent. Use null ONLY for null-safe dimensions that had
no opportunity to occur (e.g. no objection arose). EVIDENCE: cite verbatim quotes with attributed_to.
Never invent quotes.

COACHING (the \`coaching\` object) — write like a sharp VP of Sales who has run 10,000 calls, NOT a
chatbot. The rep should be able to act on it on their very next dial:
- did_well: the single best REAL thing the agent did, quoting the moment. On a weak call, find the
  least-bad real thing — never invent praise, never "great job / good energy".
- key_fix: the ONE highest-leverage change. Name the BEHAVIOR and its cost ("you pitched before you
  found a problem, so your value had nothing to land on"). Behavior, never personality. Pick exactly one.
- say_this_instead: 1-2 rewrites. \`moment\` = what the agent ACTUALLY said (quote the transcript,
  never invent). \`rewrite\` = a stronger line in the rep's natural SPOKEN register (not corporate).
  \`why\` = one sentence on the mechanism. Strip minimizers ("just", "real quick", "sorry to bother").
- next_call_focus: one short line — the only thing they must remember next time.
Be honest over flattering, specific over generic. Banned: "build rapport", "be more confident",
"improve discovery" with no concrete line. If not a connected_conversation, keep coaching to one line.
Output only the schema.`;

const COLD_PROMPT = `You are a seasoned B2B cold-calling coach grading a SHORT COLD CALL (< 3 minutes). Your
standards come from real top-performer data (Gong's 300M-call analysis), Josh Braun, Jeb Blount and
30MPC. A cold call's ONLY job is to earn a next meeting — do NOT expect deep discovery.
${GUARDRAIL}
Score each 0-10:
- up_front_contract (the opener + reason for calling): did the agent earn the right to the next 30
  seconds with a clear, honest reason? REWARD: honest/permission openers ("I know I'm an interruption
  — got 30 seconds?"), a specific trigger, a problem-led reason for the call. PENALIZE hard: the
  status-lowering "did I catch you at a bad time?" (lowest-converting opener there is), fake rapport
  ("how's your day going?"), and buzzword/feature-dump opens ("we're a leading all-in-one platform…")
  with no problem named.
- rapport_tone: courtesy, calm confidence, unhurried pace, control of the call. Polite & professional
  = 5-6; 7+ = genuinely warm/disarming; below 3 only for rude/robotic/rushed/needy delivery.
- objection_validation: when the prospect pushed back, did the agent ACKNOWLEDGE it before pivoting —
  a label ("sounds like the timing's rough"), a mirror, or "totally fair"? REWARD acknowledge -> one
  exploring question -> ask. PENALIZE steamrolling, ignoring it, pitching harder, arguing, or the
  dated/manipulative "feel-felt-found". null if no objection arose.
- explicit_ask: did the agent directly ask for a SPECIFIC next step (assumptive, a real day/time)? A
  vague "can I send you some info?" is NOT a real ask.
- firm_future_commit: did the call end with a concrete meeting at a specific time?`;

const DISCOVERY_PROMPT = `You are a seasoned B2B discovery coach grading a DISCOVERY CALL (>= 3 minutes),
to the standard of SPIN Selling, the Sandler pain funnel, MEDDIC and Gong's discovery data. Hold it to
a high consultative bar. GOLDEN RULE: a great rep develops and QUANTIFIES the problem BEFORE pitching
anything — premature pitching is the cardinal sin.
${GUARDRAIL}
Score each 0-10:
- up_front_contract: set a clear agenda and got the prospect's agreement at the open.
- pain_identification: uncovered a SPECIFIC, ideally quantified problem, moving surface -> business
  impact -> personal stake. A vague "we want more leads" with no numbers and no follow-up = 3-5;
  a problem nailed down to a number and an owner = 7+.
- cost_of_inaction (THE highest-leverage discovery skill): did the agent make the problem expensive
  and urgent — "what does that cost you per month?", "what happens if nothing changes?" — ideally
  getting the PROSPECT to say the number? null if never reached.
- budget_qualification: budget broached via value/range framing, not a crass "what's your budget?"
  (null if not broached).
- timeline_urgency: a real compelling event / why-now established (null if not discussed).
- feature_to_value: was every capability tied back to a pain the prospect ALREADY STATED
  ("…which means for you, that downtime you mentioned stops")? An untethered feature list or a
  product monologue = 0-3.
- objection_validation: acknowledged concerns before pivoting — label/mirror, not steamrolling or
  feel-felt-found (null if none arose).
- decision_maker_discovery: mapped the buying process / other stakeholders / economic buyer?
- firm_future_commit: ended with a concrete next step at a specific date/time?`;

// ---------- helpers ----------
function preFilter(call: TranscriptRow): string | null {
  if ((call.duration_sec ?? 0) < MIN_DURATION_SEC) return 'too_short';
  if (call.call_type && !VALID_CALL_TYPES.has(call.call_type)) return 'non_sales';
  const words = call.word_count ?? (call.transcript ? call.transcript.split(/\s+/).filter(Boolean).length : 0);
  if (words < MIN_WORDS) return 'no_customer_speech';
  return null;
}

async function scoreWithOpenAI(schema: any, system: string, user: string): Promise<any> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o', temperature: 0, seed: 7,
      response_format: { type: 'json_schema', json_schema: schema },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return JSON.parse((await res.json()).choices[0].message.content);
}

const renderUser = (c: TranscriptRow) =>
  `Call metadata: duration=${c.duration_sec}s, call_type=${c.call_type || 'n/a'}\nTranscript (un-diarized):\n${c.transcript || '(empty)'}`;

// simple mean of non-null numeric dims (per the rubric's dim set), rounded to 2dp
function meanOfNonNull(sc: any, dims: string[]): number | null {
  const vals = dims.map((d) => sc[d]).filter((v) => typeof v === 'number');
  return vals.length ? Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2)) : null;
}

const NON_CONNECTED: Record<string, string> = {
  voicemail: 'voicemail', ivr_navigation: 'ivr', gatekeeper_only: 'gatekeeper',
  no_answer: 'no_pickup', wrong_number: 'not_a_sales_call',
};

async function insertEval(call: TranscriptRow, opts: {
  scorecard: any | null; disposition: string | null; attribution_confidence: string | null;
  overall: number | null; meeting: boolean | null; not_evaluable: boolean; reason: string | null;
}) {
  await query(
    `INSERT INTO call_evaluations
       (transcript_id, agent_id, shift_date, meeting_scheduled, overall_score,
        scorecard, disposition, attribution_confidence,
        not_evaluable, not_evaluable_reason, model_version, prompt_version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (transcript_id) DO NOTHING`,
    [call.id, call.agent_id, call.shift_date, opts.meeting, opts.overall,
     opts.scorecard ? JSON.stringify(opts.scorecard) : null, opts.disposition, opts.attribution_confidence,
     opts.not_evaluable, opts.reason, MODEL_VERSION, PROMPT_VERSION]
  );
}

async function aggregateAgent(agentId: number, shiftDate: string) {
  const evals = await query<any>(
    `SELECT overall_score, meeting_scheduled, not_evaluable, scorecard
     FROM call_evaluations WHERE agent_id = $1 AND shift_date = $2`,
    [agentId, shiftDate]
  );
  const total = evals.length;
  const graded = evals.filter((e) => !e.not_evaluable && e.scorecard);
  const meetings = evals.filter((e) => e.meeting_scheduled).length;
  const overalls = graded.map((e) => Number(e.overall_score)).filter((n) => !isNaN(n));
  const dailyScore = overalls.length ? Number((overalls.reduce((a, b) => a + b, 0) / overalls.length).toFixed(2)) : null;

  const metrics: Record<string, number> = {};
  for (const dim of ALL_NUMERIC) {
    const vals = graded.map((e) => e.scorecard?.[dim]).filter((v: any) => typeof v === 'number');
    if (vals.length) metrics[dim] = Number((vals.reduce((a: number, b: number) => a + b, 0) / vals.length).toFixed(2));
  }

  await query(
    `INSERT INTO daily_scores
       (agent_id, shift_date, calls_total, calls_evaluated, meetings_scheduled, daily_score, metrics)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (agent_id, shift_date) DO UPDATE SET
       calls_total = EXCLUDED.calls_total, calls_evaluated = EXCLUDED.calls_evaluated,
       meetings_scheduled = EXCLUDED.meetings_scheduled, daily_score = EXCLUDED.daily_score,
       metrics = EXCLUDED.metrics`,
    [agentId, shiftDate, total, graded.length, meetings, dailyScore, JSON.stringify(metrics)]
  );
}

// ---------- handler ----------
async function handle(request: NextRequest) {
  const provided = request.headers.get('authorization')?.replace('Bearer ', '');
  if (!provided || provided !== CRON_SECRET) {
    return NextResponse.json({ status: 'error', message: 'Invalid secret' }, { status: 403 });
  }
  try {
    const url = new URL(request.url);
    const shiftDate = url.searchParams.get('date') || getShiftDate(new Date());
    const limit = Math.min(Number(url.searchParams.get('limit')) || 40, 500);

    const pending = await query<TranscriptRow>(
      `SELECT id, agent_id, shift_date, duration_sec, call_type, word_count, transcript
       FROM call_transcripts
       WHERE status = 'transcribed' AND shift_date = $1
       ORDER BY agent_id, call_started_at
       LIMIT $2`,
      [shiftDate, limit]
    );

    let evaluated = 0, skipped = 0, failed = 0, cold = 0, discovery = 0;

    for (const call of pending) {
      const skip = preFilter(call);
      if (skip) {
        await insertEval(call, { scorecard: null, disposition: null, attribution_confidence: null, overall: null, meeting: null, not_evaluable: true, reason: skip });
        await query(`UPDATE call_transcripts SET status='evaluated' WHERE id=$1`, [call.id]);
        skipped++;
        continue;
      }
      try {
        // ROUTE by duration
        const isCold = call.duration_sec < DISCOVERY_THRESHOLD_SEC;
        const sc = isCold
          ? await scoreWithOpenAI(COLD_SCHEMA, COLD_PROMPT, renderUser(call))
          : await scoreWithOpenAI(DISCOVERY_SCHEMA, DISCOVERY_PROMPT, renderUser(call));

        // disposition gate (folded into the scored call)
        if (sc.disposition && sc.disposition !== 'connected_conversation') {
          await insertEval(call, {
            scorecard: null, disposition: sc.disposition, attribution_confidence: sc.attribution_confidence,
            overall: null, meeting: null, not_evaluable: true, reason: NON_CONNECTED[sc.disposition] || 'not_a_sales_call',
          });
          await query(`UPDATE call_transcripts SET status='evaluated' WHERE id=$1`, [call.id]);
          skipped++;
          continue;
        }

        const numericDims = isCold ? COLD_NUMERIC : DISCOVERY_NUMERIC;
        let overall = meanOfNonNull(sc, numericDims);
        // A cold call exists to earn a meeting — reward the ask, and especially a booked meeting,
        // otherwise Overall ignores the one thing the call is actually for. (Booking lifts cold more
        // than discovery, since cold has fewer scored dims and the meeting IS the outcome.)
        if (overall != null) {
          if (sc.firm_future_commit) overall = Math.min(10, overall + (isCold ? 2.5 : 1.5));
          else if (isCold && sc.explicit_ask) overall = Math.min(10, overall + 1);
          overall = Number(overall.toFixed(2));
        }
        // tag the rubric used + the code-computed overall so the dashboard/aggregation are authoritative
        const scorecard = { ...sc, rubric: isCold ? 'cold' : 'discovery', overall_score: overall };

        await insertEval(call, {
          scorecard, disposition: sc.disposition || 'connected_conversation',
          attribution_confidence: sc.attribution_confidence,
          overall, meeting: !!sc.firm_future_commit, not_evaluable: false, reason: null,
        });
        await query(`UPDATE call_transcripts SET status='evaluated' WHERE id=$1`, [call.id]);
        evaluated++;
        isCold ? cold++ : discovery++;
      } catch (e: any) {
        console.error(`[daily-eval] call ${call.id} failed:`, e.message);
        failed++; // leave status='transcribed' for retry
      }
    }

    for (const agentId of Array.from(new Set(pending.map((c) => c.agent_id)))) {
      await aggregateAgent(agentId, shiftDate);
    }

    const remaining = (await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM call_transcripts WHERE status='transcribed' AND shift_date=$1`,
      [shiftDate]
    ))[0]?.n ?? 0;

    return NextResponse.json({ status: 'success', shiftDate, processed: pending.length, evaluated, cold, discovery, skipped, failed, remaining });
  } catch (err: any) {
    console.error('[daily-eval] error:', err);
    return NextResponse.json({ status: 'error', message: err.message || 'Internal error' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) { return handle(request); }
export async function POST(request: NextRequest) { return handle(request); }
