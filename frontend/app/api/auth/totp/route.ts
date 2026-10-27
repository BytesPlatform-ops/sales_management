import { NextRequest } from 'next/server';
import { handler, ok, readJson } from '@/lib/training/http';
import { completeChallenge } from '@/lib/auth/twofactor';

export const dynamic = 'force-dynamic';

/** POST /api/auth/totp { challenge, code } — second step of a CEO login. Returns { token, user }. */
export const POST = handler(async (request: NextRequest) => {
  const b = await readJson(request);
  return ok(await completeChallenge(String(b.challenge || ''), String(b.code || ''), request));
});
