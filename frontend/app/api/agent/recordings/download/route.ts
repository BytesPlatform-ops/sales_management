import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { query, queryOne } from '@/lib/db';
import { findRecordingForRequest, getClientSecret } from '@/lib/recording-lookup';
import { recordingPlayUrl } from '@/lib/recording-links';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'
);

export const dynamic = 'force-dynamic';

/**
 * GET /api/agent/recordings/download?id=123
 * Returns a short-lived app link for an approved recording. If no recording was
 * found at approval time (3CX down, recording not saved yet), looks it up again.
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ status: 'error', message: 'No token' }, { status: 401 });
    }
    const { payload } = await jwtVerify(authHeader.split(' ')[1], JWT_SECRET);
    const jwt = payload as unknown as { userId: number };

    const requestId = request.nextUrl.searchParams.get('id');
    if (!requestId) {
      return NextResponse.json({ status: 'error', message: 'Request ID required' }, { status: 400 });
    }

    const rr = await queryOne<any>(
      `SELECT * FROM recording_requests WHERE id = $1 AND agent_id = $2 AND status = 'approved'`,
      [Number(requestId), Number(jwt.userId)]
    );
    if (!rr) {
      return NextResponse.json({ status: 'error', message: 'Approved recording not found' }, { status: 404 });
    }

    let recId: string | null = rr.rec_id;
    if (!recId) {
      const clientSecret = await getClientSecret();
      if (!clientSecret) {
        return NextResponse.json({ status: 'error', message: '3CX not configured' }, { status: 500 });
      }
      const lookup = await findRecordingForRequest(rr, clientSecret);
      if (lookup.error) {
        return NextResponse.json({ status: 'error', message: '3CX is not reachable right now — try again in a few minutes' }, { status: 502 });
      }
      if (!lookup.recId) {
        return NextResponse.json({ status: 'error', message: 'Recording not in 3CX yet — ask HR to check it' }, { status: 404 });
      }
      recId = lookup.recId;
      await query(`UPDATE recording_requests SET rec_id = $1, recording_url = NULL, updated_at = NOW() WHERE id = $2`, [recId, rr.id]);
    }

    return NextResponse.json({
      status: 'success',
      data: { download_url: `${await recordingPlayUrl(recId)}&download=1`, rec_id: recId },
    });
  } catch (error) {
    console.error('Recording download error:', error);
    return NextResponse.json({ status: 'error', message: 'Failed to get download URL' }, { status: 500 });
  }
}
