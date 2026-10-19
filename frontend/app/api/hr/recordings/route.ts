import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { query, queryOne } from '@/lib/db';
import { searchRecordingsByPhone, getRecordingById, recordingDurationSec } from '@/lib/3cx-client';
import { findRecordingForRequest, getClientSecret } from '@/lib/recording-lookup';
import { recordingPlayUrl } from '@/lib/recording-links';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'
);

interface JwtPayload {
  userId: number;
  username: string;
  role: string;
}

export const dynamic = 'force-dynamic';

const STATUSES = ['pending', 'approved', 'rejected'];

async function verifyHR(request: NextRequest): Promise<JwtPayload | NextResponse> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ status: 'error', message: 'No token' }, { status: 401 });
  }
  try {
    const { payload } = await jwtVerify(authHeader.split(' ')[1], JWT_SECRET);
    const jwt = payload as unknown as JwtPayload;
    if (jwt.role !== 'hr') {
      return NextResponse.json({ status: 'error', message: 'HR only' }, { status: 403 });
    }
    return jwt;
  } catch {
    return NextResponse.json({ status: 'error', message: 'Invalid token' }, { status: 401 });
  }
}

/**
 * GET /api/hr/recordings?status=pending|approved|rejected|all|missing
 * "missing" = approved but no recording linked yet.
 */
export async function GET(request: NextRequest) {
  const jwt = await verifyHR(request);
  if (jwt instanceof NextResponse) return jwt;

  try {
    const status = request.nextUrl.searchParams.get('status') || 'all';
    const params: any[] = [];
    let where = '';
    if (status === 'missing') {
      where = `WHERE rr.status = 'approved' AND rr.rec_id IS NULL`;
    } else if (STATUSES.includes(status)) {
      params.push(status);
      where = `WHERE rr.status = $1`;
    }

    const rows = await query<any>(
      `SELECT rr.id, rr.agent_id, rr.phone_number, rr.call_log_id, rr.rec_id, rr.status, rr.notes,
              rr.hr_notes, rr.created_at, rr.updated_at,
              u.username as agent_name, u.full_name as agent_full_name, u.extension_number as agent_extension,
              u2.username as approved_by_name,
              cl.call_time, cl.call_duration
       FROM recording_requests rr
       JOIN users u ON u.id = rr.agent_id
       LEFT JOIN users u2 ON u2.id = rr.approved_by
       LEFT JOIN call_logs cl ON cl.id = rr.call_log_id
       ${where}
       ORDER BY CASE rr.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, rr.created_at DESC
       LIMIT 200`,
      params
    );

    const data = await Promise.all(rows.map(async r => ({
      ...r,
      play_url: r.rec_id ? await recordingPlayUrl(r.rec_id) : null,
    })));

    return NextResponse.json({ status: 'success', data });
  } catch (error) {
    console.error('HR get recording requests error:', error);
    return NextResponse.json({ status: 'error', message: 'Failed to fetch requests' }, { status: 500 });
  }
}

async function saveRecording(requestId: number, recId: string | null) {
  // recording_url is no longer stored: links are minted per view (see /api/recordings/play).
  await query(
    `UPDATE recording_requests SET rec_id = $1, recording_url = NULL, updated_at = NOW() WHERE id = $2`,
    [recId, requestId]
  );
}

function lookupMessage(prefix: string, recId: string | null, error?: string) {
  if (recId) return `${prefix} — recording found`;
  if (error) return `${prefix} — could not reach 3CX (${error.slice(0, 120)}). Use Retry later.`;
  return `${prefix} — recording not found in 3CX. Use "Find recording" to pick it manually.`;
}

/**
 * POST /api/hr/recordings
 * Body: { action, request_id?, hr_notes?, rec_id? }
 *   approve | reject            — decide a request (approve also looks the recording up)
 *   retry                       — look the recording up again for one request
 *   retry_all                   — retry every approved request still missing a recording (last 45 days)
 *   candidates                  — list 3CX recordings for the request's number around the call
 *   link { rec_id }             — attach a recording HR picked (also approves a pending request)
 *   unlink                      — remove a wrongly attached recording
 */
