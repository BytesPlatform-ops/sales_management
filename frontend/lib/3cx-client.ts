/**
 * 3CX API Client
 * 
 * Handles authentication and API calls to 3CX v20 REST API
 * 
 * 3CX v20 Authentication:
 * - OAuth 2.0 with client credentials flow
 * - Service Principal: client_id + client_secret (API Key)
 * - Returns JWT access token valid for 60 seconds
 * 
 * Documentation: https://www.3cx.com/docs/api/
 */

const THREECX_BASE_URL = process.env.THREECX_BASE_URL || 'https://bytesplatform.tx.3cx.us';
const THREECX_CLIENT_ID = process.env.THREECX_CLIENT_ID || 'sales';

// Cache for JWT token
let cachedToken: { token: string; expiresAt: number; secret: string } | null = null;

interface ThreeCXTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string | null;
}

interface ThreeCXRecording {
  Id: number;
  RecordingUrl: string;       // Relative path to recording file
  StartTime: string;          // ISO timestamp
  EndTime: string;            // ISO timestamp
  CanBeTranscribed?: boolean;
  IsTranscribed?: boolean;
  TranscriptionResult?: number;
  IsArchived: boolean;
  CallType: string;           // "OutboundExternal", "InboundExternal", etc.
  // From party info
  FromIdParticipant: number;
  FromDnType: number;
  FromDn: string;             // Agent extension number (e.g., "17")
  FromCallerNumber: string;   // Agent calling from
  FromDisplayName: string;    // Agent display name
  FromDidNumber: string;
  // To party info
  ToDnType: number;
  ToDn: string;               // Destination extension or trunk
  ToCallerNumber: string;     // Customer phone number
  ToDisplayName: string;      // Customer display name
  ToDidNumber: string;
}

/**
 * Get OAuth JWT token from 3CX using client credentials
 * The API Key from 3CX Admin is the client_secret
 */
async function getOAuthToken(clientSecret: string): Promise<{ token?: string; error?: string }> {
  // Check cache first (with 10 second buffer)
  if (cachedToken && cachedToken.secret === clientSecret && Date.now() < cachedToken.expiresAt - 10000) {
    console.log('[3CX OAuth] Using cached token');
    return { token: cachedToken.token };
  }

  console.log('[3CX OAuth] Fetching new token...');
  
  try {
    const response = await fetch(`${THREECX_BASE_URL}/connect/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: THREECX_CLIENT_ID,
        client_secret: clientSecret,
      }),
      cache: 'no-store',
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[3CX OAuth] Token request failed:', response.status, errorText);
      return { error: `OAuth token request failed: ${response.status} - ${errorText}` };
    }

    const data: ThreeCXTokenResponse = await response.json();
    
    // Cache the token
    cachedToken = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in * 1000),
      secret: clientSecret,
    };
    
    console.log(`[3CX OAuth] Got token, expires in ${data.expires_in}s`);
    return { token: data.access_token };
  } catch (err: any) {
    console.error('[3CX OAuth] Error:', err);
    return { error: `OAuth error: ${err.message}` };
  }
}

/**
 * Make authenticated request to 3CX API
 */
async function makeThreeCXRequest(
  endpoint: string,
  clientSecret: string,
  method: 'GET' | 'POST' = 'GET',
  body?: any
): Promise<{ data?: any; error?: string; status?: number }> {
  // Get JWT token via OAuth
  const { token, error } = await getOAuthToken(clientSecret);
  
  if (error || !token) {
    return { error: error || 'Failed to get OAuth token', status: 401 };
  }

  const url = `${THREECX_BASE_URL}${endpoint}`;
  console.log(`[3CX API] ${method} ${endpoint}`);

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });

    console.log(`[3CX API] Response: ${response.status}`);

    if (!response.ok) {
      const errorText = (await response.text()) || response.headers.get('www-authenticate') || '';
      return {
        error: response.status === 401 || response.status === 403
          ? `3CX API error: ${response.status} - token issued but rejected by XAPI (${errorText.substring(0, 200) || 'no reason given'}). Check "3CX Configuration API Access" and the API client's role in 3CX Admin → Integrations → API.`
          : `3CX API error: ${response.status} - ${errorText.substring(0, 200)}`,
        status: response.status 
      };
    }

    const data = await response.json();
    return { data, status: response.status };

  } catch (err: any) {
    console.error('[3CX API] Error:', err);
    return { error: `Network error: ${err.message}`, status: 0 };
  }
}

