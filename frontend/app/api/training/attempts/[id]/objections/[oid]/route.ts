import { NextRequest } from 'next/server';
import { getAuth, handler, ok } from '@/lib/training/http';
import { objectionModelAnswer } from '@/lib/training/attempts';

export const dynamic = 'force-dynamic';

/** GET — model answers for one objection in a drill, for self-rating in standard mode (E.4 fallback). */
export const GET = handler(async (request: NextRequest, { params }: { params: { id: string; oid: string } }) => {
  const auth = await getAuth(request);
  return ok(await objectionModelAnswer(Number(params.id), auth.userId, Number(params.oid)));
});
