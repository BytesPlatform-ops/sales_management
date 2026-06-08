import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getShiftDate } from '@/lib/shift-date';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST (or GET) /api/cron/daily-eval  — rubric_v2
 * Render Cron: drained by scripts/drain-eval.sh. Auth: Bearer <CRON_SECRET>.
 *
 * Per transcribed call:
 *   1. cheap code pre-filter (duration / word_count)
 *   2. disposition gate (gpt-4o-mini) — only 'connected_conversation' is scored
 *   3. full v2 scorecard (gpt-4o) on un-diarized text, with an explicit speaker-attribution pass
 *   4. store scorecard JSONB + headline columns; aggregate daily_scores
 *
 * Optional ?date=YYYY-MM-DD and ?limit=N (batch drain).
 */

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const CRON_SECRET = process.env.CRON_SECRET || '';
const MODEL_VERSION = 'gpt-4o + gpt-4o-mini(gate) | rubric_v2';
const PROMPT_VERSION = 'daily_eval_v2';

const VALID_CALL_TYPES = new Set(['OutboundExternal', 'InboundExternal']);
const MIN_DURATION_SEC = 30;
const MIN_WORDS = 25;

// numeric 0-10 dimensions + weights for the composite (null-safe, renormalized)
const NUMERIC_DIMS: Record<string, number> = {
  up_front_contract: 1.0,
  pain_identification: 1.5,
  cost_of_inaction: 1.0,
  budget_qualification: 1.0,
  timeline_urgency: 1.0,
  feature_to_value: 1.5,
  active_summarization: 1.0,
  rapport_tone: 1.0,
  objection_validation: 1.5,
};

interface TranscriptRow {
  id: number; agent_id: number; shift_date: string; duration_sec: number;
  call_type: string | null; word_count: number | null; transcript: string | null;
}

// ---------- disposition gate (cheap) ----------
const DISPOSITION_SCHEMA = {
  name: 'call_disposition',
  strict: true,
  schema: {
    type: 'object', additionalProperties: false,
    required: ['disposition'],
    properties: {
      disposition: {
        type: 'string',
        enum: ['connected_conversation', 'voicemail', 'ivr_navigation', 'gatekeeper_only', 'no_answer', 'wrong_number'],
      },
    },
  },
};
const DISPOSITION_PROMPT = `Classify this raw call transcript into exactly one disposition:
- connected_conversation: a real two-party sales conversation took place.
- voicemail: hit an answering machine / voicemail greeting; left a message or none.
- ivr_navigation: automated phone menu / "press 1" system, no human.
- gatekeeper_only: only spoke to a receptionist/gatekeeper, never the prospect.
- no_answer: ringing / immediate hangup / no meaningful speech.
- wrong_number: reached the wrong party.
Output only the schema.`;

// ---------- v2 scorecard (gpt-4o) ----------
const SCORECARD_SCHEMA = {
  name: 'sales_call_scorecard_v2',
  strict: true,
  schema: {
    type: 'object', additionalProperties: false,
    required: [
      'attribution_confidence', 'reconstructed_turns',
      'up_front_contract', 'pain_identification', 'cost_of_inaction',
      'budget_qualification', 'timeline_urgency',
      'feature_to_value', 'active_summarization', 'rapport_tone',
      'objection_validation', 'competitor_positioning',
      'explicit_ask', 'decision_maker_discovery', 'firm_future_commit',
      'talk_balance', 'evidence', 'summary',
    ],
    properties: {
      attribution_confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
      reconstructed_turns: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false, required: ['speaker', 'text'],
          properties: { speaker: { type: 'string', enum: ['agent', 'prospect', 'unclear'] }, text: { type: 'string' } },
        },
      },
      up_front_contract: { type: ['integer', 'null'], minimum: 0, maximum: 10 },
      pain_identification: { type: ['integer', 'null'], minimum: 0, maximum: 10 },
      cost_of_inaction: { type: ['integer', 'null'], minimum: 0, maximum: 10 },
      budget_qualification: { type: ['integer', 'null'], minimum: 0, maximum: 10 },
      timeline_urgency: { type: ['integer', 'null'], minimum: 0, maximum: 10 },
      feature_to_value: { type: ['integer', 'null'], minimum: 0, maximum: 10 },
      active_summarization: { type: ['integer', 'null'], minimum: 0, maximum: 10 },
      rapport_tone: { type: ['integer', 'null'], minimum: 0, maximum: 10 },
      objection_validation: { type: ['integer', 'null'], minimum: 0, maximum: 10 },
      competitor_positioning: { type: ['boolean', 'null'] },
      explicit_ask: { type: 'boolean' },
      decision_maker_discovery: { type: 'boolean' },
      firm_future_commit: { type: 'boolean' },
      talk_balance: { type: 'string', enum: ['balanced', 'agent_dominated', 'prospect_dominated', 'unknown'] },
      evidence: {
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
      },
      summary: { type: 'string' },
    },
  },
};