/**
 * List recordings from 3CX
 */
export async function listRecordings(
  clientSecret: string,
  startDate: string,
  endDate: string
): Promise<{ recordings: ThreeCXRecording[]; error?: string }> {
  // 3CX produces ~400 recordings/day, so a single $top=500 page silently drops
  // most of a multi-day window. Page through with $skip until exhausted.
  const PAGE_SIZE = 500;
  const MAX_PAGES = 20;
  const recordings: ThreeCXRecording[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const filter = `$filter=StartTime ge ${startDate}T00:00:00Z and StartTime lt ${endDate}T23:59:59Z&$orderby=StartTime desc&$top=${PAGE_SIZE}&$skip=${page * PAGE_SIZE}`;
    const result = await makeThreeCXRequest(`/xapi/v1/Recordings?${filter}`, clientSecret);

    if (result.error) {
      return { recordings: [], error: result.error };
    }

    // 3CX returns data in .value array for OData
    const batch: ThreeCXRecording[] = result.data?.value || result.data || [];
    recordings.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }

  return { recordings };
}

export interface MatchOptions {
  /** Recordings shorter than this are broken fragments (3CX recordings run a few
   *  seconds shorter than the logged call, so a 1:02 call can have a 58s one). */
  minSeconds: number;
  /** call_time and the recording's EndTime agree to within seconds; a wider window
   *  lets a call with no recording borrow a neighbour's (same number, same agent). */
  windowMs: number;
}

export const DEFAULT_MATCH_OPTIONS: MatchOptions = { minSeconds: 20, windowMs: 10 * 60 * 1000 };

const last10 = (s: string | null | undefined) => (s || '').replace(/\D/g, '').slice(-10);
const normExt = (s: string | null | undefined) => (s || '').replace(/^0+/, '');

export function recordingDurationSec(rec: ThreeCXRecording): number {
  return Math.round((new Date(rec.EndTime).getTime() - new Date(rec.StartTime).getTime()) / 1000);
}

/** True when the recording is a leg between this agent and this customer number,
 *  outbound (agent → customer) or inbound (customer → agent). */
export function recordingInvolves(rec: ThreeCXRecording, phone: string | null, agentExtension: string | null): boolean {
  const p = last10(phone);
  const ext = normExt(agentExtension);
  if (!p || !ext) return false;
  return (normExt(rec.FromDn) === ext && last10(rec.ToCallerNumber) === p)
    || (normExt(rec.ToDn) === ext && last10(rec.FromCallerNumber) === p);
}

export interface CallForMatching {
  id: number | string;
  phone_number: string | null;
  agent_extension: string | null;
  call_time: string | Date;
}

/**
 * Pair calls with recordings one-to-one. The same customer is often dialled again
 * within minutes, so matching each call on its own lets a call with no recording
 * borrow its neighbour's. Here every (call, recording) pair within the window is
 * ranked by how closely call end and recording end agree, and each recording and
 * each call is used at most once. Pass every logged call for the numbers involved
 * (not just the ones you display) so neighbours can claim their own recordings.
 */
