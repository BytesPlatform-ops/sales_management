/**
 * ai-gateway (B.11). The only place the training module talks to OpenAI.
 *
 *  - server-side only; the browser never sees the key
 *  - model per feature from training_settings.ai_models (never hard-coded)
 *  - prompt templates from ai_prompts (DB, versioned) with code defaults
 *  - per-rep monthly cap + org cap: warn at 80%, hard stop at 100%
 *  - every call logged to ai_sessions with tokens, cost, latency, prompt_version
 *  - structured JSON outputs for anything the app parses
 *  - static system prompts first so OpenAI's prompt caching applies
 *
 * Callers must handle AiUnavailableError by switching to standard (no-AI) mode.
 */
import { query, queryOne } from '@/lib/db';
import { getSettings } from './settings';
import { getPrompt, renderTemplate, PromptKey } from './prompts';
import { notify, notifyTrainers } from './events';

export class AiUnavailableError extends Error {
  constructor(public reason: 'no_key' | 'disabled' | 'cap_reached' | 'api_error', message?: string) {
    super(message || reason);
  }
}

export const STANDARD_MODE_MESSAGE = 'AI unavailable — using standard mode';

export type AiFeature =
  | 'roleplay' | 'grading' | 'pitch' | 'site_scan' | 'drill' | 'generate'
  | 'digest' | 'email' | 'transcribe' | 'voice' | 'quiz_grade';

const ORG_USER_ID = 0;

function monthKey(d = new Date()) {
  return d.toISOString().slice(0, 7);
}

export async function modelFor(feature: AiFeature): Promise<string> {
  const s = await getSettings();
  const m = s.ai_models || {};
  if (feature === 'transcribe') {
    // E.1: gpt-4o-mini-transcribe shuts down 2027-02-26 → gpt-transcribe.
    const after = m.transcribe_after_2027_02_26;
    if (after && new Date() >= new Date('2027-02-26T00:00:00Z')) return after;
  }
  return m[feature] || m.default || 'gpt-6-luna';
}

// ------------------------------------------------------------------ pricing

interface Price {
  input_per_1m: number; cached_per_1m: number; output_per_1m: number;
  audio_input_per_1m: number; audio_output_per_1m: number; per_minute: number;
}
let priceCache: { at: number; map: Map<string, Price> } | null = null;

async function priceFor(model: string): Promise<Price> {
  if (!priceCache || Date.now() - priceCache.at > 300_000) {
    const map = new Map<string, Price>();
    try {
      const rows = await query<any>('SELECT * FROM ai_model_prices');
      for (const r of rows) {
        map.set(r.model, {
          input_per_1m: Number(r.input_per_1m), cached_per_1m: Number(r.cached_per_1m),
          output_per_1m: Number(r.output_per_1m), audio_input_per_1m: Number(r.audio_input_per_1m),
          audio_output_per_1m: Number(r.audio_output_per_1m), per_minute: Number(r.per_minute),
        });
      }
    } catch { /* not installed */ }
    priceCache = { at: Date.now(), map };
  }
  return priceCache.map.get(model) || {
    input_per_1m: 0.1, cached_per_1m: 0.01, output_per_1m: 0.5,
    audio_input_per_1m: 0, audio_output_per_1m: 0, per_minute: 0.003,
  };
}

export async function estimateCost(model: string, u: { input?: number; cached?: number; output?: number; audioSeconds?: number; audioIn?: number; audioOut?: number }) {
  const p = await priceFor(model);
  const uncached = Math.max(0, (u.input || 0) - (u.cached || 0));
  return (
    (uncached * p.input_per_1m + (u.cached || 0) * p.cached_per_1m + (u.output || 0) * p.output_per_1m +
      (u.audioIn || 0) * p.audio_input_per_1m + (u.audioOut || 0) * p.audio_output_per_1m) / 1_000_000 +
    ((u.audioSeconds || 0) / 60) * p.per_minute
  );
}

