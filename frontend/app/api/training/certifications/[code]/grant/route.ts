import { NextRequest } from 'next/server';
import { handler, ok, readJson, requireHr, HttpError } from '@/lib/training/http';
import { grantCertification, evaluateProgress } from '@/lib/training/progress';

export const dynamic = 'force-dynamic';

const CODES = ['PRODUCT_CERT', 'LIVE_CALL_CERT', 'BYTESCON_CERT'];

/** POST /api/training/certifications/{code}/grant (trainer) { user_id, notes? } */
export const POST = handler(async (request: NextRequest, { params }: { params: { code: string } }) => {
  const auth = await requireHr(request);
  const code = params.code.toUpperCase();
  if (!CODES.includes(code)) throw new HttpError(400, 'Unknown certification');
  const b = await readJson(request);
  if (!b.user_id) throw new HttpError(400, 'user_id is required');
  const granted = await grantCertification(Number(b.user_id), code, 'manual', auth.userId, b.notes);
  if (!granted) throw new HttpError(409, 'Rep already holds this certification');
  await evaluateProgress(Number(b.user_id));
  return ok({ granted: code, user_id: Number(b.user_id) });
});
