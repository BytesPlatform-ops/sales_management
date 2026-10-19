import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { fetchRecordingAudio } from '@/lib/3cx-client';
import { verifyRecordingPlayToken } from '@/lib/recording-links';

export const dynamic = 'force-dynamic';

/**
 * GET /api/recordings/play?t=<signed link>[&download=1]
 *
 * Streams one 3CX recording. Links are minted by recordingPlayUrl() only for users
 * allowed to hear that recording, so the 3CX token stays on the server.
 */
export async function GET(request: NextRequest) {
  const t = request.nextUrl.searchParams.get('t');
  const recId = t ? await verifyRecordingPlayToken(t) : null;
  if (!recId) {
    return NextResponse.json({ error: 'Link expired — refresh the page and try again' }, { status: 401 });
  }

  const clientSecret = (await queryOne<{ value: string }>(
    `SELECT value FROM system_settings WHERE key = 'recording_access_token'`
  ))?.value;
  if (!clientSecret) {
    return NextResponse.json({ error: '3CX not configured' }, { status: 500 });
  }

  const upstream = await fetchRecordingAudio(clientSecret, recId, request.headers.get('range'));
  if ('error' in upstream) {
    console.error('[recordings/play] 3CX auth failed:', upstream.error);
    return NextResponse.json({ error: 'Could not reach 3CX' }, { status: 502 });
  }
  if (!upstream.ok && upstream.status !== 206) {
    console.error(`[recordings/play] 3CX returned ${upstream.status} for recording ${recId}`);
    const status = upstream.status === 404 ? 404 : 502;
    return NextResponse.json({ error: status === 404 ? 'Recording no longer exists in 3CX' : '3CX error' }, { status });
  }

  const headers = new Headers();
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (!headers.has('content-type')) headers.set('content-type', 'audio/wav');
  headers.set('cache-control', 'private, no-store');
  const download = request.nextUrl.searchParams.get('download') === '1';
  headers.set('content-disposition', `${download ? 'attachment' : 'inline'}; filename="recording-${recId}.wav"`);

  return new NextResponse(upstream.body, { status: upstream.status, headers });
}
