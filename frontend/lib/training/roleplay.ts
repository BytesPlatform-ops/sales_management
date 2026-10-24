/**
 * Roleplay engine (E.3). Two engines behind one interface:
 *   ai     — gpt prospect in character, graded with the 100-point scorecard
 *   script — no-key fallback: branching decision tree with canned replies;
 *            points per choice are summed per criterion (capped) for the score
 * Personas come from scenarios, or from a real SAM.gov row in dialer_leads.
 */
import { query, queryOne } from '@/lib/db';
import { aiStatus, chatJSON, chatText, stripPII, AiUnavailableError, ChatMessage, STANDARD_MODE_MESSAGE } from './ai';
import { buildScoreCard, loadRubric, needsHumanReview, ScoreCard } from './scorecard';
import { keywordPitch, INDUSTRY_TEMPLATES } from './classify';
import { HttpError } from './http';

export interface ScriptChoice { label: string; next: string; points?: Record<string, number>; feedback?: string }
export interface ScriptNode { prospect: string; choices?: ScriptChoice[]; end?: boolean; outcome?: string }
export interface Script { start: string; nodes: Record<string, ScriptNode> }

export interface Scenario {
  id: number; code: string; title: string; persona_json: any; objective: string; difficulty: number;
  objections_json: string[]; rubric_id: number | null; script_json: Script; exam_kind: string | null; pass_rule: string | null;
}

export interface SessionRow {
  id: number; user_id: number; scenario_id: number | null; lesson_id: number | null; mode: 'text' | 'voice';
  engine: 'ai' | 'script'; purpose: 'practice' | 'exam' | 'daily'; persona_json: any; transcript: Turn[];
  state_json: any; ai_score_json: ScoreCard | null; trainer_score_json: any; final_score: string | null;
  status: string; human_reviewed: boolean; started_at: string; finished_at: string | null;
}

export interface Turn { role: 'rep' | 'prospect'; text: string; at: string; feedback?: string }

const END_TOKEN = '[END]';
const MAX_HISTORY_TURNS = 16; // ≈ last 8 exchanges (E.3 cost trick)

function hasScript(s: Scenario | null) {
  return !!(s?.script_json && s.script_json.start && s.script_json.nodes?.[s.script_json.start]);
}

function nodeView(script: Script, nodeId: string) {
  const node = script.nodes[nodeId];
  if (!node) return null;
  return {
    node_id: nodeId,
    prospect: node.prospect,
    end: !!node.end,
    outcome: node.outcome || null,
    choices: (node.choices || []).map((c, i) => ({ index: i, label: c.label })),
  };
}

export async function getScenario(idOrCode: number | string): Promise<Scenario | null> {
  return queryOne<Scenario>(
    typeof idOrCode === 'number'
      ? `SELECT * FROM training_roleplay_scenarios WHERE id = $1`
      : `SELECT * FROM training_roleplay_scenarios WHERE code = $1`,
    [idOrCode]
  );
}

/** Pick a fallback script for lead-based personas: closest industry, else RP1. */
async function fallbackScenarioFor(narrative: string): Promise<Scenario | null> {
  const t = INDUSTRY_TEMPLATES.find((tpl) => tpl.match.test(narrative || ''));
  const rows = await query<Scenario>(`SELECT * FROM training_roleplay_scenarios WHERE active AND exam_kind IS NULL ORDER BY code`);
  if (t) {
    const match = rows.find((r) => t.match.test(`${r.persona_json?.firm_type || ''} ${r.persona_json?.narrative || ''}`));
    if (match) return match;
  }
  return rows.find((r) => r.code === 'RP1') || rows[0] || null;
}

function leadField(raw: any, keys: RegExp): string {
  if (!raw || typeof raw !== 'object') return '';
  for (const [k, v] of Object.entries(raw)) if (keys.test(k) && v) return String(v);
  return '';
}

