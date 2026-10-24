import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { getAuth, handler, ok, resolveTargetUser } from '@/lib/training/http';

export const dynamic = 'force-dynamic';

/**
 * GET /api/training/call-reviews/candidates[?user_id=] — recent real calls the QA
 * pipeline transcribed (≥60 s) that haven't been graded with the scorecard yet.
 */
export const GET = handler(async (request: NextRequest) => {
  const auth = await getAuth(request);
  const userId = resolveTargetUser(auth, new URL(request.url).searchParams.get('user_id'));
  const rows = await query(
    `SELECT t.id, t.call_started_at, t.duration_sec, t.shift_date, LEFT(t.transcript, 200) AS preview,
            e.overall_score AS qa_score, e.meeting_scheduled, e.disposition
     FROM call_transcripts t
     LEFT JOIN call_evaluations e ON e.transcript_id = t.id
     WHERE t.agent_id = $1 AND t.transcript IS NOT NULL AND t.duration_sec >= 60
       AND NOT EXISTS (SELECT 1 FROM training_call_reviews r WHERE r.call_transcript_id = t.id)
     ORDER BY t.call_started_at DESC NULLS LAST LIMIT 30`,
    [userId]
  );
  return ok(rows);
});
