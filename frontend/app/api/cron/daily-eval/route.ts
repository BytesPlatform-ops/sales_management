import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getShiftDate } from '@/lib/shift-date';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST (or GET) /api/cron/daily-eval
 * Render Cron: "0 1 * * *" (06:00 PKT). Requires: Authorization: Bearer <CRON_SECRET>.
 *
 * Grades every 'transcribed' call for the just-completed shift against the fixed
 * rubric (gpt-4o-mini, strict JSON), writes call_evaluations, then aggregates
 * daily_scores. Pre-filters junk before spending a token. Idempotent.
 *
 * Optional ?date=YYYY-MM-DD to evaluate a specific shift (backfill / manual run).
 */

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const CRON_SECRET = process.env.CRON_SECRET || '';
const MODEL_VERSION = 'gpt-4o | rubric_v1';
const PROMPT_VERSION = 'daily_eval_v1';

const VALID_CALL_TYPES = new Set(['OutboundExternal', 'InboundExternal']);
const MIN_DURATION_SEC = 30;
const MIN_WORDS = 25;

// ---------- types ----------
interface TranscriptRow {
  id: number;
  agent_id: number;
  shift_date: string;
  duration_sec: number;
  call_type: string | null;
  talk_ratio: number | string | null;
  word_count: number | null;
  transcript: string | null;
  transcript_json: { speakers?: Record<string, string>; speaker_mapping_suspect?: boolean; turns?: Array<{ speaker: string; text: string }> } | null;
}
interface Evaluation {
  not_evaluable: boolean;
  not_evaluable_reason: string | null;
  engagement: number | null;
  technical_knowledge: number | null;
  objection_handling: number | null;
  meeting_scheduled: boolean | null;
  reasons: Record<string, string>;
  evidence: Array<{ dimension: string; quote: string; speaker: string; rationale: string }>;
  speaker_mapping_suspect: boolean;
}

// ---------- strict structured-output schema (Step 2) ----------
const DAILY_EVAL_SCHEMA = {
  name: 'daily_call_evaluation',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['not_evaluable', 'not_evaluable_reason', 'engagement', 'technical_knowledge',
      'objection_handling', 'meeting_scheduled', 'reasons', 'evidence', 'speaker_mapping_suspect'],
    properties: {
      not_evaluable: { type: 'boolean' },
      not_evaluable_reason: { type: ['string', 'null'], enum: ['no_pickup', 'too_short', 'no_customer_speech', 'non_sales', null] },
      engagement: { type: ['integer', 'null'], minimum: 0, maximum: 10 },
      technical_knowledge: { type: ['integer', 'null'], minimum: 0, maximum: 10 },
      objection_handling: { type: ['integer', 'null'], minimum: 0, maximum: 10 },
      meeting_scheduled: { type: ['boolean', 'null'] },
      reasons: {
        type: 'object', additionalProperties: false,
        required: ['engagement', 'technical_knowledge', 'objection_handling', 'meeting_scheduled'],
        properties: {
          engagement: { type: 'string' },
          technical_knowledge: { type: 'string' },
          objection_handling: { type: 'string' },
          meeting_scheduled: { type: 'string' },
        },
      },
      evidence: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['dimension', 'quote', 'speaker', 'rationale'],
          properties: {
            dimension: { type: 'string', enum: ['engagement', 'technical_knowledge', 'objection_handling', 'meeting_scheduled'] },
            quote: { type: 'string' },
            speaker: { type: 'string', enum: ['agent', 'customer'] },
            rationale: { type: 'string' },
          },
        },
      },
      speaker_mapping_suspect: { type: 'boolean' },
    },
  },
};

