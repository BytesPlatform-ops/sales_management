import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { query } from '@/lib/db';
import { listRecordings, getRecordingDownloadUrl, ThreeCXRecording } from '@/lib/3cx-client';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'
);

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
    const { payload } = await jwtVerify(token, JWT_SECRET);
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
export async function GET(request: NextRequest) {
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
        downloadUrl: await getRecordingDownloadUrl(rec.Id, clientSecret),
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
function matchRecordingToCall(
  recordings: ThreeCXRecording[],
  callExtension: string,
  callTime: Date
): ThreeCXRecording | null {
  for (const rec of recordings) {
    if (rec.Dn !== callExtension) continue;
    const recTime = new Date(rec.StartTime);
    const timeDiff = Math.abs(callTime.getTime() - recTime.getTime());
    if (timeDiff < 2 * 60 * 1000) return rec; // Within 2 minutes
  }
  return null;
}

/**
 * POST /api/hr/audit/recordings
 * 
 * Match 3CX recordings to specific call IDs from our database
 */
export async function POST(request: NextRequest) {
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
      call_time: string;
      rec_id: string | null;
    }>(`
      SELECT id, agent_extension, call_time, rec_id
      FROM call_logs
      WHERE id = ANY($1)
    `, [callIds]);

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

    // Match recordings to calls
    const matches: { callId: number; recId: number }[] = [];
    
    for (const call of callsNeedingRecordings) {
      const matched = matchRecordingToCall(recordings, call.agent_extension, new Date(call.call_time));
      if (matched) {
        matches.push({ callId: call.id, recId: matched.Id });
        // Cache in database
        await query(`UPDATE call_logs SET rec_id = $1 WHERE id = $2`, [String(matched.Id), call.id]);
      }
    }

    return NextResponse.json({
      success: true,
      matched: matches.length,
      total: callsNeedingRecordings.length,
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
