import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { query, queryOne } from '@/lib/db';
import { listRecordings, getRecordingDownloadUrl } from '@/lib/3cx-client';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'
);

interface JwtPayload {
  userId: number;
  username: string;
  role: string;
}

export const dynamic = 'force-dynamic';

/**
 * GET /api/hr/recordings — List all recording requests for HR
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ status: 'error', message: 'No token' }, { status: 401 });
    }
    const { payload } = await jwtVerify(authHeader.split(' ')[1], JWT_SECRET);
    const jwt = payload as unknown as JwtPayload;
    if (jwt.role !== 'hr') {
      return NextResponse.json({ status: 'error', message: 'HR only' }, { status: 403 });
    }

    const status = request.nextUrl.searchParams.get('status') || 'all';
    const whereClause = status !== 'all' ? `WHERE rr.status = '${status}'` : '';

    const requests = await query<any>(
      `SELECT rr.*, u.username as agent_name, u.full_name as agent_full_name,
              u2.username as approved_by_name
       FROM recording_requests rr
       JOIN users u ON u.id = rr.agent_id
       LEFT JOIN users u2 ON u2.id = rr.approved_by
       ${whereClause}
       ORDER BY CASE rr.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, rr.created_at DESC
       LIMIT 100`
    );

    return NextResponse.json({ status: 'success', data: requests });
  } catch (error) {
    console.error('HR get recording requests error:', error);
    return NextResponse.json({ status: 'error', message: 'Failed to fetch requests' }, { status: 500 });
  }
}

/**
 * POST /api/hr/recordings — HR approves/rejects a recording request
 * Body: { request_id, action: 'approve' | 'reject', hr_notes? }
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ status: 'error', message: 'No token' }, { status: 401 });
    }
    const { payload } = await jwtVerify(authHeader.split(' ')[1], JWT_SECRET);
    const jwt = payload as unknown as JwtPayload;
    if (jwt.role !== 'hr') {
      return NextResponse.json({ status: 'error', message: 'HR only' }, { status: 403 });
    }

    const body = await request.json();
    const { request_id, action, hr_notes } = body;

    if (!request_id || !['approve', 'reject'].includes(action)) {
      return NextResponse.json({ status: 'error', message: 'request_id and action (approve/reject) required' }, { status: 400 });
    }

    const rr = await queryOne<any>('SELECT * FROM recording_requests WHERE id = $1', [request_id]);
    if (!rr) {
      return NextResponse.json({ status: 'error', message: 'Request not found' }, { status: 404 });
    }

    if (action === 'reject') {
      await queryOne(
        `UPDATE recording_requests SET status = 'rejected', approved_by = $1, hr_notes = $2, updated_at = NOW() WHERE id = $3`,
        [Number(jwt.userId), hr_notes || null, request_id]
      );
      return NextResponse.json({ status: 'success', message: 'Request rejected' });
    }

    // Approve — try to find recording in 3CX
    let recordingUrl: string | null = null;
    let recId = rr.rec_id;

    if (!recId && rr.call_log_id) {
      // Try to match via call_logs
      const callLog = await queryOne<any>('SELECT * FROM call_logs WHERE id = $1', [rr.call_log_id]);
      if (callLog?.rec_id) {
        recId = callLog.rec_id;
      } else if (callLog) {
        // Search 3CX recordings for this call
        const clientSecret = (await queryOne<any>("SELECT value FROM system_settings WHERE key = 'recording_access_token'"))?.value;
        if (clientSecret) {
          const callDate = new Date(callLog.call_time);
          const startDate = new Date(callDate.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
          const endDate = new Date(callDate.getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];

          const { recordings } = await listRecordings(clientSecret, startDate, endDate);

          // Match by phone number (last 10 digits)
          const phoneClean = rr.phone_number.replace(/[^\d]/g, '').slice(-10);
          const match = recordings.find(r => {
            const toClean = r.ToCallerNumber.replace(/[^\d]/g, '').slice(-10);
            const fromClean = r.FromCallerNumber.replace(/[^\d]/g, '').slice(-10);
            return toClean === phoneClean || fromClean === phoneClean;
          });

          if (match) {
            recId = String(match.Id);
            // Cache in call_logs too
            await queryOne('UPDATE call_logs SET rec_id = $1 WHERE id = $2', [recId, callLog.id]);
          }
        }
      }
    }

    if (!recId) {
      // Last resort: search 3CX by phone number directly (last 7 days)
      const clientSecret = (await queryOne<any>("SELECT value FROM system_settings WHERE key = 'recording_access_token'"))?.value;
      if (clientSecret) {
        const endDate = new Date().toISOString().split('T')[0];
        const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const { recordings } = await listRecordings(clientSecret, startDate, endDate);

        const phoneClean = rr.phone_number.replace(/[^\d]/g, '').slice(-10);
        const match = recordings.find(r => {
          const toClean = r.ToCallerNumber.replace(/[^\d]/g, '').slice(-10);
          const fromClean = r.FromCallerNumber.replace(/[^\d]/g, '').slice(-10);
          return toClean === phoneClean || fromClean === phoneClean;
        });

        if (match) {
          recId = String(match.Id);
        }
      }
    }

    // Generate download URL if we found the recording
    if (recId) {
      const clientSecret = (await queryOne<any>("SELECT value FROM system_settings WHERE key = 'recording_access_token'"))?.value;
      if (clientSecret) {
        recordingUrl = await getRecordingDownloadUrl(Number(recId), clientSecret);
      }
    }

    await queryOne(
      `UPDATE recording_requests
       SET status = 'approved', approved_by = $1, hr_notes = $2, rec_id = $3, recording_url = $4, updated_at = NOW()
       WHERE id = $5`,
      [Number(jwt.userId), hr_notes || null, recId || null, recordingUrl || null, request_id]
    );

    return NextResponse.json({
      status: 'success',
      message: recId ? 'Approved — recording found' : 'Approved — recording not found in 3CX (may need manual lookup)',
      data: { rec_id: recId, has_recording: !!recId },
    });
  } catch (error) {
    console.error('HR recording action error:', error);
    return NextResponse.json({ status: 'error', message: 'Failed to process request' }, { status: 500 });
  }
}