const SYSTEM_PROMPT = `You are a strict, consistent B2B sales-call QA evaluator. You score exactly ONE
outbound/inbound sales call against a fixed rubric and output ONLY the required JSON schema.
You never coach or editorialize — you score and cite evidence. Identical transcripts must
always receive identical scores.

INPUT: a transcript plus metadata (duration, agent talk_ratio). Lines may be tagged
[agent]/[customer] (diarized) OR [speaker] (diarization unavailable). If lines are [speaker]
or speaker_mapping_suspect is true, you cannot reliably attribute who spoke — score engagement
and objection handling from overall content, do NOT penalize for the missing speaker split,
and set speaker_mapping_suspect true in your output.

RUBRIC — score each 0–10:
engagement (rapport + active listening + talk balance):
  0–3 monologues/interrupts/ignores cues; 4–6 functional but uneven; 7–10 strong two-way dialogue.
technical_knowledge (accuracy/confidence on product/pricing/process):
  0–3 wrong or unsure on core questions; 4–6 mostly correct, some hedging; 7–10 accurate and confident.
  If NO product/technical question arose, set technical_knowledge = null.
objection_handling (acknowledge -> address -> advance):
  0–3 ignores/argues/folds (e.g. instant discount); 4–6 partial; 7–10 acknowledges, clarifies, advances.
  If NO objection arose, set objection_handling = null and reasons.objection_handling = "no_objection". Do NOT penalize.
meeting_scheduled (boolean): true ONLY if a concrete next meeting/demo with a specific time/commitment was agreed.

EVIDENCE: for every score < 5 OR > 8, include at least one VERBATIM quote (copied exactly from the
transcript) with the speaker and a one-line rationale. Never invent quotes.

GUARDRAILS: if there is no customer speech, the transcript is under ~25 words, or it is clearly not a
sales call, set not_evaluable=true with a reason and leave scores null. Output must match the schema exactly.`;

// ---------- helpers ----------
function preFilter(call: TranscriptRow): string | null {
  if ((call.duration_sec ?? 0) < MIN_DURATION_SEC) return 'too_short';
  if (call.call_type && !VALID_CALL_TYPES.has(call.call_type)) return 'non_sales';

  const words = call.word_count ?? (call.transcript ? call.transcript.split(/\s+/).filter(Boolean).length : 0);
  if (words < MIN_WORDS) return 'no_customer_speech';

  // No-pickup check only applies when we actually have diarized speaker labels.
  // (Whisper-only / low-memory mode produces no agent/customer split — rely on
  // duration + word_count above, and let the LLM judge if it's a real call.)
  const turns = call.transcript_json?.turns;
  const diarized = Array.isArray(turns) && turns.some((t) => t.speaker === 'agent' || t.speaker === 'customer');
  if (diarized && !turns!.some((t) => t.speaker === 'customer')) return 'no_pickup';

  return null;
}

function renderUser(call: TranscriptRow): string {
  const suspect = call.transcript_json?.speaker_mapping_suspect ? 'true' : 'false';
  const talk = call.talk_ratio == null ? 'n/a' : Number(call.talk_ratio).toFixed(2);
  return [
    `Call metadata: duration=${call.duration_sec}s, agent_talk_ratio=${talk}, call_type=${call.call_type || 'n/a'}, speaker_mapping_suspect=${suspect}`,
    `Transcript:`,
    call.transcript || '(empty)',
  ].join('\n');
}

function weightedScore(ev: Evaluation): number | null {
  const dims: Array<[keyof Evaluation, number]> = [
    ['engagement', 0.35], ['objection_handling', 0.35], ['technical_knowledge', 0.30],
  ];
  let num = 0, den = 0;
  for (const [k, w] of dims) {
    const v = ev[k] as number | null;
    if (v != null) { num += v * w; den += w; }
  }
  return den > 0 ? Number((num / den).toFixed(2)) : null;
}

async function evaluateCall(call: TranscriptRow): Promise<Evaluation> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      temperature: 0,
      seed: 7,
      response_format: { type: 'json_schema', json_schema: DAILY_EVAL_SCHEMA },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: renderUser(call) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content) as Evaluation;
}

