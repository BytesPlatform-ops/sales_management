import { NextRequest } from 'next/server';
import { getAuth, handler, ok } from '@/lib/training/http';
import { currentLeadFor } from '@/lib/training/assist';

export const dynamic = 'force-dynamic';

/** GET /api/training/assist/lead[?lead_id=] — auto-load the lead row the rep is dialing (My Leads). */
export const GET = handler(async (request: NextRequest) => {
  const auth = await getAuth(request);
  const leadId = new URL(request.url).searchParams.get('lead_id');
  return ok(await currentLeadFor(auth.userId, leadId ? Number(leadId) : undefined));
});
