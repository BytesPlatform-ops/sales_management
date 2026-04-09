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
 * GET /api/agent/recordings — List agent's recording requests
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ status: 'error', message: 'No token' }, { status: 401 });
    }
    const { payload } = await jwtVerify(authHeader.split(' ')[1], JWT_SECRET);
    const jwt = payload as unknown as JwtPayload;

    const requests = await query<any>(
      `SELECT rr.*, u2.username as approved_by_name
       FROM recording_requests rr
       LEFT JOIN users u2 ON u2.id = rr.approved_by
       WHERE rr.agent_id = $1
       ORDER BY rr.created_at DESC
       LIMIT 50`,
      [Number(jwt.userId)]
    );

    return NextResponse.json({ status: 'success', data: requests });
  } catch (error) {
    console.error('Get recording requests error:', error);
    return NextResponse.json({ status: 'error', message: 'Failed to fetch requests' }, { status: 500 });
  }
}

/**
 * POST /api/agent/recordings — Agent requests a recording by phone number
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ status: 'error', message: 'No token' }, { status: 401 });
    }
    const { payload } = await jwtVerify(authHeader.split(' ')[1], JWT_SECRET);
    const jwt = payload as unknown as JwtPayload;

    const body = await request.json();
    const { phone_number, call_log_id, notes, action } = body;

    // Action: search — find agent's own calls for a phone number
    if (action === 'search') {
      if (!phone_number || phone_number.trim().length < 7) {
        return NextResponse.json({ status: 'error', message: 'Valid phone number is required' }, { status: 400 });
      }
      const cleanPhone = phone_number.replace(/[^\d+]/g, '');

      // Get agent's extension number
      const agent = await queryOne<any>('SELECT extension_number FROM users WHERE id = $1', [Number(jwt.userId)]);
      const agentExt = agent?.extension_number;

      let calls;
      if (agentExt) {
        calls = await query<any>(
          `SELECT id, phone_number, call_time, call_duration, agent_extension, rec_id
           FROM call_logs
           WHERE phone_number LIKE $1 AND agent_extension = $2
           ORDER BY call_time DESC
           LIMIT 20`,
          [`%${cleanPhone.slice(-10)}%`, agentExt]
        );
      } else {
        // Fallback if no extension set — show all (shouldn't happen)
        calls = await query<any>(
          `SELECT id, phone_number, call_time, call_duration, agent_extension, rec_id
           FROM call_logs
           WHERE phone_number LIKE $1
           ORDER BY call_time DESC
           LIMIT 20`,
          [`%${cleanPhone.slice(-10)}%`]
        );
      }
      return NextResponse.json({ status: 'success', data: calls });
    }

    // Action: submit — create a recording request for a specific call
    if (!phone_number || phone_number.trim().length < 7) {
      return NextResponse.json({ status: 'error', message: 'Valid phone number is required' }, { status: 400 });
    }

    const cleanPhone = phone_number.replace(/[^\d+]/g, '');

    // Check for duplicate pending request for this specific call
    const existing = await queryOne<any>(
      `SELECT id FROM recording_requests WHERE agent_id = $1 AND phone_number = $2 AND call_log_id = $3 AND status = 'pending'`,
      [Number(jwt.userId), cleanPhone, call_log_id || null]
    );
    if (existing) {
      return NextResponse.json({ status: 'error', message: 'You already have a pending request for this call' }, { status: 400 });
    }

    // Get rec_id from selected call_log if provided
    let recId: string | null = null;
    if (call_log_id) {
      const callLog = await queryOne<any>('SELECT rec_id FROM call_logs WHERE id = $1', [call_log_id]);
      recId = callLog?.rec_id || null;
    }

    // Check if agent is Extension 11 — auto-approve without HR
    const agent = await queryOne<any>('SELECT extension_number FROM users WHERE id = $1', [Number(jwt.userId)]);
    const isAutoApprove = agent?.extension_number === '11';

    if (isAutoApprove) {
      // Auto-approve: insert as approved and fetch recording from 3CX immediately
      let downloadUrl: string | null = null;

      // Try to find recording in 3CX
      if (!recId && call_log_id) {
        const callLog = await queryOne<any>('SELECT * FROM call_logs WHERE id = $1', [call_log_id]);
        if (callLog?.rec_id) {
          recId = callLog.rec_id;
        } else if (callLog) {
          const clientSecret = (await queryOne<any>("SELECT value FROM system_settings WHERE key = 'recording_access_token'"))?.value;
          if (clientSecret) {
            const callDate = new Date(callLog.call_time);
            const startDate = new Date(callDate.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            const endDate = new Date(callDate.getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            const { recordings } = await listRecordings(clientSecret, startDate, endDate);
            const phoneClean = cleanPhone.replace(/[^\d]/g, '').slice(-10);
            const match = recordings.find((r: any) => {
              const toClean = r.ToCallerNumber.replace(/[^\d]/g, '').slice(-10);
              const fromClean = r.FromCallerNumber.replace(/[^\d]/g, '').slice(-10);
              return toClean === phoneClean || fromClean === phoneClean;
            });
            if (match) {
              recId = String(match.Id);
              await queryOne('UPDATE call_logs SET rec_id = $1 WHERE id = $2', [recId, callLog.id]);
            }
          }
        }
      }

      if (!recId) {
        const clientSecret = (await queryOne<any>("SELECT value FROM system_settings WHERE key = 'recording_access_token'"))?.value;
        if (clientSecret) {
          const endDate = new Date().toISOString().split('T')[0];
          const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
          const { recordings } = await listRecordings(clientSecret, startDate, endDate);
          const phoneClean = cleanPhone.replace(/[^\d]/g, '').slice(-10);
          const match = recordings.find((r: any) => {
            const toClean = r.ToCallerNumber.replace(/[^\d]/g, '').slice(-10);
            const fromClean = r.FromCallerNumber.replace(/[^\d]/g, '').slice(-10);
            return toClean === phoneClean || fromClean === phoneClean;
          });
          if (match) {
            recId = String(match.Id);
          }
        }
      }

      if (recId) {
        const clientSecret = (await queryOne<any>("SELECT value FROM system_settings WHERE key = 'recording_access_token'"))?.value;
        if (clientSecret) {
          downloadUrl = await getRecordingDownloadUrl(Number(recId), clientSecret);
        }
      }

      const result = await queryOne<any>(
        `INSERT INTO recording_requests (agent_id, phone_number, call_log_id, rec_id, notes, status, recording_url)
         VALUES ($1, $2, $3, $4, $5, 'approved', $6) RETURNING *`,
        [Number(jwt.userId), cleanPhone, call_log_id || null, recId, notes || null, downloadUrl]
      );

      return NextResponse.json({
        status: 'success',
        message: recId ? 'Recording auto-approved — ready to download' : 'Recording auto-approved — recording not found in 3CX',
        data: result,
      });
    }

    const result = await queryOne<any>(
      `INSERT INTO recording_requests (agent_id, phone_number, call_log_id, rec_id, notes)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [Number(jwt.userId), cleanPhone, call_log_id || null, recId, notes || null]
    );

    return NextResponse.json({
      status: 'success',
      message: 'Recording request submitted',
      data: result,
    });
  } catch (error) {
    console.error('Create recording request error:', error);
    return NextResponse.json({ status: 'error', message: 'Failed to submit request' }, { status: 500 });
  }
}
