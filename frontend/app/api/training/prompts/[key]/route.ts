import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { handler, ok, readJson, requireHr, HttpError } from '@/lib/training/http';
import { DEFAULT_PROMPTS, PromptKey } from '@/lib/training/prompts';

export const dynamic = 'force-dynamic';

/** PUT /api/training/prompts/{key} (trainer) { version } — activate a saved version; 0 = back to the code default. */
export const PUT = handler(async (request: NextRequest, { params }: { params: { key: string } }) => {
  await requireHr(request);
  if (!DEFAULT_PROMPTS[params.key as PromptKey]) throw new HttpError(404, 'Unknown prompt key');
  const { version } = await readJson(request);
  await query(`UPDATE ai_prompts SET active = false WHERE key = $1`, [params.key]);
  if (Number(version) > 0) {
    const rows = await query(`UPDATE ai_prompts SET active = true WHERE key = $1 AND version = $2 RETURNING id`, [params.key, Number(version)]);
    if (!rows.length) throw new HttpError(404, 'Version not found');
  }
  return ok({ key: params.key, active_version: Number(version) || 0 });
});
