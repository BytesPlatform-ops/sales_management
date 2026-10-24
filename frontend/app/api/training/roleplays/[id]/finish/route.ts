import { NextRequest } from 'next/server';
import { getAuth, handler, ok, readJson } from '@/lib/training/http';
import { finishSession } from '@/lib/training/roleplay';
import { evaluateProgress } from '@/lib/training/progress';
import { evaluateBadges } from '@/lib/training/badges';
import { recordVoiceUsage } from '@/lib/training/ai';
import { notifyTrainers } from '@/lib/training/events';

export const dynamic = 'force-dynamic';

/** POST /api/training/roleplays/{id}/finish { transcript?, duration_s? } → AI (or script) score */
export const POST = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const auth = await getAuth(request);
  const b = await readJson(request).catch(() => ({}));
  const session = await finishSession(Number(params.id), auth.userId, {
    transcript: Array.isArray(b.transcript) ? b.transcript : undefined,
    durationS: b.duration_s ? Number(b.duration_s) : undefined,
  });
  if (session.mode === 'voice' && b.duration_s) await recordVoiceUsage(auth.userId, Number(b.duration_s));
  if (session.status === 'needs_review') {
    await notifyTrainers('review_queue', `Roleplay #${session.id} (${session.title || ''}) scored ${session.final_score ?? 'ungraded'} and needs review.`, '/hr/training/reviews');
  }
  const certs = await evaluateProgress(auth.userId);
  const badges = await evaluateBadges(auth.userId);
  return ok({ session, new_certifications: certs, new_badges: badges });
});
