import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { listRecordings, ThreeCXRecording } from '@/lib/3cx-client';
import { assignForCalls } from '@/lib/recording-lookup';
import { getRecordingSettings } from '@/lib/recording-settings';
import { recordingPlayUrl } from '@/lib/recording-links';
import { legacyAuth, withAuth } from '@/lib/auth/session';

interface JwtPayload {
  userId: number;
  username: string;
  role: string;
}

async function verifyHRAccess(request: NextRequest): Promise<{ success: true; payload: JwtPayload } | { success: false; error: NextResponse }> {
  const authHeader = request.headers.get('Authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      success: false,
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  try {
    const token = authHeader.split(' ')[1];
    const { payload } = await legacyAuth(request);
    const jwtPayload = payload as unknown as JwtPayload;

    if (jwtPayload.role !== 'hr') {
      return {
        success: false,
        error: NextResponse.json({ error: 'Forbidden - HR access required' }, { status: 403 }),
      };
    }

    return { success: true, payload: jwtPayload };
  } catch {
    return {
      success: false,
      error: NextResponse.json({ error: 'Invalid token' }, { status: 401 }),
    };
  }
}

async function getClientSecret(): Promise<string> {
  const tokenResult = await query<{ value: string }>(
    `SELECT value FROM system_settings WHERE key = 'recording_access_token' LIMIT 1`
  );
  return tokenResult[0]?.value || '';
}

/**
 * GET /api/hr/audit/recordings
 * 
 * Fetch recordings from 3CX API for a date range
 */
async function GET__handler(request: NextRequest) {
  const authResult = await verifyHRAccess(request);
  if (!authResult.success) {
    return authResult.error;
  }

  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: 'Missing required parameters: startDate, endDate' },
        { status: 400 }
      );
    }

    const clientSecret = await getClientSecret();
    if (!clientSecret) {
      return NextResponse.json(
        { error: 'No 3CX API Key configured. Go to HR Settings to add it.' },
        { status: 400 }
      );
    }

    const { recordings, error } = await listRecordings(clientSecret, startDate, endDate);
    
    if (error) {
      return NextResponse.json({ success: false, error }, { status: 400 });
    }

    // Build download URLs for each recording
    const recordingsWithUrls = await Promise.all(
      recordings.map(async (rec) => ({
        recId: rec.Id,
        extension: rec.FromDn,
        fromNumber: rec.FromCallerNumber,
        toNumber: rec.ToCallerNumber,
        fromName: rec.FromDisplayName,
        toName: rec.ToDisplayName,
        callType: rec.CallType,
        startTime: rec.StartTime,
        endTime: rec.EndTime,
        downloadUrl: await recordingPlayUrl(rec.Id),
      }))
    );

    return NextResponse.json({
      success: true,
      recordings: recordingsWithUrls,
      count: recordings.length,
      dateRange: { startDate, endDate },
    });

  } catch (error) {
    console.error('Error in GET /api/hr/audit/recordings:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error', details: String(error) },
      { status: 500 }
    );
  }
}

/**
 * Match recordings to calls by extension and timestamp
 */
/**
 * POST /api/hr/audit/recordings
 * 
 * Match 3CX recordings to specific call IDs from our database
 */
async function POST__handler(request: NextRequest) {
  const authResult = await verifyHRAccess(request);
  if (!authResult.success) {
    return authResult.error;
  }

  try {
    const body = await request.json();
    const { callIds } = body;

    if (!callIds || !Array.isArray(callIds) || callIds.length === 0) {
      return NextResponse.json(
        { error: 'Missing or invalid callIds array' },
        { status: 400 }
      );
    }

    const clientSecret = await getClientSecret();
    if (!clientSecret) {
      return NextResponse.json(
        { error: 'No 3CX API Key configured' },
        { status: 400 }
      );
    }

    // Fetch the calls we need to match
    const calls = await query<{
      id: number;
      agent_extension: string;
      phone_number: string | null;
      call_time: string;
      rec_id: string | null;
    }>(`
      SELECT id, agent_extension, phone_number, call_time, rec_id
      FROM call_logs
      WHERE id = ANY($1)
    `, [callIds]);

    // The audit page reads audit_items.rec_id, so copy over any recording a call
    // already has (e.g. matched by a recording request) before matching the rest.
    const syncAuditItems = () => query(`
      UPDATE audit_items ai SET rec_id = cl.rec_id
      FROM call_logs cl
      WHERE ai.call_log_id = cl.id AND cl.id = ANY($1)
        AND cl.rec_id IS NOT NULL AND ai.rec_id IS NULL
    `, [callIds]);
    await syncAuditItems();

    if (calls.length === 0) {
      return NextResponse.json({ error: 'No calls found' }, { status: 404 });
    }

    // Skip calls that already have rec_id
    const callsNeedingRecordings = calls.filter(c => !c.rec_id);
    
    if (callsNeedingRecordings.length === 0) {
      return NextResponse.json({
        success: true,
        matched: calls.length,
        total: calls.length,
        alreadyCached: true,
      });
    }

    // Get date range from calls
    const callTimes = callsNeedingRecordings.map(c => new Date(c.call_time));
    const minDate = new Date(Math.min(...callTimes.map(d => d.getTime())));
    const maxDate = new Date(Math.max(...callTimes.map(d => d.getTime())));
    minDate.setHours(minDate.getHours() - 6);
    maxDate.setHours(maxDate.getHours() + 6);

    const startDate = minDate.toISOString().split('T')[0];
    const endDate = maxDate.toISOString().split('T')[0];

    // Fetch recordings from 3CX
    const { recordings, error } = await listRecordings(clientSecret, startDate, endDate);
    
    if (error) {
      return NextResponse.json({ success: false, error }, { status: 400 });
    }

    // Match recordings to calls (rules from HR settings)
    const settings = await getRecordingSettings();
    const matchOpts = { minSeconds: settings.recordingMinSeconds, windowMs: settings.matchWindowMinutes * 60 * 1000 };
    const matches: { callId: number; recId: number }[] = [];
    
    const assigned = await assignForCalls(callsNeedingRecordings, recordings, matchOpts);
    for (const call of callsNeedingRecordings) {
      const matched = assigned.get(String(call.id));
      if (matched) {
        matches.push({ callId: call.id, recId: matched.recording.Id });
        // Cache in database
        await query(`UPDATE call_logs SET rec_id = $1 WHERE id = $2`, [String(matched.recording.Id), call.id]);
      }
    }
    await syncAuditItems();

    return NextResponse.json({
      success: true,
      matched: calls.length - callsNeedingRecordings.length + matches.length, // incl. already-cached, so the page refreshes
      total: calls.length,
      totalRecordingsFrom3CX: recordings.length,
      matches,
    });

  } catch (error) {
    console.error('Error in POST /api/hr/audit/recordings:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error', details: String(error) },
      { status: 500 }
    );
  }
}

export const GET = withAuth(GET__handler);
export const POST = withAuth(POST__handler);