/** Build a persona from a real SAM.gov lead row (contact details stripped). */
async function personaFromLead(leadId: number | 'random', userId: number) {
  const lead = await queryOne<any>(
    leadId === 'random'
      ? `SELECT id, firm_name, contact_person, raw_data, state FROM dialer_leads
         WHERE raw_data IS NOT NULL ORDER BY random() LIMIT 1`
      : `SELECT id, firm_name, contact_person, raw_data, state FROM dialer_leads WHERE id = $1`,
    leadId === 'random' ? [] : [leadId]
  );
  if (!lead) throw new HttpError(404, 'No lead found to build a persona from');
  const narrative = stripPII(leadField(lead.raw_data, /capabilit|narrative|description|business_desc|services/i) || lead.firm_name, [lead.contact_person]);
  const website = leadField(lead.raw_data, /website|url|web/i);
  const firm = String(lead.firm_name || 'Contractor').replace(/\*[A-Z]+\*/g, '').trim();

  try {
    const r = await chatJSON<any>({
      feature: 'roleplay', userId, promptKey: 'persona_from_lead',
      vars: { firm, narrative, state: lead.state || '', website: website || 'none listed' }, maxTokens: 500,
    });
    return { persona: { ...r.data, source_lead_id: lead.id }, objections: r.data.objections || [], difficulty: r.data.difficulty || 3, narrative };
  } catch (err) {
    if (!(err instanceof AiUnavailableError)) console.error('[training] persona', err);
    const k = keywordPitch(narrative);
    return {
      persona: {
        name: 'the owner', firm_name: firm, firm_type: k.industry, narrative, state: lead.state || '',
        size_guess: k.size_guess, gov_mix_pct: k.gov_mix_guess === 'pure_federal' ? 100 : 60,
        hidden_pains: k.pains.slice(0, 2), mood: 'busy', website_observation: website ? 'unknown — scan it' : 'no website listed',
        voice_notes: '', source_lead_id: lead.id,
      },
      objections: ['Not interested.', 'Send me an email.'],
      difficulty: 3,
      narrative,
    };
  }
}

function prospectHistory(transcript: Turn[]): ChatMessage[] {
  // From the model's point of view it is the prospect (assistant), the rep is the user.
  return transcript.slice(-MAX_HISTORY_TURNS).map((t) => ({
    role: t.role === 'prospect' ? 'assistant' : 'user',
    content: t.text,
  }));
}

async function aiProspectLine(session: { persona_json: any; transcript: Turn[]; state_json: any }, userId: number) {
  const p = session.persona_json || {};
  const r = await chatText({
    feature: 'roleplay', userId, promptKey: 'roleplay_prospect',
    vars: {
      persona: JSON.stringify(p.persona || p),
      objections: (p.objections || []).join(' | '),
      objective: p.objective || '',
      difficulty: p.difficulty || 2,
    },
    history: prospectHistory(session.transcript),
    maxTokens: 160,
  });
  let text = r.text.trim();
  const ended = text.includes(END_TOKEN);
  text = text.replace(END_TOKEN, '').trim();
  return { text, ended };
}

export async function startSession(userId: number, opts: {
  scenarioCode?: string; scenarioId?: number; leadId?: number | 'random'; purpose?: 'practice' | 'exam' | 'daily';
  mode?: 'text' | 'voice'; lessonId?: number | null; forceScript?: boolean;
}) {
  let scenario: Scenario | null = null;
  let persona: any;

  if (opts.leadId) {
    const built = await personaFromLead(opts.leadId, userId);
    scenario = await fallbackScenarioFor(built.narrative);
    persona = {
      persona: built.persona, objections: built.objections, difficulty: built.difficulty,
      objective: 'Earn a 15–20 minute meeting with the specialist.', title: `SAM.gov lead: ${built.persona.firm_name}`,
    };
  } else {
    scenario = opts.scenarioId ? await getScenario(opts.scenarioId) : opts.scenarioCode ? await getScenario(opts.scenarioCode) : null;
    if (!scenario) throw new HttpError(404, 'Scenario not found');
    persona = {
      persona: scenario.persona_json, objections: scenario.objections_json, difficulty: scenario.difficulty,
      objective: scenario.objective, title: scenario.title,
    };
  }

  const ai = await aiStatus(userId);
  const useAi = ai.available && !opts.forceScript;
  if (!useAi && !hasScript(scenario)) throw new HttpError(503, `${STANDARD_MODE_MESSAGE} — this scenario has no scripted version`);
  const engine: 'ai' | 'script' = useAi ? 'ai' : 'script';
  const purpose = opts.purpose || 'practice';
  const now = new Date().toISOString();

  const transcript: Turn[] = [];
  let state: any = {};
  let view: any = null;

  if (engine === 'script') {
    const script = scenario!.script_json;
    state = { node: script.start, points: {}, path: [], scenario_code: scenario!.code };
    view = nodeView(script, script.start);
    transcript.push({ role: 'prospect', text: script.nodes[script.start].prospect, at: now });
  } else if (opts.mode !== 'voice') {
    try {
      const first = await aiProspectLine({ persona_json: persona, transcript: [], state_json: {} }, userId);
      transcript.push({ role: 'prospect', text: first.text || 'Hello?', at: now });
    } catch {
      transcript.push({ role: 'prospect', text: 'Hello, this is ' + (persona.persona?.name || 'the owner') + '.', at: now });
    }
  }

  const row = await queryOne<SessionRow>(
    `INSERT INTO training_roleplay_sessions (user_id, scenario_id, lesson_id, mode, engine, purpose, persona_json, transcript, state_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb) RETURNING *`,
    [userId, scenario?.id ?? null, opts.lessonId ?? null, opts.mode || 'text', engine, purpose,
      JSON.stringify(persona), JSON.stringify(transcript), JSON.stringify(state)]
  );

  return {
    session: publicSession(row!),
    script_view: view,
    ai_message: useAi ? null : ai.message || STANDARD_MODE_MESSAGE,
  };
}

