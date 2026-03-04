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
let cachedToken: { token: string; expiresAt: number } | null = null;

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
  if (cachedToken && Date.now() < cachedToken.expiresAt - 10000) {
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
      const errorText = await response.text();
      return { 
        error: `3CX API error: ${response.status} - ${errorText.substring(0, 200)}`,
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
  // Build OData filter
  const filter = `$filter=StartTime ge ${startDate}T00:00:00Z and StartTime lt ${endDate}T23:59:59Z&$orderby=StartTime desc&$top=500`;
  const endpoint = `/xapi/v1/Recordings?${filter}`;

  const result = await makeThreeCXRequest(endpoint, clientSecret);

  if (result.error) {
    return { recordings: [], error: result.error };
  }

  // 3CX returns data in .value array for OData
  const recordings: ThreeCXRecording[] = result.data?.value || result.data || [];
  return { recordings };
}

/**
 * Get download URL for a recording
 * NOTE: For downloads, we need a fresh JWT token since they expire in 60s
 * The clientSecret is the API key from 3CX Admin
 */
export async function getRecordingDownloadUrl(recId: number, clientSecret: string): Promise<string> {
  // Get a fresh JWT token for the download
  const { token, error } = await getOAuthToken(clientSecret);
  
  if (error || !token) {
    console.error('[3CX] Failed to get token for download URL:', error);
    // Return URL without token - will fail but at least show the issue
    return `${THREECX_BASE_URL}/xapi/v1/Recordings/Pbx.DownloadRecording(recId=${recId})`;
  }
  
  return `${THREECX_BASE_URL}/xapi/v1/Recordings/Pbx.DownloadRecording(recId=${recId})?access_token=${token}`;
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
