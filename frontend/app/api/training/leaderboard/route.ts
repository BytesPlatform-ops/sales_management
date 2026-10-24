import { NextRequest } from 'next/server';
import { getAuth, handler, ok } from '@/lib/training/http';
import { leaderboard } from '@/lib/training/analytics';

export const dynamic = 'force-dynamic';

/** GET /api/training/leaderboard?period=week|month — drills, roleplay avg, live scorecard, meetings booked. */
export const GET = handler(async (request: NextRequest) => {
  await getAuth(request);
  const period = new URL(request.url).searchParams.get('period') === 'month' ? 'month' : 'week';
  return ok(await leaderboard(period));
});
