import { NextRequest } from 'next/server';
import { getAuth, handler, ok } from '@/lib/training/http';
import { dueFlashcards } from '@/lib/training/daily';

export const dynamic = 'force-dynamic';

/** GET /api/training/flashcards/due — today's spaced-repetition queue. */
export const GET = handler(async (request: NextRequest) => {
  const auth = await getAuth(request);
  const limit = Math.min(50, Number(new URL(request.url).searchParams.get('limit') || 20));
  return ok(await dueFlashcards(auth.userId, limit));
});
