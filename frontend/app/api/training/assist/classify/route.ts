import { NextRequest } from 'next/server';
import { getAuth, handler, ok, readJson } from '@/lib/training/http';
import { classifyLead } from '@/lib/training/assist';

export const dynamic = 'force-dynamic';

/**
 * POST /api/training/assist/classify { lead_row: { narrative }, scan_id?, flags?, answers? }
 * → service recommendation from the C3.2 rubric and decision tree.
 * `answers` are flags the rep learned on the call (e.g. "missed_calls_pain", "bids_often").
 */
export const POST = handler(async (request: NextRequest) => {
  await getAuth(request);
  const b = await readJson(request);
  return ok(await classifyLead({
    narrative: b.lead_row?.narrative || b.narrative || '',
    flags: Array.isArray(b.flags) ? b.flags : [],
    answers: Array.isArray(b.answers) ? b.answers : [],
    scan_id: b.scan_id ? Number(b.scan_id) : null,
  }));
});
