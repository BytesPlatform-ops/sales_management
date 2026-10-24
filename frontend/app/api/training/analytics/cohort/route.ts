import { NextRequest } from 'next/server';
import { handler, ok, requireHr } from '@/lib/training/http';
import { cohortAnalytics } from '@/lib/training/analytics';

export const dynamic = 'force-dynamic';

/** GET /api/training/analytics/cohort (trainer) — cohort dashboard. */
export const GET = handler(async (request: NextRequest) => {
  await requireHr(request);
  return ok(await cohortAnalytics());
});