export function publicSession(s: SessionRow) {
  return {
    id: s.id, scenario_id: s.scenario_id, lesson_id: s.lesson_id, mode: s.mode, engine: s.engine, purpose: s.purpose,
    title: s.persona_json?.title, persona: {
      firm_name: s.persona_json?.persona?.firm_name, firm_type: s.persona_json?.persona?.firm_type,
      state: s.persona_json?.persona?.state, narrative: s.persona_json?.persona?.narrative,
      website_observation: s.persona_json?.persona?.website_observation, mood: s.persona_json?.persona?.mood,
      name: s.persona_json?.persona?.name,
    },
    objective: s.persona_json?.objective,
    transcript: s.transcript, status: s.status, final_score: s.final_score === null ? null : Number(s.final_score),
    ai_score: s.ai_score_json, trainer_score: s.trainer_score_json, human_reviewed: s.human_reviewed,
    started_at: s.started_at, finished_at: s.finished_at,
  };
}

export async function loadOwnSession(sessionId: number, userId: number, allowTrainer = false): Promise<SessionRow> {
  const s = await queryOne<SessionRow>(`SELECT * FROM training_roleplay_sessions WHERE id = $1`, [sessionId]);
  if (!s || (!allowTrainer && Number(s.user_id) !== userId)) throw new HttpError(404, 'Session not found');
  return s;
}

/** One rep turn: free text (ai engine) or a choice index (script engine). */
export async function takeTurn(sessionId: number, userId: number, input: { text?: string; choice?: number }) {
  const s = await loadOwnSession(sessionId, userId);
  if (s.status !== 'active') throw new HttpError(400, 'This roleplay has already finished');
  const now = new Date().toISOString();
  const transcript = [...(s.transcript || [])];

  if (s.engine === 'script') {
    const scenario = s.scenario_id ? await getScenario(s.scenario_id) : null;
    const script = scenario?.script_json;
    const node = script?.nodes[s.state_json.node];
    const choice = node?.choices?.[Number(input.choice)];
    if (!script || !node || !choice) throw new HttpError(400, 'Pick one of the options');

    const points: Record<string, number> = { ...(s.state_json.points || {}) };
    for (const [k, v] of Object.entries(choice.points || {})) points[k] = (points[k] || 0) + Number(v);
    const feedback: string[] = [...(s.state_json.feedback || [])];
    if (choice.feedback) feedback.push(choice.feedback);

    transcript.push({ role: 'rep', text: choice.label, at: now, feedback: choice.feedback });
    const next = script.nodes[choice.next];
    if (next) transcript.push({ role: 'prospect', text: next.prospect, at: now });
    const state = {
      ...s.state_json, node: choice.next, points, feedback,
      path: [...(s.state_json.path || []), { node: s.state_json.node, choice: Number(input.choice) }],
      outcome: next?.end ? next.outcome : null, done: !next || !!next.end,
    };
    await query(
      `UPDATE training_roleplay_sessions SET transcript = $2::jsonb, state_json = $3::jsonb WHERE id = $1`,
      [s.id, JSON.stringify(transcript), JSON.stringify(state)]
    );
    return { transcript, script_view: next ? nodeView(script, choice.next) : null, done: state.done, feedback: choice.feedback || null };
  }

  const text = String(input.text || '').trim();
  if (!text) throw new HttpError(400, 'Say something');
  transcript.push({ role: 'rep', text, at: now });
  let done = false;
  try {
    const reply = await aiProspectLine({ ...s, transcript }, userId);
    if (reply.text) transcript.push({ role: 'prospect', text: reply.text, at: new Date().toISOString() });
    done = reply.ended;
  } catch (err) {
    // Persist the rep's line; the UI shows standard-mode notice and lets them finish.
    await query(`UPDATE training_roleplay_sessions SET transcript = $2::jsonb WHERE id = $1`, [s.id, JSON.stringify(transcript)]);
    throw err instanceof AiUnavailableError ? new HttpError(503, err.message) : err;
  }
  await query(
    `UPDATE training_roleplay_sessions SET transcript = $2::jsonb, state_json = state_json || $3::jsonb WHERE id = $1`,
    [s.id, JSON.stringify(transcript), JSON.stringify({ done })]
  );
  return { transcript, script_view: null, done, feedback: null };
}

export function transcriptText(turns: Turn[]): string {
  return turns.map((t) => `${t.role === 'rep' ? 'REP' : 'PROSPECT'}: ${t.text}`).join('\n');
}

