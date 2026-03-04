import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { query } from '@/lib/db';
import { testConnection, listRecordings } from '@/lib/3cx-client';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'
);

const THREECX_BASE_URL = process.env.THREECX_BASE_URL || 'https://bytesplatform.tx.3cx.us';
const THREECX_CLIENT_ID = process.env.THREECX_CLIENT_ID || 'sales';

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

/**
 * GET /api/hr/audit/test-3cx
 * 
 * Test 3CX API connection using OAuth client credentials flow
 */
export async function GET(request: NextRequest) {
  const authResult = await verifyHRAccess(request);
  if (!authResult.success) {
    return authResult.error;
  }

  const diagnostics: Record<string, any> = {
    timestamp: new Date().toISOString(),
    baseUrl: THREECX_BASE_URL,
    clientId: THREECX_CLIENT_ID,
  };

  // Get client secret (API key) from database
  let clientSecret = '';
  try {
    const tokenResult = await query<{ value: string }>(
      `SELECT value FROM system_settings WHERE key = 'recording_access_token' LIMIT 1`
    );
    clientSecret = tokenResult[0]?.value || '';
    diagnostics.clientSecretConfigured = !!clientSecret;
    diagnostics.clientSecretLength = clientSecret.length;
    diagnostics.clientSecretPreview = clientSecret ? `${clientSecret.substring(0, 8)}...` : 'N/A';
  } catch (err) {
    diagnostics.dbError = String(err);
  }

  if (!clientSecret) {
    return NextResponse.json({
      success: false,
      error: 'No 3CX API Key configured',
      diagnostics,
      help: 'Save your 3CX API Key (client secret) in HR Settings → 3CX Access Token field',
    });
  }

  // Test the connection using OAuth flow
  const connectionResult = await testConnection(clientSecret);
  
  if (!connectionResult.success) {
    return NextResponse.json({
      success: false,
      error: connectionResult.error,
      diagnostics,
      help: 'Make sure your API Key is correct. Go to 3CX Admin → API → Service Principal → Generate API Key',
    });
  }

  // Also try to list recordings to verify full access
  const today = new Date().toISOString().split('T')[0];
  const { recordings, error: recordingsError } = await listRecordings(clientSecret, today, today);

  return NextResponse.json({
    success: true,
    message: '3CX API connection successful!',
    diagnostics: {
      ...diagnostics,
      oauthWorking: true,
      tokenInfo: connectionResult.tokenInfo,
      recordingsAccessible: !recordingsError,
      recordingsCount: recordings.length,
      recordingsError: recordingsError || null,
    },
    help: {
      note: 'The API Key is used as OAuth client_secret to get JWT tokens',
      tokenExpiry: '60 seconds (auto-refreshed)',
    },
  });
}
