/**
 * Nightly OpenAI Batch jobs (B.11 caching rule 3, E.7): pre-compute pitch points
 * for tomorrow's lead list at 50% off so Live Assist is instant during the call.
 */
import { query, queryOne } from '@/lib/db';
import { assertAiAvailable, estimateCost, modelFor, recordUsage, stripPII, AiUnavailableError } from './ai';
import { getPrompt, renderTemplate } from './prompts';
import { pitchHash } from './assist';
import { keywordPitch } from './classify';

const OPENAI = 'https://api.openai.com/v1';
const auth = () => ({ Authorization: `Bearer ${process.env.OPENAI_API_KEY}` });

function narrativeOf(raw: any): string {
  if (!raw || typeof raw !== 'object') return '';
  for (const [k, v] of Object.entries(raw)) if (/capabilit|narrative|description|business_desc|services/i.test(k) && v) return String(v);
  return '';
}

/** Submit one batch for assigned, uncalled leads whose narrative isn't cached yet. */
export async function submitPitchBatch(limit = 500): Promise<string | null> {
  try {
    await assertAiAvailable(null);
  } catch (err) {
    if (err instanceof AiUnavailableError) return null;
    throw err;
  }
  const pending = await queryOne(`SELECT 1 FROM ai_batches WHERE feature = 'pitch' AND status IN ('submitted', 'validating', 'in_progress', 'finalizing')`);
  if (pending) return null;

  const leads = await query<any>(
    `SELECT id, firm_name, contact_person, raw_data, state FROM dialer_leads
     WHERE assigned_agent_id IS NOT NULL AND call_outcome = 'pending' AND raw_data IS NOT NULL
     ORDER BY assigned_date DESC NULLS LAST LIMIT $1`,
    [limit * 2]
  );
  const prompt = await getPrompt('pitch_points');
  const model = prompt.model || (await modelFor('pitch'));
  const seen = new Set<string>();
  const lines: string[] = [];

  for (const lead of leads) {
    const narrative = stripPII(narrativeOf(lead.raw_data), [lead.contact_person]);
    if (!narrative.trim()) continue;
    const hash = pitchHash(narrative, []);
    if (seen.has(hash)) continue;
    seen.add(hash);
    const cached = await queryOne(`SELECT 1 FROM training_leads_cache WHERE narrative_hash = $1`, [hash]);
    if (cached) continue;
    const vars = { narrative, firm: lead.firm_name || '', state: lead.state || '', flags: 'none' };
    lines.push(JSON.stringify({
      custom_id: hash,
      method: 'POST',
      url: '/v1/chat/completions',
      body: {
        model,
        temperature: prompt.temperature,
        max_completion_tokens: 400,
        messages: [
          { role: 'system', content: renderTemplate(prompt.system_prompt, vars) },
          { role: 'user', content: renderTemplate(prompt.user_template, vars) },
        ],
        response_format: prompt.json_schema
          ? { type: 'json_schema', json_schema: { name: 'pitch_points', strict: true, schema: prompt.json_schema } }
          : { type: 'json_object' },
      },
    }));
    if (lines.length >= limit) break;
  }
  if (lines.length === 0) return null;

  const form = new FormData();
  form.append('purpose', 'batch');
  form.append('file', new Blob([lines.join('\n')], { type: 'application/jsonl' }), 'pitch-batch.jsonl');
  const file: any = await fetch(`${OPENAI}/files`, { method: 'POST', headers: auth(), body: form }).then((r) => r.json());
  if (!file?.id) throw new Error(`Batch upload failed: ${file?.error?.message || 'unknown'}`);

  const batch: any = await fetch(`${OPENAI}/batches`, {
    method: 'POST',
    headers: { ...auth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ input_file_id: file.id, endpoint: '/v1/chat/completions', completion_window: '24h' }),
  }).then((r) => r.json());
  if (!batch?.id) throw new Error(`Batch create failed: ${batch?.error?.message || 'unknown'}`);

  await query(
    `INSERT INTO ai_batches (openai_batch_id, feature, status, request_count, meta_json) VALUES ($1, 'pitch', $2, $3, $4::jsonb)`,
    [batch.id, batch.status || 'submitted', lines.length, JSON.stringify({ model, prompt_version: prompt.version })]
  );
  return batch.id;
}

/** Poll open batches; store finished results in the pitch cache. */
export async function pollBatches(): Promise<number> {
  if (!process.env.OPENAI_API_KEY) return 0;
  const open = await query<any>(`SELECT * FROM ai_batches WHERE status NOT IN ('completed', 'failed', 'expired', 'cancelled')`);
  let stored = 0;
  for (const b of open) {
    const info: any = await fetch(`${OPENAI}/batches/${b.openai_batch_id}`, { headers: auth() }).then((r) => r.json()).catch(() => null);
    if (!info?.status) continue;
    if (info.status !== 'completed') {
      await query(`UPDATE ai_batches SET status = $2 WHERE id = $1`, [b.id, info.status]);
      continue;
    }
    let input = 0, cached = 0, output = 0;
    if (info.output_file_id) {
      const text = await fetch(`${OPENAI}/files/${info.output_file_id}/content`, { headers: auth() }).then((r) => r.text());
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          const row = JSON.parse(line);
          const body = row.response?.body;
          const content = body?.choices?.[0]?.message?.content;
          if (!content) continue;
          const data = JSON.parse(content);
          input += body.usage?.prompt_tokens || 0;
          cached += body.usage?.prompt_tokens_details?.cached_tokens || 0;
          output += body.usage?.completion_tokens || 0;
          await query(
            `INSERT INTO training_leads_cache (narrative_hash, pitch_points_json, model) VALUES ($1, $2::jsonb, $3)
             ON CONFLICT (narrative_hash) DO NOTHING`,
            [row.custom_id, JSON.stringify({ ...data, look_for: keywordPitch('').look_for }), b.meta_json?.model || 'batch']
          );
          stored++;
        } catch { /* skip malformed line */ }
      }
    }
    const model = b.meta_json?.model || 'gpt-6-luna';
    // Batch API is 50% of the normal price.
    const cost = (await estimateCost(model, { input, cached, output })) * 0.5;
    await recordUsage({ userId: null, feature: 'pitch', model, input, cached, output, costUsd: cost, latencyMs: 0, promptVersion: b.meta_json?.prompt_version ?? null });
    await query(`UPDATE ai_batches SET status = 'completed', completed_at = NOW() WHERE id = $1`, [b.id]);
  }
  return stored;
}
