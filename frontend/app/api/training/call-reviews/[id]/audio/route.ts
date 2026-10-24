import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getAuth, handler, HttpError } from '@/lib/training/http';

export const dynamic = 'force-dynamic';

/**
 * GET /api/training/call-reviews/{id}/audio — stream an uploaded recording.
 * Accepts the bearer header or ?token= (for <audio src>), like the rest of the app's JWT auth.
 */
export const GET = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const token = new URL(request.url).searchParams.get('token');
  const req = token
    ? new NextRequest(request.url, { headers: { authorization: `Bearer ${token}` } })
    : request;
  const auth = await getAuth(req);
  const row = await queryOne<{ user_id: number; mime_type: string; data: Buffer }>(
    `SELECT r.user_id, a.mime_type, a.data FROM training_call_audio a JOIN training_call_reviews r ON r.id = a.review_id WHERE a.review_id = $1`,
    [Number(params.id)]
  );
  if (!row || (auth.role !== 'hr' && Number(row.user_id) !== auth.userId)) throw new HttpError(404, 'Audio not available (deleted after the retention period or never uploaded)');
  return new NextResponse(new Uint8Array(row.data), {
    headers: { 'Content-Type': row.mime_type, 'Cache-Control': 'private, max-age=300', 'Content-Length': String(row.data.length) },
  });
});
