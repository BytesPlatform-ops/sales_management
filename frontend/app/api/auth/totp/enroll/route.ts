import { NextRequest } from 'next/server';
import { handler, ok, readJson } from '@/lib/training/http';
import { enrollDuringChallenge } from '@/lib/auth/twofactor';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/totp/enroll { challenge } — during a CEO's first login: a new authenticator
 * secret (shown once) + otpauth:// URI. Confirmed by the first correct code at /api/auth/totp.
 */
export const POST = handler(async (request: NextRequest) => {
  const b = await readJson(request);
  return ok(await enrollDuringChallenge(String(b.challenge || '')));
});
