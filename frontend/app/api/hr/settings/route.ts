import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { query, queryOne } from '@/lib/db';

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
 * GET /api/hr/settings
 * Get system settings for HR configuration
 */
export async function GET(request: NextRequest) {
  const authResult = await verifyHRAccess(request);
  if (!authResult.success) {
    return authResult.error;
  }

  try {
    const settings = await query<{ key: string; value: string; description: string | null }>(
      `SELECT key, value, description FROM system_settings ORDER BY key`
    );

    return NextResponse.json({
      success: true,
      settings: settings.reduce((acc, s) => {
        acc[s.key] = { value: s.value, description: s.description };
        return acc;
      }, {} as Record<string, { value: string; description: string | null }>),
    });
  } catch (error) {
    console.error('Error fetching settings:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch settings' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/hr/settings
 * Update a system setting
 * Body: { key: string, value: string }
 */
export async function PUT(request: NextRequest) {
  const authResult = await verifyHRAccess(request);
  if (!authResult.success) {
    return authResult.error;
  }

  try {
    const body = await request.json();
    const { key, value } = body;

    if (!key || typeof key !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Missing or invalid key' },
        { status: 400 }
      );
    }

    if (typeof value !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Value must be a string' },
        { status: 400 }
      );
    }

    // Only allow updating specific settings for security
    const allowedKeys = ['recording_base_url', 'recording_access_token'];
    if (!allowedKeys.includes(key)) {
      return NextResponse.json(
        { success: false, error: `Setting '${key}' cannot be modified` },
        { status: 403 }
      );
    }

    // Update or insert the setting
    await query(
      `INSERT INTO system_settings (key, value, updated_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (key) DO UPDATE SET 
         value = $2,
         updated_at = CURRENT_TIMESTAMP`,
      [key, value]
    );

    console.log(`[HR Settings] ${authResult.payload.username} updated ${key} to: ${value}`);

    return NextResponse.json({
      success: true,
      message: `Setting '${key}' updated successfully`,
      key,
      value,
    });
  } catch (error) {
    console.error('Error updating setting:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update setting' },
      { status: 500 }
    );
  }
}