// ------------------------------------------------------------------ budgets

async function capFor(userId: number): Promise<number> {
  const s = await getSettings();
  if (userId === ORG_USER_ID) return s.ai_caps.org_monthly_usd;
  return s.voice_enabled ? s.ai_caps.rep_monthly_usd_with_voice : s.ai_caps.rep_monthly_usd;
}

async function ensureBudget(userId: number, month: string) {
  const cap = await capFor(userId);
  await query(
    `INSERT INTO ai_budgets (user_id, month, cap_usd) VALUES ($1, $2, $3) ON CONFLICT (user_id, month) DO NOTHING`,
    [userId, month, cap]
  );
  return queryOne<{ cap_usd: string; spent_usd: string; hard_stop: boolean; warned_at: string | null }>(
    `SELECT cap_usd, spent_usd, hard_stop, warned_at FROM ai_budgets WHERE user_id = $1 AND month = $2`,
    [userId, month]
  );
}

/** Throws AiUnavailableError when AI can't be used for this user right now. */
export async function assertAiAvailable(userId: number | null) {
  const s = await getSettings();
  if (!process.env.OPENAI_API_KEY) throw new AiUnavailableError('no_key', STANDARD_MODE_MESSAGE);
  if (!s.ai_enabled) throw new AiUnavailableError('disabled', STANDARD_MODE_MESSAGE);
  const month = monthKey();
  for (const id of [ORG_USER_ID, ...(userId ? [userId] : [])]) {
    const b = await ensureBudget(id, month);
    if (b && b.hard_stop && Number(b.spent_usd) >= Number(b.cap_usd)) {
      throw new AiUnavailableError('cap_reached',
        id === ORG_USER_ID ? 'Organisation AI budget reached — using standard mode' : 'Your monthly AI budget is used up — using standard mode');
    }
  }
}

export async function aiStatus(userId: number | null): Promise<{ available: boolean; reason?: string; message?: string }> {
  try {
    await assertAiAvailable(userId);
    return { available: true };
  } catch (err) {
    if (err instanceof AiUnavailableError) return { available: false, reason: err.reason, message: err.message };
    return { available: false, reason: 'api_error', message: STANDARD_MODE_MESSAGE };
  }
}

export async function recordUsage(entry: {
  userId: number | null; feature: AiFeature; model: string; input: number; cached: number; output: number;
  audioSeconds?: number; costUsd: number; latencyMs: number; promptVersion?: number | null; error?: string;
}) {
  try {
    await query(
      `INSERT INTO ai_sessions (user_id, feature, model, input_tokens, cached_tokens, output_tokens, audio_seconds,
                                cost_usd, latency_ms, prompt_version, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [entry.userId, entry.feature, entry.model, entry.input, entry.cached, entry.output, entry.audioSeconds || 0,
        entry.costUsd, entry.latencyMs, entry.promptVersion ?? null, entry.error ?? null]
    );
    if (entry.costUsd <= 0) return;
    const month = monthKey();
    const s = await getSettings();
    for (const id of [ORG_USER_ID, ...(entry.userId ? [entry.userId] : [])]) {
      await ensureBudget(id, month);
      const b = await queryOne<{ cap_usd: string; spent_usd: string; warned_at: string | null }>(
        `UPDATE ai_budgets SET spent_usd = spent_usd + $3, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $1 AND month = $2 RETURNING cap_usd, spent_usd, warned_at`,
        [id, month, entry.costUsd]
      );
      if (b && !b.warned_at && Number(b.spent_usd) >= (Number(b.cap_usd) * s.ai_caps.warn_at_pct) / 100) {
        await query(`UPDATE ai_budgets SET warned_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND month = $2`, [id, month]);
        if (id === ORG_USER_ID) {
          await notifyTrainers('ai_budget', `Organisation AI spend reached ${s.ai_caps.warn_at_pct}% of the $${b.cap_usd} monthly cap.`, '/hr/training/ai');
        } else {
          await notify(id, 'ai_budget', `You've used ${s.ai_caps.warn_at_pct}% of your monthly AI practice budget.`);
          await notifyTrainers('ai_budget', `A rep reached ${s.ai_caps.warn_at_pct}% of their AI budget (user #${id}).`, '/hr/training/ai');
        }
      }
    }
  } catch (err) {
    console.error('[training] ai usage log failed', err);
  }
}

