import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { handler, ok, requireHr } from '@/lib/training/http';
import { generateCoachDigest } from '@/lib/training/digest';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** GET /api/training/digest (trainer) — weekly coach digests, newest first. */
export const GET = handler(async (request: NextRequest) => {
  await requireHr(request);
  return ok(await query(`SELECT id, week_start, body_md, ai_used, created_at FROM training_coach_digests ORDER BY week_start DESC LIMIT 26`));
});

/** POST /api/training/digest (trainer) — (re)generate this week's digest now. */
export const POST = handler(async (request: NextRequest) => {
  await requireHr(request);
  return ok(await generateCoachDigest(true));
});
