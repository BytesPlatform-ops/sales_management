import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { handler, ok, readJson, requireHr, HttpError } from '@/lib/training/http';
import { DEFAULT_PROMPTS, PromptKey } from '@/lib/training/prompts';

export const dynamic = 'force-dynamic';

/** GET /api/training/prompts (trainer) — each key's code default (v0) + saved versions. */
export const GET = handler(async (request: NextRequest) => {
  await requireHr(request);
  const saved = await query<any>(`SELECT * FROM ai_prompts ORDER BY key, version DESC`);
  return ok(Object.values(DEFAULT_PROMPTS).map((d) => ({
    key: d.key,
    default: d,
    versions: saved.filter((s) => s.key === d.key),
    active_version: saved.find((s) => s.key === d.key && s.active)?.version ?? 0,
  })));
});

/** POST /api/training/prompts (trainer) { key, system_prompt, user_template, model?, temperature?, json_schema? } — saves a new active version. */
export const POST = handler(async (request: NextRequest) => {
  await requireHr(request);
  const b = await readJson(request);
  const def = DEFAULT_PROMPTS[b.key as PromptKey];
  if (!def) throw new HttpError(400, 'Unknown prompt key');
  if (!b.system_prompt) throw new HttpError(400, 'system_prompt is required');
  const temperature = b.temperature === undefined ? def.temperature : Number(b.temperature);
  if (!(temperature >= 0 && temperature <= 2)) throw new HttpError(400, 'temperature must be 0–2');
  const next = await queryOne<{ v: number }>(`SELECT COALESCE(MAX(version), 0) + 1 AS v FROM ai_prompts WHERE key = $1`, [b.key]);
  await query(`UPDATE ai_prompts SET active = false WHERE key = $1`, [b.key]);
  const row = await queryOne(
    `INSERT INTO ai_prompts (key, version, model, system_prompt, user_template, json_schema, temperature, active)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, true) RETURNING *`,
    [b.key, next!.v, b.model || null, b.system_prompt, b.user_template ?? def.user_template,
      b.json_schema === undefined ? (def.json_schema ? JSON.stringify(def.json_schema) : null) : b.json_schema ? JSON.stringify(b.json_schema) : null,
      temperature]
  );
  return ok(row);
});
