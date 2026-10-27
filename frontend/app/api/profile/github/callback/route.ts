import { NextRequest, NextResponse } from 'next/server';
import { HttpError } from '@/lib/training/http';
import { completeLink } from '@/lib/github/link';

export const dynamic = 'force-dynamic';

/** GET /api/profile/github/callback?code&state — GitHub sends the browser here; we link and go back to the profile. */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const back = (q: string) => NextResponse.redirect(new URL(`/profile?${q}`, process.env.APP_BASE_URL || url.origin));
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) return back('github=cancelled');
  try {
    await completeLink(state, code, url.origin);
    return back('github=linked');
  } catch (e) {
    const msg = e instanceof HttpError ? e.message : 'GitHub linking failed — try again';
    if (!(e instanceof HttpError)) console.error('[github] link', (e as Error).message);
    return back(`github=error&message=${encodeURIComponent(msg)}`);
  }
}
