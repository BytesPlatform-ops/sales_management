import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import crypto from 'crypto';
import { legacyAuth, withAuth } from '@/lib/auth/session';

interface JwtPayload {
  userId: number;
  username: string;
  role: string;
}

export const dynamic = 'force-dynamic';

/**
 * GET /api/hr/dialer-leads/settings
 * Get auto-distribution settings
 */
async function GET__handler(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ status: 'error', message: 'No token provided' }, { status: 401 });
    }

    const token = authHeader.split(' ')[1];
    const { payload } = await legacyAuth(request);
    const jwt = payload as unknown as JwtPayload;

    if (jwt.role !== 'hr') {
      return NextResponse.json({ status: 'error', message: 'Access denied. HR only.' }, { status: 403 });
    }

    const settings = await queryOne<any>(
      `SELECT leads_per_agent, auto_distribute_enabled, auto_distribute_time,
              last_auto_distributed_at, cron_secret IS NOT NULL as has_cron_secret
       FROM distribution_settings WHERE id = 1`
    );

    return NextResponse.json({
      status: 'success',
      data: settings || {
        leads_per_agent: 200,
        auto_distribute_enabled: false,
        auto_distribute_time: '19:00',
        last_auto_distributed_at: null,
        has_cron_secret: false,
      },
    });
  } catch (error) {
    console.error('Settings GET error:', error);
    return NextResponse.json({ status: 'error', message: 'Failed to fetch settings' }, { status: 500 });
  }
}

/**
 * PUT /api/hr/dialer-leads/settings
 * Update auto-distribution settings
 */
async function PUT__handler(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ status: 'error', message: 'No token provided' }, { status: 401 });
    }

    const token = authHeader.split(' ')[1];
    const { payload } = await legacyAuth(request);
    const jwt = payload as unknown as JwtPayload;

    if (jwt.role !== 'hr') {
      return NextResponse.json({ status: 'error', message: 'Access denied. HR only.' }, { status: 403 });
    }

    const body = await request.json();
    const { leads_per_agent, auto_distribute_enabled, auto_distribute_time, regenerate_secret } = body;

    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (leads_per_agent !== undefined) {
      updates.push(`leads_per_agent = $${paramIndex++}`);
      values.push(Math.max(1, Math.min(1000, leads_per_agent)));
    }
    if (auto_distribute_enabled !== undefined) {
      updates.push(`auto_distribute_enabled = $${paramIndex++}`);
      values.push(auto_distribute_enabled);
    }
    if (auto_distribute_time !== undefined) {
      // Validate HH:MM format
      if (/^\d{2}:\d{2}$/.test(auto_distribute_time)) {
        updates.push(`auto_distribute_time = $${paramIndex++}`);
        values.push(auto_distribute_time);
      }
    }
    if (regenerate_secret) {
      const secret = crypto.randomBytes(32).toString('hex');
      updates.push(`cron_secret = $${paramIndex++}`);
      values.push(secret);
    }

    updates.push('updated_at = NOW()');

    const result = await queryOne<any>(
      `UPDATE distribution_settings SET ${updates.join(', ')} WHERE id = 1
       RETURNING leads_per_agent, auto_distribute_enabled, auto_distribute_time,
                 last_auto_distributed_at, cron_secret`,
      values
    );

    // Only return the secret if it was just regenerated
    const responseData: any = {
      leads_per_agent: result?.leads_per_agent,
      auto_distribute_enabled: result?.auto_distribute_enabled,
      auto_distribute_time: result?.auto_distribute_time,
      last_auto_distributed_at: result?.last_auto_distributed_at,
      has_cron_secret: !!result?.cron_secret,
    };

    if (regenerate_secret && result?.cron_secret) {
      responseData.cron_secret = result.cron_secret;
    }

    return NextResponse.json({
      status: 'success',
      message: 'Settings updated',
      data: responseData,
    });
  } catch (error) {
    console.error('Settings PUT error:', error);
    return NextResponse.json({ status: 'error', message: 'Failed to update settings' }, { status: 500 });
  }
}

export const GET = withAuth(GET__handler);
export const PUT = withAuth(PUT__handler);