// ------------------------------------------------------------------ PII

/**
 * B.11: send the AI only what it needs. Strip emails, phone numbers and the
 * contact person's name (replaced with {CONTACT}).
 */
export function stripPII(text: string, contactNames: (string | null | undefined)[] = []): string {
  let out = String(text || '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '{EMAIL}')
    .replace(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g, '{PHONE}');
  for (const name of contactNames) {
    if (!name) continue;
    for (const part of [name, ...name.split(/\s+/)].filter((p) => p.length > 2)) {
      out = out.replace(new RegExp(part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '{CONTACT}');
    }
  }
  return out;
}

// ------------------------------------------------------------------ chat

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

interface ChatOptions {
  feature: AiFeature;
  userId: number | null;
  promptKey: PromptKey;
  vars?: Record<string, unknown>;
  /** extra conversation turns appended after the rendered user template */
  history?: ChatMessage[];
  json?: boolean;
  maxTokens?: number;
}

async function callChat(opts: ChatOptions): Promise<{ text: string; model: string; promptVersion: number }> {
  await assertAiAvailable(opts.userId);
  const prompt = await getPrompt(opts.promptKey);
  const model = prompt.model || (await modelFor(opts.feature));
  const vars = opts.vars || {};

  const messages: ChatMessage[] = [{ role: 'system', content: renderTemplate(prompt.system_prompt, vars) }];
  const userText = renderTemplate(prompt.user_template, vars).trim();
  if (userText) messages.push({ role: 'user', content: userText });
  if (opts.history) messages.push(...opts.history);

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: prompt.temperature,
    max_completion_tokens: opts.maxTokens ?? 1200,
  };
  if (opts.json && prompt.json_schema) {
    body.response_format = { type: 'json_schema', json_schema: { name: opts.promptKey, strict: true, schema: prompt.json_schema } };
  } else if (opts.json) {
    body.response_format = { type: 'json_object' };
  }

  const started = Date.now();
  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (err) {
    await recordUsage({ userId: opts.userId, feature: opts.feature, model, input: 0, cached: 0, output: 0, costUsd: 0,
      latencyMs: Date.now() - started, promptVersion: prompt.version, error: (err as Error).message });
    throw new AiUnavailableError('api_error', STANDARD_MODE_MESSAGE);
  }

  const latencyMs = Date.now() - started;
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    await recordUsage({ userId: opts.userId, feature: opts.feature, model, input: 0, cached: 0, output: 0, costUsd: 0,
      latencyMs, promptVersion: prompt.version, error: `HTTP ${res.status}: ${data?.error?.message || ''}`.slice(0, 500) });
    throw new AiUnavailableError('api_error', STANDARD_MODE_MESSAGE);
  }

  const usage = data.usage || {};
  const input = usage.prompt_tokens || 0;
  const cached = usage.prompt_tokens_details?.cached_tokens || 0;
  const output = usage.completion_tokens || 0;
  await recordUsage({
    userId: opts.userId, feature: opts.feature, model, input, cached, output,
    costUsd: await estimateCost(model, { input, cached, output }), latencyMs, promptVersion: prompt.version,
  });

  return { text: data.choices?.[0]?.message?.content || '', model, promptVersion: prompt.version };
}

export async function chatText(opts: Omit<ChatOptions, 'json'>) {
  return callChat({ ...opts, json: false });
}

