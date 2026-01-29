/**
 * API Route: /api/agent/leads
 * POST - Add a lead (increment leads_count for today's shift)
 */

import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { query, queryOne } from '@/lib/db';
import { getShiftStartTimeUTC } from '@/lib/attendance-utils';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'
);

interface User {
  id: number;
  shift_start: string;
  shift_end: string;
}

export async function POST(request: NextRequest) {
  try {
    // Verify JWT token
    const authHeader = request.headers.get('authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { status: 'error', message: 'No token provided' },
        { status: 401 }
      );
    }

    const token = authHeader.split(' ')[1];
    
    let payload;
    try {
      const { payload: verifiedPayload } = await jwtVerify(token, JWT_SECRET);
      payload = verifiedPayload;
    } catch {
      return NextResponse.json(
        { status: 'error', message: 'Invalid token' },
        { status: 401 }
      );
    }

    const userId = payload.userId as number;
    const role = payload.role as string;
    
    // Only agents can add leads
    if (role !== 'agent') {
      return NextResponse.json(
        { status: 'error', message: 'Only agents can add leads' },
        { status: 403 }
      );
    }

    // Get user's shift times
    const user = await queryOne<User>(
      'SELECT id, shift_start, shift_end FROM users WHERE id = $1',
      [userId]
    );

    if (!user) {
      return NextResponse.json(
        { status: 'error', message: 'User not found' },
        { status: 404 }
      );
    }

    // Get the shift date (handles overnight shifts correctly)
    const shiftTiming = getShiftStartTimeUTC(user.shift_start, user.shift_end);
    const shiftDate = shiftTiming.shiftDatePKT;
    
    console.log(`📊 Adding lead for user ${userId} on shift date: ${shiftDate}`);
    
    // Upsert daily_stats: increment leads_count
    const result = await query(
      `INSERT INTO daily_stats (user_id, date, calls_count, talk_time_seconds, leads_count, sales_amount)
       VALUES ($1, $2, 0, 0, 1, 0)
       ON CONFLICT (user_id, date)
       DO UPDATE SET 
         leads_count = daily_stats.leads_count + 1,
         updated_at = NOW()
       RETURNING *`,
      [userId, shiftDate]
    );

    const stats = result[0];

    return NextResponse.json({
      status: 'success',
      message: 'Lead added successfully',
      data: {
        date: stats.date,
        leads_count: stats.leads_count,
        calls_count: stats.calls_count,
        talk_time_seconds: stats.talk_time_seconds
      }
    });

  } catch (error) {
    console.error('Add lead error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Internal server error' },
      { status: 500 }
    );
  }
}