const SCORECARD_PROMPT = `You are a strict B2B sales-call QA evaluator scoring ONE connected sales call.
The transcript is UN-DIARIZED (no speaker labels). You must FIRST attribute speakers, THEN score.

SPEAKER ATTRIBUTION (do this first, emit reconstructed_turns):
- The AGENT opens, sets agenda, asks qualifying questions, pitches the product, knows pricing/specs,
  handles objections, asks for the meeting, and references their own company/offer.
- The PROSPECT answers, raises concerns about price/timing/fit, references THEIR company/role, and is skeptical.
- On outbound calls the first substantive speaker is almost always the agent.
- When you cannot confidently tell who spoke, mark that turn "unclear", LOWER attribution_confidence,
  and do NOT credit the agent for ambiguous lines.

RUBRIC (0-10; anchors: 0-3 absent/poor, 4-6 partial, 7-10 strong). Use null when the dimension
genuinely had no opportunity to occur — never guess a number:
- up_front_contract: set an agenda + got agreement at the open.
- pain_identification: uncovered a specific, ideally quantified business/technical problem.
- cost_of_inaction: explored consequences of not solving (null if call never went deep).
- budget_qualification: established budget range / authority (null if never broached).
- timeline_urgency: established a decision/implementation timeframe (null if not discussed).
- feature_to_value: mapped capabilities to the prospect's STATED pain (0-3 = feature-dump/monologue).
- active_summarization: reflective listening to confirm understanding (null if no opportunity).
- rapport_tone: courtesy, energy, confidence, professionalism.
- objection_validation: acknowledged objection before pivoting; did not get defensive or instantly drop price.
  null if NO objection arose.
Booleans:
- competitor_positioning: true=handled a competitor well; false=fumbled; null=no competitor mentioned.
- explicit_ask: did the agent directly ask for a next step (regardless of outcome)?
- decision_maker_discovery: did the agent map the buying process / other decision-makers?
- firm_future_commit: did the call end with a concrete next step at a specific date/time?
- talk_balance: inferred; use "unknown" if attribution_confidence is low.

EVIDENCE: for each notable score, cite a VERBATIM quote with attributed_to (agent/prospect/unclear)
and a one-line rationale. Never invent quotes. Output only the schema.`;

// ---------- helpers ----------
function preFilter(call: TranscriptRow): string | null {
  if ((call.duration_sec ?? 0) < MIN_DURATION_SEC) return 'too_short';
  if (call.call_type && !VALID_CALL_TYPES.has(call.call_type)) return 'non_sales';
  const words = call.word_count ?? (call.transcript ? call.transcript.split(/\s+/).filter(Boolean).length : 0);
  if (words < MIN_WORDS) return 'no_customer_speech';
  return null;
}

async function openai(model: string, schema: any, system: string, user: string): Promise<any> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, temperature: 0, seed: 7,
      response_format: { type: 'json_schema', json_schema: schema },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return JSON.parse((await res.json()).choices[0].message.content);
}

const renderUser = (c: TranscriptRow) =>
  `Call metadata: duration=${c.duration_sec}s, call_type=${c.call_type || 'n/a'}\nTranscript (un-diarized):\n${c.transcript || '(empty)'}`;

function computeOverall(sc: any): number | null {
  let num = 0, den = 0;
  for (const [k, w] of Object.entries(NUMERIC_DIMS)) {
    const v = sc[k];
    if (typeof v === 'number') { num += v * w; den += w; }
  }
  return den > 0 ? Number((num / den).toFixed(2)) : null;
}

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

  // per-dimension averages -> metrics JSONB
  const metrics: Record<string, number> = {};
  for (const dim of Object.keys(NUMERIC_DIMS)) {
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

    let evaluated = 0, skipped = 0, failed = 0;
    const NON_CONNECTED: Record<string, string> = {
      voicemail: 'voicemail', ivr_navigation: 'ivr', gatekeeper_only: 'gatekeeper',
      no_answer: 'no_pickup', wrong_number: 'not_a_sales_call',
    };

    for (const call of pending) {
      const skip = preFilter(call);
      if (skip) {
        await insertEval(call, { scorecard: null, disposition: null, attribution_confidence: null, overall: null, meeting: null, not_evaluable: true, reason: skip });
        await query(`UPDATE call_transcripts SET status='evaluated' WHERE id=$1`, [call.id]);
        skipped++;
        continue;
      }
      try {
        // 1) cheap disposition gate
        const { disposition } = await openai('gpt-4o-mini', DISPOSITION_SCHEMA, DISPOSITION_PROMPT, renderUser(call));
        if (disposition !== 'connected_conversation') {
          await insertEval(call, { scorecard: null, disposition, attribution_confidence: null, overall: null, meeting: null, not_evaluable: true, reason: NON_CONNECTED[disposition] || 'not_a_sales_call' });
          await query(`UPDATE call_transcripts SET status='evaluated' WHERE id=$1`, [call.id]);
          skipped++;
          continue;
        }
        // 2) full v2 scorecard
        const sc = await openai('gpt-4o', SCORECARD_SCHEMA, SCORECARD_PROMPT, renderUser(call));
        await insertEval(call, {
          scorecard: sc, disposition, attribution_confidence: sc.attribution_confidence,
          overall: computeOverall(sc), meeting: !!sc.firm_future_commit, not_evaluable: false, reason: null,
        });
        await query(`UPDATE call_transcripts SET status='evaluated' WHERE id=$1`, [call.id]);
        evaluated++;
      } catch (e: any) {
        console.error(`[daily-eval] call ${call.id} failed:`, e.message);
        failed++; // leave status='transcribed' for retry next run
      }
    }

    // aggregate the agents touched this batch
    for (const agentId of Array.from(new Set(pending.map((c) => c.agent_id)))) {
      await aggregateAgent(agentId, shiftDate);
    }

    const remaining = (await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM call_transcripts WHERE status='transcribed' AND shift_date=$1`,
      [shiftDate]
    ))[0]?.n ?? 0;

    return NextResponse.json({ status: 'success', shiftDate, processed: pending.length, evaluated, skipped, failed, remaining });
  } catch (err: any) {
    console.error('[daily-eval] error:', err);
    return NextResponse.json({ status: 'error', message: err.message || 'Internal error' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) { return handle(request); }
export async function POST(request: NextRequest) { return handle(request); }
