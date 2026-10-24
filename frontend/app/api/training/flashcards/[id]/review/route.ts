import { NextRequest } from 'next/server';
import { getAuth, handler, ok, readJson } from '@/lib/training/http';
import { reviewFlashcard } from '@/lib/training/daily';

export const dynamic = 'force-dynamic';

/** POST /api/training/flashcards/{id}/review { result: again|hard|good|easy } */
export const POST = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const auth = await getAuth(request);
  const { result } = await readJson(request);
  return ok(await reviewFlashcard(auth.userId, Number(params.id), result));
});
