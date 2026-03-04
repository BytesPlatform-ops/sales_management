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

/**
 * Verify JWT and check HR role
 */
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

/**
 * Parse duration string (MM:SS or HH:MM:SS) to seconds
 */
function parseDurationToSeconds(duration: string | null): number {
  if (!duration) return 0;
  
  const parts = duration.split(':').map(Number);
  
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  
  return parseInt(duration, 10) || 0;
}

/**
 * Fisher-Yates shuffle algorithm
 */
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * POST /api/hr/audit/generate
 * 
 * GENERATE NEW AUDIT - Creates a new 15% sample for the specified date.
 * Will FAIL if an audit already exists for that date (no overwriting).
 * 
 * Request Body:
 * - date: YYYY-MM-DD format (required) - The shift date to audit
 */
export async function POST(request: NextRequest) {
  const authResult = await verifyHRAccess(request);
  if (!authResult.success) {
    return authResult.error;
  }

  try {
    const body = await request.json();
    const dateParam = body.date;

    if (!dateParam) {
      return NextResponse.json(
        { error: 'Missing required parameter: date (YYYY-MM-DD)' },
        { status: 400 }
      );
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(dateParam)) {
      return NextResponse.json(
        { error: 'Invalid date format. Use YYYY-MM-DD' },
        { status: 400 }
      );
    }

    console.log(`[Audit GENERATE] Creating audit for: ${dateParam}`);

    // Calculate shift window
    const shiftStartPKT = `${dateParam} 21:00:00`;
    const [year, month, day] = dateParam.split('-').map(Number);
    const nextDayDate = new Date(year, month - 1, day + 1);
    const nextDayStr = `${nextDayDate.getFullYear()}-${String(nextDayDate.getMonth() + 1).padStart(2, '0')}-${String(nextDayDate.getDate()).padStart(2, '0')}`;
    const shiftEndPKT = `${nextDayStr} 05:00:00`;

    // Fetch recording access token
    let recordingAccessToken = '';
    try {
      const settingsResult = await query<{ key: string; value: string }>(
        `SELECT key, value FROM system_settings WHERE key = 'recording_access_token'`
      );
      if (settingsResult.length > 0) {
        recordingAccessToken = settingsResult[0].value || '';
      }
    } catch (err) {
      console.warn('[Audit GENERATE] Could not fetch recording settings:', err);
    }

    // =====================================================
    // CHECK IF AUDIT ALREADY EXISTS - FAIL IF SO
    // =====================================================
    try {
      const existingAudit = await query<{ id: string }>(`
        SELECT id FROM daily_audits WHERE shift_date = $1
      `, [dateParam]);

      if (existingAudit.length > 0) {
        console.log(`[Audit GENERATE] Audit already exists for ${dateParam}`);
        return NextResponse.json(
          { error: 'Audit already exists for this date. Refresh to see existing data.' },
          { status: 409 }
        );
      }
    } catch (err) {
      // Table doesn't exist - will fail later during insert
      console.log('[Audit GENERATE] Could not check existing audit:', err);
      return NextResponse.json(
        { error: 'Audit tables not set up. Please run the database migration first.' },
        { status: 500 }
      );
    }

    // =====================================================
    // FETCH VALID CALLS FOR THE SHIFT
    // =====================================================
    console.log(`[Audit GENERATE] Shift window: ${shiftStartPKT} to ${shiftEndPKT} PKT`);

    const callsResult = await query<{
      id: number;
      agent_extension: string;
      call_duration: string;
      call_time: string;
      phone_number: string | null;
      rec_id: string | null;
      agent_name: string | null;
      agent_id: number | null;
    }>(`
      SELECT 
        c.id,
        c.agent_extension,
        c.call_duration,
        c.call_time,
        c.phone_number,
        c.rec_id,
        u.full_name as agent_name,
        u.id as agent_id
      FROM call_logs c
      LEFT JOIN users u ON u.extension_number = c.agent_extension AND u.is_active = true
      WHERE 
        c.call_time >= $1::timestamp AT TIME ZONE 'Asia/Karachi'
        AND c.call_time < $2::timestamp AT TIME ZONE 'Asia/Karachi'
        AND (
          CASE 
            WHEN c.call_duration LIKE '%:%:%' THEN 
              (SPLIT_PART(c.call_duration, ':', 1)::int * 3600 + 
               SPLIT_PART(c.call_duration, ':', 2)::int * 60 + 
               SPLIT_PART(c.call_duration, ':', 3)::int)
            WHEN c.call_duration LIKE '%:%' THEN 
              (SPLIT_PART(c.call_duration, ':', 1)::int * 60 + 
               SPLIT_PART(c.call_duration, ':', 2)::int)
            ELSE 0
          END
        ) >= 60
      ORDER BY c.call_time ASC
    `, [shiftStartPKT, shiftEndPKT]);

    console.log(`[Audit GENERATE] Found ${callsResult.length} valid calls`);

    const totalValidCalls = callsResult.length;

    if (totalValidCalls === 0) {
      return NextResponse.json({
        success: true,
        auditExists: false,
        date: dateParam,
        shiftStart: `${dateParam} 21:00 PKT`,
        shiftEnd: `${nextDayStr} 05:00 PKT`,
        totalValidCalls: 0,
        sampleSize: 0,
        samplingPercentage: 100,
        sample: [],
        auditId: null,
        auditStatus: null,
        message: 'No eligible calls found for this shift (calls must be >= 1 minute)',
      });
    }

    // =====================================================
    // USE ALL VALID CALLS (>= 1 minute)
    // =====================================================
    const sampleSize = totalValidCalls;
    const selectedSample = callsResult; // Already sorted by call_time ASC

    console.log(`[Audit GENERATE] Including all ${sampleSize} valid calls for audit`);

    // =====================================================
    // PERSIST TO DATABASE
    // =====================================================
    const auditResult = await query<{ id: string }>(`
      INSERT INTO daily_audits (shift_date, status, total_calls, sample_size)
      VALUES ($1, 'pending', $2, $3)
      RETURNING id
    `, [dateParam, totalValidCalls, sampleSize]);

    const auditId = auditResult[0].id;
    console.log(`[Audit GENERATE] Created daily_audit: ${auditId}`);

    // Insert audit items
    const auditItemIds: string[] = [];
    for (let i = 0; i < selectedSample.length; i++) {
      const call = selectedSample[i];
      const itemResult = await query<{ id: string }>(`
        INSERT INTO audit_items (daily_audit_id, call_log_id, sample_index, rec_id)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `, [auditId, call.id, i + 1, call.rec_id || null]);
      auditItemIds.push(itemResult[0].id);
    }
    console.log(`[Audit GENERATE] Inserted ${selectedSample.length} audit items`);

    // =====================================================
    // FETCH 3CX RECORDINGS AND MATCH
    // =====================================================
    let threeCXRecordings: ThreeCXRecording[] = [];
    if (selectedSample.length > 0 && recordingAccessToken) {
      const callTimes = selectedSample.map(c => new Date(c.call_time));
      const minTime = new Date(Math.min(...callTimes.map(d => d.getTime())));
      const maxTime = new Date(Math.max(...callTimes.map(d => d.getTime())));
      
      minTime.setHours(minTime.getHours() - 6);
      maxTime.setHours(maxTime.getHours() + 6);
      
      const startDate = minTime.toISOString().split('T')[0];
      const endDate = maxTime.toISOString().split('T')[0];
      
      const { recordings, error } = await listRecordings(recordingAccessToken, startDate, endDate);
      if (!error) {
        threeCXRecordings = recordings;
        console.log(`[Audit GENERATE] Fetched ${recordings.length} recordings from 3CX`);
      }
    }

    // Match recordings to calls
    const matchRecording = (call: typeof selectedSample[0]): { recording: ThreeCXRecording; durationSec: number } | null => {
      const callPhone = call.phone_number?.replace(/\D/g, '') || '';
      const callTime = new Date(call.call_time);
      
      if (!callPhone) return null;
      
      let bestMatch: ThreeCXRecording | null = null;
      let bestMatchDuration = 0;
      let bestTimeDiff = Infinity;
      
      for (const rec of threeCXRecordings) {
        const recPhone = rec.ToCallerNumber?.replace(/\D/g, '') || '';
        if (recPhone !== callPhone) continue;
        
        const recExt = rec.FromDn?.replace(/^0+/, '') || '';
        const callExt = call.agent_extension?.replace(/^0+/, '') || '';
        if (recExt !== callExt) continue;
        
        const recStart = new Date(rec.StartTime);
        const recEnd = new Date(rec.EndTime);
        const recDurationSec = Math.round((recEnd.getTime() - recStart.getTime()) / 1000);
        
        if (recDurationSec < 60) continue;
        
        const timeDiff = Math.abs(recStart.getTime() - callTime.getTime());
        
        if (timeDiff < bestTimeDiff) {
          bestTimeDiff = timeDiff;
          bestMatch = rec;
          bestMatchDuration = recDurationSec;
        }
      }
      
      if (bestMatch && bestTimeDiff <= 24 * 60 * 60 * 1000) {
        return { recording: bestMatch, durationSec: bestMatchDuration };
      }
      
      return null;
    };

    // Format sample and update rec_ids
    const formattedSample = await Promise.all(selectedSample.map(async (call, index) => {
      let recordingUrl: string | null = null;
      let recId = call.rec_id;
      let recordingDuration: string | null = null;
      let recordingDurationSeconds: number | null = null;
      const auditItemId = auditItemIds[index];

      // Try to match recording from 3CX
      const matchResult = matchRecording(call);
      if (matchResult) {
        recId = String(matchResult.recording.Id);
        recordingDurationSeconds = matchResult.durationSec;
        
        const hours = Math.floor(matchResult.durationSec / 3600);
        const minutes = Math.floor((matchResult.durationSec % 3600) / 60);
        const seconds = matchResult.durationSec % 60;
        if (hours > 0) {
          recordingDuration = `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        } else {
          recordingDuration = `${minutes}:${String(seconds).padStart(2, '0')}`;
        }

        // Update audit_item with rec_id
        try {
          await query(`UPDATE audit_items SET rec_id = $1 WHERE id = $2`, [recId, auditItemId]);
        } catch { /* ignore */ }
        
        // Update call_logs
        try {
          await query(`UPDATE call_logs SET rec_id = $1 WHERE id = $2`, [recId, call.id]);
        } catch { /* ignore */ }
      }

      // Get download URL
      if (recId && recordingAccessToken) {
        recordingUrl = await getRecordingDownloadUrl(Number(recId), recordingAccessToken);
      }

      return {
        sampleIndex: index + 1,
        callId: call.id,
        recId,
        agentName: call.agent_name || `Unknown (Ext: ${call.agent_extension})`,
        agentExtension: call.agent_extension,
        agentId: call.agent_id,
        callTime: call.call_time,
        callTimeFormatted: new Date(call.call_time).toLocaleString('en-PK', {
          timeZone: 'Asia/Karachi',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        }),
        duration: call.call_duration,
        durationSeconds: parseDurationToSeconds(call.call_duration),
        recordingDuration,
        recordingDurationSeconds,
        customerNumber: call.phone_number || 'N/A',
        recordingUrl,
        hasRecId: !!recId,
        auditItemId,
        isVerified: false,
        verifiedAt: null,
      };
    }));

    return NextResponse.json({
      success: true,
      auditExists: true,
      date: dateParam,
      shiftStart: `${dateParam} 21:00 PKT`,
      shiftEnd: `${nextDayStr} 05:00 PKT`,
      totalValidCalls,
      sampleSize,
      samplingPercentage: 100,
      sample: formattedSample,
      auditId,
      auditStatus: 'pending',
      completedAt: null,
      auditedBy: null,
    });

  } catch (error) {
    console.error('[Audit GENERATE] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to generate audit', details: String(error) },
      { status: 500 }
    );
  }
}
