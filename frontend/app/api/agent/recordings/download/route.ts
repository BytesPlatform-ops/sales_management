import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { queryOne } from '@/lib/db';
import { getRecordingDownloadUrl } from '@/lib/3cx-client';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'
);

export const dynamic = 'force-dynamic';

/**
 * GET /api/agent/recordings/download?id=123
 * Returns a fresh download URL for an approved recording (3CX tokens expire in 60s)
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

    if (!rr.rec_id) {
      return NextResponse.json({ status: 'error', message: 'Recording not available in 3CX' }, { status: 404 });
    }

    const clientSecret = (await queryOne<any>("SELECT value FROM system_settings WHERE key = 'recording_access_token'"))?.value;
    if (!clientSecret) {
      return NextResponse.json({ status: 'error', message: '3CX not configured' }, { status: 500 });
    }

    const downloadUrl = await getRecordingDownloadUrl(Number(rr.rec_id), clientSecret);

    return NextResponse.json({
      status: 'success',
      data: { download_url: downloadUrl },
    });
  } catch (error) {
    console.error('Recording download error:', error);
    return NextResponse.json({ status: 'error', message: 'Failed to get download URL' }, { status: 500 });
  }
}