export function assignRecordingsToCalls(
  recordings: ThreeCXRecording[],
  calls: CallForMatching[],
  opts: MatchOptions = DEFAULT_MATCH_OPTIONS
): Map<string, { recording: ThreeCXRecording; durationSec: number }> {
  const pairs: { callId: string; recording: ThreeCXRecording; durationSec: number; diff: number }[] = [];
  for (const call of calls) {
    const callEnd = new Date(call.call_time).getTime();
    for (const rec of recordings) {
      if (!recordingInvolves(rec, call.phone_number, call.agent_extension)) continue;
      const durationSec = recordingDurationSec(rec);
      if (durationSec < opts.minSeconds) continue;
      const diff = Math.abs(new Date(rec.EndTime).getTime() - callEnd);
      if (diff <= opts.windowMs) pairs.push({ callId: String(call.id), recording: rec, durationSec, diff });
    }
  }
  pairs.sort((a, b) => a.diff - b.diff);

  const result = new Map<string, { recording: ThreeCXRecording; durationSec: number }>();
  const usedRecordings = new Set<number>();
  for (const p of pairs) {
    if (result.has(p.callId) || usedRecordings.has(p.recording.Id)) continue;
    result.set(p.callId, { recording: p.recording, durationSec: p.durationSec });
    usedRecordings.add(p.recording.Id);
  }
  return result;
}

/** Latest recording for a phone number (any agent), for requests not tied to a call. */
export function latestRecordingForPhone(recordings: ThreeCXRecording[], phone: string, minSeconds: number): ThreeCXRecording | undefined {
  const p = last10(phone);
  return recordings
    .filter(r => (last10(r.ToCallerNumber) === p || last10(r.FromCallerNumber) === p) && recordingDurationSec(r) >= minSeconds)
    .sort((a, b) => new Date(b.StartTime).getTime() - new Date(a.StartTime).getTime())[0];
}

/** Recordings to or from a phone number between two ISO instants (for HR's manual lookup). */
export async function searchRecordingsByPhone(
  clientSecret: string,
  phone: string,
  fromIso: string,
  toIso: string
): Promise<{ recordings: ThreeCXRecording[]; error?: string }> {
  const p = last10(phone);
  if (p.length < 7) return { recordings: [], error: 'Invalid phone number' };
  const filter = `(contains(ToCallerNumber,'${p}') or contains(FromCallerNumber,'${p}')) and StartTime ge ${fromIso} and StartTime lt ${toIso}`;
  const result = await makeThreeCXRequest(`/xapi/v1/Recordings?$filter=${encodeURIComponent(filter)}&$orderby=StartTime desc&$top=100`, clientSecret);
  if (result.error) return { recordings: [], error: result.error };
  return { recordings: result.data?.value || [] };
}

/** One recording by id, or null if 3CX no longer has it. */
export async function getRecordingById(clientSecret: string, recId: number): Promise<{ recording: ThreeCXRecording | null; error?: string }> {
  const result = await makeThreeCXRequest(`/xapi/v1/Recordings?$filter=Id eq ${Number(recId)}&$top=1`, clientSecret);
  if (result.error) return { recording: null, error: result.error };
  return { recording: (result.data?.value || [])[0] || null };
}

/**
 * Stream a recording's audio from 3CX server-side, so the 3CX admin token never
 * reaches the browser. Forwards Range so audio players can seek.
 */
export async function fetchRecordingAudio(clientSecret: string, recId: number, range?: string | null): Promise<Response | { error: string }> {
  const { token, error } = await getOAuthToken(clientSecret);
  if (error || !token) return { error: error || 'Failed to get OAuth token' };
  return fetch(`${THREECX_BASE_URL}/xapi/v1/Recordings/Pbx.DownloadRecording(recId=${Number(recId)})`, {
    headers: { Authorization: `Bearer ${token}`, ...(range ? { Range: range } : {}) },
    cache: 'no-store',
  });
}

/**
 * Check if 3CX API is accessible
 */
export async function testConnection(clientSecret: string): Promise<{ success: boolean; error?: string; message?: string; tokenInfo?: any }> {
  // First test OAuth token exchange
  const { token, error } = await getOAuthToken(clientSecret);
  
  if (error || !token) {
    return { success: false, error: error || 'Failed to get OAuth token' };
  }

  // Try to access a simple endpoint
  const result = await makeThreeCXRequest('/xapi/v1/SystemStatus', clientSecret);
  
  if (result.error) {
    return { success: false, error: result.error };
  }

  return { 
    success: true, 
    message: '3CX API connection successful',
    tokenInfo: {
      tokenLength: token.length,
      preview: `${token.substring(0, 20)}...`,
    }
  };
}

export type { ThreeCXRecording };
