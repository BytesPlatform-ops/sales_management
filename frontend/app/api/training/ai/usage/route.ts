import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { getAuth, handler, ok } from '@/lib/training/http';
import { aiStatus } from '@/lib/training/ai';
import { getSettings } from '@/lib/training/settings';

export const dynamic = 'force-dynamic';

/** GET /api/training/ai/usage?month=YYYY-MM — trainer: org + per rep + per feature; rep: own usage. */
export const GET = handler(async (request: NextRequest) => {
  const auth = await getAuth(request);
  const month = new URL(request.url).searchParams.get('month') || new Date().toISOString().slice(0, 7);
  const own = auth.role !== 'hr';
  const filter = own ? 'AND s.user_id = $2' : '';
  const params = own ? [month, auth.userId] : [month];

  const [byFeature, byUser, budgets, errors, models, settings, status] = await Promise.all([
    query(
      `SELECT feature, model, COUNT(*)::int AS calls, SUM(input_tokens)::int AS input_tokens, SUM(cached_tokens)::int AS cached_tokens,
              SUM(output_tokens)::int AS output_tokens, ROUND(SUM(audio_seconds)) AS audio_seconds, SUM(cost_usd) AS cost_usd,
              ROUND(AVG(latency_ms)) AS avg_latency_ms
       FROM ai_sessions s WHERE to_char(created_at, 'YYYY-MM') = $1 ${filter} GROUP BY feature, model ORDER BY SUM(cost_usd) DESC`,
      params
    ),
    own ? Promise.resolve([]) : query(
      `SELECT s.user_id, COALESCE(u.full_name, 'System / batch') AS name, COUNT(*)::int AS calls, SUM(s.cost_usd) AS cost_usd
       FROM ai_sessions s LEFT JOIN users u ON u.id = s.user_id
       WHERE to_char(s.created_at, 'YYYY-MM') = $1 GROUP BY s.user_id, u.full_name ORDER BY SUM(s.cost_usd) DESC`,
      [month]
    ),
    query(
      `SELECT b.user_id, COALESCE(u.full_name, CASE WHEN b.user_id = 0 THEN 'Organisation' END) AS name, b.month, b.cap_usd, b.spent_usd, b.hard_stop, b.warned_at
       FROM ai_budgets b LEFT JOIN users u ON u.id = b.user_id
       WHERE b.month = $1 ${own ? 'AND b.user_id = $2' : ''} ORDER BY b.user_id`,
      params
    ),
    query(
      `SELECT feature, model, error, created_at FROM ai_sessions s
       WHERE to_char(created_at, 'YYYY-MM') = $1 AND error IS NOT NULL ${filter} ORDER BY created_at DESC LIMIT 20`,
      params
    ),
    own ? Promise.resolve([]) : query(`SELECT * FROM ai_model_prices ORDER BY status, model`),
    getSettings(),
    aiStatus(own ? auth.userId : null),
  ]);

  return ok({
    month, status, by_feature: byFeature, by_user: byUser, budgets, recent_errors: errors, model_prices: models,
    models: settings.ai_models, caps: settings.ai_caps, ai_enabled: settings.ai_enabled, voice_enabled: settings.voice_enabled,
    key_configured: !!process.env.OPENAI_API_KEY,
  });
});
