import { NextRequest } from 'next/server';
import { getAuth, handler, ok, readJson, HttpError } from '@/lib/training/http';
import { getTodayDrill, submitDrillItem } from '@/lib/training/daily';

export const dynamic = 'force-dynamic';

/** GET /api/training/drills/today — the 5-minute daily drill. */
export const GET = handler(async (request: NextRequest) => {
  const auth = await getAuth(request);
  return ok(await getTodayDrill(auth.userId));
});

/** POST /api/training/drills/today { kind, id, ...payload } — submit one drill item. */
export const POST = handler(async (request: NextRequest) => {
  const auth = await getAuth(request);
  const b = await readJson(request);
  if (!b.kind) throw new HttpError(400, 'kind is required');
  return ok(await submitDrillItem(auth.userId, { kind: b.kind, id: Number(b.id || 0) }, b));
});
