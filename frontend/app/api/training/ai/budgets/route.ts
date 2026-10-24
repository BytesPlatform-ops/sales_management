import { NextRequest } from 'next/server';
import { queryOne } from '@/lib/db';
import { handler, ok, readJson, requireHr, HttpError } from '@/lib/training/http';

export const dynamic = 'force-dynamic';

/** POST /api/training/ai/budgets (admin) { user_id (0 = org), month?, cap_usd, hard_stop? } — raise/lower a cap. */
export const POST = handler(async (request: NextRequest) => {
  await requireHr(request);
  const b = await readJson(request);
  if (b.user_id === undefined || b.cap_usd === undefined) throw new HttpError(400, 'user_id and cap_usd are required');
  const cap = Number(b.cap_usd);
  if (!(cap >= 0)) throw new HttpError(400, 'cap_usd must be ≥ 0');
  const month = /^\d{4}-\d{2}$/.test(b.month || '') ? b.month : new Date().toISOString().slice(0, 7);
  const row = await queryOne(
    `INSERT INTO ai_budgets (user_id, month, cap_usd, hard_stop) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, month) DO UPDATE SET cap_usd = EXCLUDED.cap_usd, hard_stop = EXCLUDED.hard_stop,
       warned_at = CASE WHEN EXCLUDED.cap_usd > ai_budgets.cap_usd THEN NULL ELSE ai_budgets.warned_at END, updated_at = NOW()
     RETURNING *`,
    [Number(b.user_id), month, cap, b.hard_stop ?? true]
  );
  return ok(row);
});