export async function POST(request: NextRequest) {
  const jwt = await verifyHR(request);
  if (jwt instanceof NextResponse) return jwt;

  try {
    const body = await request.json();
    const { action, hr_notes } = body;
    const requestId = Number(body.request_id);

    if (action === 'retry_all') {
      const clientSecret = await getClientSecret();
      if (!clientSecret) return NextResponse.json({ status: 'error', message: '3CX API key not configured' }, { status: 400 });
      const missing = await query<any>(
        `SELECT id, phone_number, call_log_id FROM recording_requests
         WHERE status = 'approved' AND rec_id IS NULL AND created_at > NOW() - INTERVAL '45 days'
         ORDER BY created_at DESC LIMIT 60`
      );
      let found = 0, failed = 0;
      for (const rr of missing) {
        const { recId, error } = await findRecordingForRequest(rr, clientSecret);
        if (error) { failed++; continue; }
        if (recId) { found++; await saveRecording(rr.id, recId); }
      }
      return NextResponse.json({
        status: 'success',
        message: `Checked ${missing.length}: ${found} found${failed ? `, ${failed} could not reach 3CX` : ''}, ${missing.length - found - failed} still not in 3CX`,
        data: { checked: missing.length, found, failed },
      });
    }

    if (!requestId) {
      return NextResponse.json({ status: 'error', message: 'request_id required' }, { status: 400 });
    }
    const rr = await queryOne<any>(
      `SELECT rr.*, cl.call_time FROM recording_requests rr LEFT JOIN call_logs cl ON cl.id = rr.call_log_id WHERE rr.id = $1`,
      [requestId]
    );
    if (!rr) {
      return NextResponse.json({ status: 'error', message: 'Request not found' }, { status: 404 });
    }

    if (action === 'reject') {
      await query(
        `UPDATE recording_requests SET status = 'rejected', approved_by = $1, hr_notes = $2, updated_at = NOW() WHERE id = $3`,
        [Number(jwt.userId), hr_notes || null, requestId]
      );
      return NextResponse.json({ status: 'success', message: 'Request rejected' });
    }

    if (action === 'unlink') {
      await saveRecording(requestId, null);
      return NextResponse.json({ status: 'success', message: 'Recording removed from this request' });
    }

    const clientSecret = await getClientSecret();
    if (!clientSecret) {
      return NextResponse.json({ status: 'error', message: '3CX API key not configured' }, { status: 400 });
    }

    if (action === 'approve' || action === 'retry') {
      if (action === 'approve') {
        await query(
          `UPDATE recording_requests SET status = 'approved', approved_by = $1, hr_notes = $2, updated_at = NOW() WHERE id = $3`,
          [Number(jwt.userId), hr_notes || null, requestId]
        );
      }
      const { recId, error } = await findRecordingForRequest(rr, clientSecret);
      if (!error) await saveRecording(requestId, recId);
      return NextResponse.json({
        status: 'success',
        message: lookupMessage(action === 'approve' ? 'Approved' : 'Checked again', recId, error),
        data: { rec_id: recId, has_recording: !!recId, error: error || null },
      });
    }

    if (action === 'candidates') {
      const around = new Date(rr.call_time || rr.created_at).getTime();
      const { recordings, error } = await searchRecordingsByPhone(
        clientSecret, rr.phone_number,
        new Date(around - 2 * 24 * 3600 * 1000).toISOString(),
        new Date(around + 2 * 24 * 3600 * 1000).toISOString()
      );
      if (error) return NextResponse.json({ status: 'error', message: `3CX error: ${error.slice(0, 160)}` }, { status: 502 });
      const data = await Promise.all(recordings.map(async r => ({
        rec_id: String(r.Id),
        start_time: r.StartTime,
        end_time: r.EndTime,
        duration_sec: recordingDurationSec(r),
        from: r.FromDn || r.FromCallerNumber,
        to: r.ToCallerNumber || r.ToDn,
        from_name: r.FromDisplayName,
        call_type: r.CallType,
        minutes_from_call: rr.call_time ? Math.round((new Date(r.EndTime).getTime() - around) / 60000) : null,
        play_url: await recordingPlayUrl(r.Id),
      })));
      return NextResponse.json({ status: 'success', data, call_time: rr.call_time || null });
    }

    if (action === 'link') {
      const recIdNum = Number(String(body.rec_id || '').trim());
      if (!Number.isInteger(recIdNum) || recIdNum <= 0) {
        return NextResponse.json({ status: 'error', message: 'Enter a valid 3CX recording ID' }, { status: 400 });
      }
      const { recording, error } = await getRecordingById(clientSecret, recIdNum);
      if (error) return NextResponse.json({ status: 'error', message: `3CX error: ${error.slice(0, 160)}` }, { status: 502 });
      if (!recording) return NextResponse.json({ status: 'error', message: `Recording ${recIdNum} not found in 3CX` }, { status: 404 });
      await saveRecording(requestId, String(recIdNum));
      if (rr.status === 'pending') {
        await query(
          `UPDATE recording_requests SET status = 'approved', approved_by = $1, hr_notes = COALESCE($2, hr_notes), updated_at = NOW() WHERE id = $3`,
          [Number(jwt.userId), hr_notes || null, requestId]
        );
      }
      return NextResponse.json({ status: 'success', message: `Recording ${recIdNum} linked`, data: { rec_id: String(recIdNum) } });
    }

    return NextResponse.json({ status: 'error', message: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('HR recording action error:', error);
    return NextResponse.json({ status: 'error', message: 'Failed to process request' }, { status: 500 });
  }
}
