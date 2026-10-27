import { NextRequest } from 'next/server';
import { handler, ok, HttpError } from '@/lib/training/http';
import { getViewer } from '@/lib/projects/core';
import { github } from '@/lib/github/client';
import { callbackUrl, linkState } from '@/lib/github/link';

export const dynamic = 'force-dynamic';

/** POST /api/profile/github/connect → { url } to send the browser to GitHub. (POST: our auth is a Bearer header.) */
export const POST = handler(async (request: NextRequest) => {
  const v = await getViewer(request);
  if (v.role !== 'developer' && v.role !== 'hr') throw new HttpError(403, 'Only developers and HR link GitHub accounts');
  if (!process.env.GITHUB_CLIENT_ID) throw new HttpError(503, 'GitHub sign-in is not configured on the server');
  return ok({ url: github().oauthAuthorizeUrl(await linkState(v.userId), callbackUrl(new URL(request.url).origin)) });
});