/** AI-vs-human gap on this rep's most recent reviewed roleplay or call. */
export async function lastAiHumanGap(userId: number): Promise<number | null> {
  const row = await queryOne<{ gap: string | null }>(
    `SELECT gap FROM (
       SELECT ABS((ai_score_json->>'total')::numeric - final_score) AS gap, reviewed_at
       FROM training_roleplay_sessions WHERE user_id = $1 AND human_reviewed AND ai_score_json IS NOT NULL AND (ai_score_json->>'engine') = 'ai'
       UNION ALL
       SELECT ABS((ai_score_json->>'total')::numeric - final_score), reviewed_at
       FROM training_call_reviews WHERE user_id = $1 AND status = 'reviewed' AND ai_score_json IS NOT NULL
     ) x ORDER BY reviewed_at DESC NULLS LAST LIMIT 1`,
    [userId]
  );
  return row?.gap === null || row?.gap === undefined ? null : Number(row.gap);
}

/** Finish: score with AI (or script points) and route to the review queue if needed. */
export async function finishSession(sessionId: number, userId: number, opts: { transcript?: Turn[]; durationS?: number } = {}) {
  const s = await loadOwnSession(sessionId, userId);
  if (s.status !== 'active') return publicSession(s);
  const scenario = s.scenario_id ? await getScenario(s.scenario_id) : null;
  const rubric = await loadRubric(scenario?.rubric_id ?? 'CALL_SCORECARD_100');
  const transcript = opts.transcript && s.mode === 'voice' ? opts.transcript : s.transcript;
  if (transcript.filter((t) => t.role === 'rep').length === 0) {
    await query(`UPDATE training_roleplay_sessions SET status = 'abandoned', finished_at = NOW() WHERE id = $1`, [s.id]);
    throw new HttpError(400, 'Nothing to grade — the roleplay was empty');
  }

  let card: ScoreCard;
  if (s.engine === 'script') {
    const points = s.state_json.points || {};
    const fb: string[] = s.state_json.feedback || [];
    card = buildScoreCard(rubric, {
      criteria: rubric.criteria_json.map((c) => ({ id: c.id, points: Number(points[c.id] || 0), evidence_quote: '', tip: '' })),
      auto_fail: s.state_json.auto_fail || [],
      top_3_tips: fb.slice(-3).reverse(),
      outcome: s.state_json.outcome || undefined,
    }, 'script');
  } else {
    try {
      const r = await chatJSON<any>({
        feature: 'grading', userId, promptKey: 'call_grade',
        vars: {
          context: `Roleplay "${s.persona_json?.title || ''}". Objective: ${s.persona_json?.objective || ''}. Prospect: ${s.persona_json?.persona?.firm_type || ''}, ${s.persona_json?.persona?.state || ''}. Hidden pains: ${(s.persona_json?.persona?.hidden_pains || []).join('; ')}.`,
          transcript: transcriptText(transcript),
        },
        maxTokens: 1500,
      });
      card = buildScoreCard(rubric, r.data, 'ai');
    } catch (err) {
      if (!(err instanceof AiUnavailableError)) throw err;
      // AI went away mid-session: leave it for the trainer to grade with the same rubric.
      await query(
        `UPDATE training_roleplay_sessions SET status = 'needs_review', finished_at = NOW(), transcript = $2::jsonb, duration_s = $3 WHERE id = $1`,
        [s.id, JSON.stringify(transcript), opts.durationS ?? null]
      );
      return publicSession((await loadOwnSession(s.id, userId))!);
    }
  }

  // Scenario 7 (DNC request): pass only if the rep complied instantly, no rebuttal.
  if (scenario?.pass_rule === 'dnc_comply') {
    const complied = s.engine === 'script'
      ? s.state_json.outcome === 'removed' && !card.auto_fail.length
      : !card.auto_fail.includes('argue_after_remove');
    card.passed = complied;
    if (!complied) card.total = Math.min(card.total, rubric.auto_fail_cap);
  }

  const gap = await lastAiHumanGap(userId);
  // Exam roleplays always go to the trainer queue: LIVE_CALL_CERT needs ≥1 human-reviewed.
  const status = s.purpose === 'exam' || needsHumanReview(card.total, gap) ? 'needs_review' : 'scored';
  const duration = opts.durationS ?? Math.round((Date.now() - new Date(s.started_at).getTime()) / 1000);

  await query(
    `UPDATE training_roleplay_sessions
     SET ai_score_json = $2::jsonb, final_score = $3, status = $4, finished_at = NOW(), duration_s = $5, transcript = $6::jsonb
     WHERE id = $1`,
    [s.id, JSON.stringify(card), card.total, status, duration, JSON.stringify(transcript)]
  );
  return publicSession((await loadOwnSession(s.id, userId))!);
}
