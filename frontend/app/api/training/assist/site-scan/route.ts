import { NextRequest } from 'next/server';
import { getAuth, handler, ok, readJson } from '@/lib/training/http';
import { scanSite } from '@/lib/training/site-scan';

export const dynamic = 'force-dynamic';

/** POST /api/training/assist/site-scan { url, force?, ai? } → 10-point checklist + plain-English lines */
export const POST = handler(async (request: NextRequest) => {
  const auth = await getAuth(request);
  const b = await readJson(request);
  return ok(await scanSite(String(b.url || ''), auth.userId, { force: !!b.force, withAi: b.ai !== false }));
});
