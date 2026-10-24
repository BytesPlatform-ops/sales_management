import { NextRequest } from 'next/server';
import { handler, ok, readJson, requireHr, HttpError } from '@/lib/training/http';
import { revokeCertification } from '@/lib/training/progress';
import { notify } from '@/lib/training/events';

export const dynamic = 'force-dynamic';

/** POST /api/training/certifications/{code}/revoke (trainer) { user_id, notes? } — LIVE_CALL_CERT revoke stops quota credit. */
export const POST = handler(async (request: NextRequest, { params }: { params: { code: string } }) => {
  const auth = await requireHr(request);
  const code = params.code.toUpperCase();
  const b = await readJson(request);
  if (!b.user_id) throw new HttpError(400, 'user_id is required');
  const done = await revokeCertification(Number(b.user_id), code, auth.userId, b.notes);
  if (!done) throw new HttpError(404, 'Rep does not hold this certification');
  await notify(Number(b.user_id), 'certification', `${code.replace(/_/g, ' ')} was revoked by your trainer${b.notes ? `: ${b.notes}` : ''}.`, '/agent/training');
  return ok({ revoked: code, user_id: Number(b.user_id) });
});