async function insertEvaluation(call: TranscriptRow, ev: Partial<Evaluation>, overall: number | null) {
  await query(
    `INSERT INTO call_evaluations
       (transcript_id, agent_id, shift_date, engagement, technical_knowledge, objection_handling,
        meeting_scheduled, overall_score, reasons, evidence, not_evaluable, not_evaluable_reason,
        model_version, prompt_version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (transcript_id) DO NOTHING`,
    [
      call.id, call.agent_id, call.shift_date,
      ev.engagement ?? null, ev.technical_knowledge ?? null, ev.objection_handling ?? null,
      ev.meeting_scheduled ?? null, overall,
      JSON.stringify(ev.reasons ?? {}), JSON.stringify(ev.evidence ?? []),
      ev.not_evaluable ?? false, ev.not_evaluable_reason ?? null,
      MODEL_VERSION, PROMPT_VERSION,
    ]
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
    const override = url.searchParams.get('date');
    const shiftDate = override || getShiftDate(new Date());
    // Bounded batch so one request stays under the edge (~100s) proxy timeout.
    const limit = Math.min(Number(url.searchParams.get('limit')) || 40, 500);

    // ---- PHASE 1: evaluate a batch of transcribed calls for the shift ----
    const pending = await query<TranscriptRow>(
      `SELECT id, agent_id, shift_date, duration_sec, call_type, talk_ratio,
              word_count, transcript, transcript_json
       FROM call_transcripts
       WHERE status = 'transcribed' AND shift_date = $1
       ORDER BY agent_id, call_started_at
       LIMIT $2`,
      [shiftDate, limit]
    );

    let evaluated = 0, skipped = 0, failed = 0;

    for (const call of pending) {
      // (a) cheap pre-filter — never spend a token on junk
      const skip = preFilter(call);
      if (skip) {
        await insertEvaluation(call, { not_evaluable: true, not_evaluable_reason: skip }, null);
        await query(`UPDATE call_transcripts SET status = 'evaluated' WHERE id = $1`, [call.id]);
        skipped++;
        continue;
      }

      // (b) LLM evaluation
      try {
        const ev = await evaluateCall(call);
        const overall = ev.not_evaluable ? null : weightedScore(ev);
        await insertEvaluation(call, ev, overall);
        await query(`UPDATE call_transcripts SET status = 'evaluated' WHERE id = $1`, [call.id]);
        evaluated++;
      } catch (e: any) {
        // leave status='transcribed' so the next run retries just this call
        console.error(`[daily-eval] call ${call.id} failed:`, e.message);
        failed++;
      }
    }

    // ---- PHASE 2: aggregate into daily_scores (after all evals) ----
    const agentIds = Array.from(new Set(pending.map((c) => c.agent_id)));
    for (const agentId of agentIds) {
      await query(
        `INSERT INTO daily_scores
           (agent_id, shift_date, calls_total, calls_evaluated,
            avg_engagement, avg_technical, avg_objection, meetings_scheduled, daily_score)
         SELECT
           $1, $2,
           COUNT(*),
           COUNT(*) FILTER (WHERE NOT not_evaluable),
           AVG(engagement)          FILTER (WHERE engagement IS NOT NULL),
           AVG(technical_knowledge) FILTER (WHERE technical_knowledge IS NOT NULL),
           AVG(objection_handling)  FILTER (WHERE objection_handling IS NOT NULL),
           COUNT(*) FILTER (WHERE meeting_scheduled),
           AVG(overall_score)       FILTER (WHERE NOT not_evaluable)
         FROM call_evaluations
         WHERE agent_id = $1 AND shift_date = $2
         ON CONFLICT (agent_id, shift_date) DO UPDATE SET
           calls_total = EXCLUDED.calls_total,
           calls_evaluated = EXCLUDED.calls_evaluated,
           avg_engagement = EXCLUDED.avg_engagement,
           avg_technical = EXCLUDED.avg_technical,
           avg_objection = EXCLUDED.avg_objection,
           meetings_scheduled = EXCLUDED.meetings_scheduled,
           daily_score = EXCLUDED.daily_score`,
        [agentId, shiftDate]
      );
    }

    // How many transcribed calls still await grading (for batch draining).
    const remainingRows = await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM call_transcripts
       WHERE status = 'transcribed' AND shift_date = $1`,
      [shiftDate]
    );
    const remaining = remainingRows[0]?.n ?? 0;

    return NextResponse.json({
      status: 'success',
      shiftDate,
      processed: pending.length,
      evaluated,
      skipped,
      failed,
      remaining,                       // >0 means call again to drain the rest
      agentsAggregated: agentIds.length,
    });
  } catch (err: any) {
    console.error('[daily-eval] error:', err);
    return NextResponse.json({ status: 'error', message: err.message || 'Internal error' }, { status: 500 });
  }
}

// Render Cron triggers via GET (curl); external schedulers may POST. Support both.
export async function GET(request: NextRequest) {
  return handle(request);
}
export async function POST(request: NextRequest) {
  return handle(request);
}
