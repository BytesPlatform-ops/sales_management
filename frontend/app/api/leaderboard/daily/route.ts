import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { query } from '@/lib/db';
import { currentShiftDateSql, shiftCallTotalsSql } from '@/lib/call-stats';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'
);

export async function GET(request: NextRequest) {
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
    await jwtVerify(token, JWT_SECRET);

    // Today = each agent's current shift date (their own shift times), counted
    // the shared way: every call counts, talk time only from calls >= 30 s,
    // plus HR-added meeting time (lib/call-stats.ts).
    const result = await query(
      `WITH agents AS (
         SELECT u.id, u.full_name, u.extension_number, ${currentShiftDateSql()} AS shift_date
           FROM users u
          WHERE u.role = 'agent' AND u.is_active = true
       ),
       calls AS ${shiftCallTotalsSql('CURRENT_DATE - 1', 'CURRENT_DATE + 1')}
       SELECT
        a.id as user_id,
        a.full_name,
        a.extension_number,
        COALESCE(cl.calls_count, 0) as calls_count,
        COALESCE(cl.talk_time_seconds, 0) + COALESCE(ds.meeting_seconds, 0) as talk_time_seconds,
        COALESCE(ds.leads_count, 0) as leads_count,
        ROW_NUMBER() OVER (
          ORDER BY
            COALESCE(cl.calls_count, 0) DESC,
            COALESCE(cl.talk_time_seconds, 0) + COALESCE(ds.meeting_seconds, 0) DESC
        ) as rank
       FROM agents a
       LEFT JOIN daily_stats ds ON ds.user_id = a.id AND ds.date = a.shift_date
       LEFT JOIN calls cl ON cl.user_id = a.id AND cl.date = a.shift_date::text
       ORDER BY calls_count DESC, talk_time_seconds DESC
       LIMIT 10`,
      []
    );

    return NextResponse.json({
      status: 'success',
      data: result.map((row: any) => ({
        ...row,
        rank: parseInt(row.rank),
      })),
    });
  } catch (error) {
    console.error('Get daily leaderboard error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Internal server error' },
      { status: 500 }
    );
  }
}
