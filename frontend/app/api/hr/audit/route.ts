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
 * GET /api/hr/audit?date=YYYY-MM-DD
 * 
 * FETCH ONLY - Returns existing audit data if it exists, otherwise returns auditExists: false
 * Does NOT auto-generate. Use POST /api/hr/audit/generate to create new audits.
 */
export async function GET(request: NextRequest) {
  const authResult = await verifyHRAccess(request);
  if (!authResult.success) {
    return authResult.error;
  }

  try {
    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get('date');

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

    console.log(`[Audit GET] Checking for existing audit: ${dateParam}`);

    // Calculate shift window for display
    const [year, month, day] = dateParam.split('-').map(Number);
    const nextDayDate = new Date(year, month - 1, day + 1);
    const nextDayStr = `${nextDayDate.getFullYear()}-${String(nextDayDate.getMonth() + 1).padStart(2, '0')}-${String(nextDayDate.getDate()).padStart(2, '0')}`;

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
      console.warn('[Audit GET] Could not fetch recording settings:', err);
    }

    // Check for existing audit
    let existingAudit: Array<{
      id: string;
      shift_date: string;
      status: string;
      total_calls: number;
      sample_size: number;
      completed_at: string | null;
      audited_by: number | null;
      auditor_name: string | null;
    }> = [];

    try {
      existingAudit = await query<{
        id: string;
        shift_date: string;
        status: string;
        total_calls: number;
        sample_size: number;
        completed_at: string | null;
        audited_by: number | null;
        auditor_name: string | null;
      }>(`
        SELECT 
          da.id, 
          da.shift_date, 
          da.status, 
          da.total_calls, 
          da.sample_size,
          da.completed_at,
          da.audited_by,
          u.full_name as auditor_name
        FROM daily_audits da
        LEFT JOIN users u ON u.id = da.audited_by
        WHERE da.shift_date = $1
      `, [dateParam]);
    } catch (err) {
      // Table may not exist yet
      console.log('[Audit GET] daily_audits table not found:', err);
      return NextResponse.json({
        success: true,
        auditExists: false,
        date: dateParam,
        shiftStart: `${dateParam} 21:00 PKT`,
        shiftEnd: `${nextDayStr} 05:00 PKT`,
        sample: [],
        message: 'Audit tables not set up. Run the migration first.',
      });
    }

    // No existing audit - return empty state
    if (existingAudit.length === 0) {
      console.log(`[Audit GET] No audit found for ${dateParam}`);
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
        completedAt: null,
        auditedBy: null,
      });
    }

    // Audit exists - fetch and return the items
    const audit = existingAudit[0];
    console.log(`[Audit GET] Found existing audit: ${audit.id}`);

    // Fetch audit items with call details
    const auditItems = await query<{
      audit_item_id: string;
      sample_index: number;
      is_verified: boolean;
      verified_at: string | null;
      rec_id: string | null;
      call_id: number;
      agent_extension: string;
      phone_number: string | null;
      call_time: string;
      call_duration: string;
      agent_name: string | null;
      agent_id: number | null;
    }>(`
      SELECT 
        ai.id as audit_item_id,
        ai.sample_index,
        ai.is_verified,
        ai.verified_at,
        ai.rec_id,
        c.id as call_id,
        c.agent_extension,
        c.phone_number,
        c.call_time,
        c.call_duration,
        u.full_name as agent_name,
        u.id as agent_id
      FROM audit_items ai
      JOIN call_logs c ON c.id = ai.call_log_id
      LEFT JOIN users u ON u.extension_number = c.agent_extension AND u.is_active = true
      WHERE ai.daily_audit_id = $1
      ORDER BY ai.sample_index
    `, [audit.id]);

    console.log(`[Audit GET] Found ${auditItems.length} audit items`);

    // Fetch 3CX recordings to get download URLs
    let threeCXRecordings: ThreeCXRecording[] = [];
    if (auditItems.length > 0 && recordingAccessToken) {
      const callTimes = auditItems.map(item => new Date(item.call_time));
      const minTime = new Date(Math.min(...callTimes.map(d => d.getTime())));
      const maxTime = new Date(Math.max(...callTimes.map(d => d.getTime())));
      
      minTime.setHours(minTime.getHours() - 6);
      maxTime.setHours(maxTime.getHours() + 6);
      
      const startDate = minTime.toISOString().split('T')[0];
      const endDate = maxTime.toISOString().split('T')[0];
      
      const { recordings, error } = await listRecordings(recordingAccessToken, startDate, endDate);
      if (!error) {
        threeCXRecordings = recordings;
        console.log(`[Audit GET] Fetched ${recordings.length} recordings from 3CX`);
      }
    }

    // Build recording map by ID
    const recordingMap = new Map<string, ThreeCXRecording>();
    for (const rec of threeCXRecordings) {
      recordingMap.set(String(rec.Id), rec);
    }

    // Format sample with recording URLs
    const formattedSample = await Promise.all(auditItems.map(async (item) => {
      let recordingUrl: string | null = null;
      let recordingDuration: string | null = null;
      let recordingDurationSeconds: number | null = null;

      if (item.rec_id && recordingAccessToken) {
        recordingUrl = await getRecordingDownloadUrl(Number(item.rec_id), recordingAccessToken);
        
        // Get duration from 3CX recording
        const rec = recordingMap.get(item.rec_id);
        if (rec) {
          const recStart = new Date(rec.StartTime);
          const recEnd = new Date(rec.EndTime);
          const durationSec = Math.round((recEnd.getTime() - recStart.getTime()) / 1000);
          recordingDurationSeconds = durationSec;
          
          const hours = Math.floor(durationSec / 3600);
          const minutes = Math.floor((durationSec % 3600) / 60);
          const seconds = durationSec % 60;
          if (hours > 0) {
            recordingDuration = `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
          } else {
            recordingDuration = `${minutes}:${String(seconds).padStart(2, '0')}`;
          }
        }
      }

      return {
        sampleIndex: item.sample_index,
        callId: item.call_id,
        recId: item.rec_id,
        agentName: item.agent_name || `Unknown (Ext: ${item.agent_extension})`,
        agentExtension: item.agent_extension,
        agentId: item.agent_id,
        callTime: item.call_time,
        callTimeFormatted: new Date(item.call_time).toLocaleString('en-PK', {
          timeZone: 'Asia/Karachi',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        }),
        duration: item.call_duration,
        durationSeconds: parseDurationToSeconds(item.call_duration),
        recordingDuration,
        recordingDurationSeconds,
        customerNumber: item.phone_number || 'N/A',
        recordingUrl,
        hasRecId: !!item.rec_id,
        auditItemId: item.audit_item_id,
        isVerified: item.is_verified,
        verifiedAt: item.verified_at,
      };
    }));

    return NextResponse.json({
      success: true,
      auditExists: true,
      date: dateParam,
      shiftStart: `${dateParam} 21:00 PKT`,
      shiftEnd: `${nextDayStr} 05:00 PKT`,
      totalValidCalls: audit.total_calls,
      sampleSize: audit.sample_size,
      samplingPercentage: 100,
      sample: formattedSample,
      auditId: audit.id,
      auditStatus: audit.status,
      completedAt: audit.completed_at,
      auditedBy: audit.auditor_name,
    });

  } catch (error) {
    console.error('[Audit GET] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch audit data', details: String(error) },
      { status: 500 }
    );
  }
}