export async function chatJSON<T = any>(opts: Omit<ChatOptions, 'json'>): Promise<{ data: T; model: string; promptVersion: number }> {
  const r = await callChat({ ...opts, json: true });
  try {
    return { data: JSON.parse(r.text) as T, model: r.model, promptVersion: r.promptVersion };
  } catch {
    throw new AiUnavailableError('api_error', 'AI returned an unreadable answer — using standard mode');
  }
}

// ------------------------------------------------------------------ audio

/** Transcribe audio (call grading, tonality drill, voicemail grader). */
export async function transcribe(file: Blob, filename: string, userId: number | null, durationSeconds?: number): Promise<{ text: string; model: string }> {
  await assertAiAvailable(userId);
  const model = await modelFor('transcribe');
  const form = new FormData();
  form.append('file', file, filename);
  form.append('model', model);
  form.append('response_format', 'json');

  const started = Date.now();
  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    await recordUsage({ userId, feature: 'transcribe', model, input: 0, cached: 0, output: 0, costUsd: 0,
      latencyMs: Date.now() - started, error: (err as Error).message });
    throw new AiUnavailableError('api_error', STANDARD_MODE_MESSAGE);
  }
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    await recordUsage({ userId, feature: 'transcribe', model, input: 0, cached: 0, output: 0, costUsd: 0,
      latencyMs: Date.now() - started, error: `HTTP ${res.status}: ${data?.error?.message || ''}`.slice(0, 500) });
    throw new AiUnavailableError('api_error', STANDARD_MODE_MESSAGE);
  }
  // Rough duration when unknown: ~16 kB/s for typical compressed call audio.
  const seconds = durationSeconds ?? Math.max(1, Math.round(file.size / 16_000));
  await recordUsage({
    userId, feature: 'transcribe', model, input: 0, cached: 0, output: 0, audioSeconds: seconds,
    costUsd: await estimateCost(model, { audioSeconds: seconds }), latencyMs: Date.now() - started,
  });
  return { text: String(data.text || ''), model };
}

/**
 * Optional voice roleplay (E.3): mint a short-lived Realtime client secret so
 * the browser can open a WebRTC session without the API key. Daily minutes cap
 * is enforced by the caller.
 */
export async function createRealtimeSession(userId: number, instructions: string) {
  await assertAiAvailable(userId);
  const s = await getSettings();
  if (!s.voice_enabled) throw new AiUnavailableError('disabled', 'Voice roleplay is turned off — use text mode');
  const model = await modelFor('voice');
  const res = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      expires_after: { anchor: 'created_at', seconds: 600 },
      session: { type: 'realtime', model, instructions, audio: { output: { voice: 'ash' } } },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new AiUnavailableError('api_error', data?.error?.message || STANDARD_MODE_MESSAGE);
  return { client_secret: data.value || data.client_secret?.value, model, expires_at: data.expires_at };
}

/** Voice sessions are billed by audio; the client reports minutes on finish. */
export async function recordVoiceUsage(userId: number, seconds: number) {
  const model = await modelFor('voice');
  // ~1 token / 100 ms of rep audio + 1 / 50 ms of AI audio, assume an even split (E.3).
  const audioIn = (seconds / 2) * 10;
  const audioOut = (seconds / 2) * 20;
  await recordUsage({
    userId, feature: 'voice', model, input: 0, cached: 0, output: 0, audioSeconds: seconds,
    costUsd: await estimateCost(model, { audioIn, audioOut }), latencyMs: 0,
  });
}

export async function voiceSecondsToday(userId: number): Promise<number> {
  const row = await queryOne<{ s: string }>(
    `SELECT COALESCE(SUM(audio_seconds), 0) AS s FROM ai_sessions
     WHERE user_id = $1 AND feature = 'voice' AND created_at >= date_trunc('day', NOW())`,
    [userId]
  );
  return Number(row?.s || 0);
}
