import { NextRequest } from 'next/server';
import { getAuth, handler, ok } from '@/lib/training/http';
import { startAttempt } from '@/lib/training/attempts';

export const dynamic = 'force-dynamic';

/** POST /api/training/lessons/{id}/attempts — start (or resume) a quiz, exam or drill attempt. */
export const POST = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const auth = await getAuth(request);
  return ok(await startAttempt(auth.userId, Number(params.id)));
});
