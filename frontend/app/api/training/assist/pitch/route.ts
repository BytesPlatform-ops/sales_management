import { NextRequest } from 'next/server';
import { getAuth, handler, ok, readJson } from '@/lib/training/http';
import { generatePitch } from '@/lib/training/assist';

export const dynamic = 'force-dynamic';

/** POST /api/training/assist/pitch { capabilities_narrative, firm?, state?, flags?, contact? } → 3 talking points */
export const POST = handler(async (request: NextRequest) => {
  const auth = await getAuth(request);
  const b = await readJson(request);
  return ok(await generatePitch(auth.userId, {
    narrative: b.capabilities_narrative || b.narrative || '', firm: b.firm, state: b.state,
    flags: Array.isArray(b.flags) ? b.flags : [], contact: b.contact,
  }));
});
