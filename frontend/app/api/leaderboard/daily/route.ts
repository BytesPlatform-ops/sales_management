import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { query } from '@/lib/db';

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

    // Use CURRENT_DATE directly from database to match dashboard.py logic
    // This ensures consistent timezone handling with the database server

    // Get today's leaderboard - includes ALL active agents, even with 0 stats
    // Uses call_logs for real-time call tracking (matching dashboard.py)
    // Uses daily_stats only for leads_count
    const result = await query(
      `SELECT 
        u.id as user_id,
        u.full_name,
        u.extension_number,
        COALESCE(cl.call_log_calls, 0) as calls_count,
        COALESCE(cl.call_log_seconds, 0) as talk_time_seconds,
        COALESCE(ds.leads_count, 0) as leads_count,
        ROW_NUMBER() OVER (
          ORDER BY 
            COALESCE(cl.call_log_calls, 0) DESC, 
            COALESCE(cl.call_log_seconds, 0) DESC
        ) as rank
       FROM users u
       LEFT JOIN daily_stats ds ON ds.user_id = u.id AND ds.date = CURRENT_DATE
       LEFT JOIN (
         SELECT 
           agent_extension,
           COUNT(*) as call_log_calls,
           COALESCE(SUM(
             CASE 
               WHEN call_duration ~ '^\\d+:\\d+:\\d+$' THEN 
                 (SPLIT_PART(call_duration, ':', 1)::int * 3600 + 
                  SPLIT_PART(call_duration, ':', 2)::int * 60 + 
                  SPLIT_PART(call_duration, ':', 3)::int)
               WHEN call_duration ~ '^\\d+:\\d+$' THEN 
                 (SPLIT_PART(call_duration, ':', 1)::int * 60 + 
                  SPLIT_PART(call_duration, ':', 2)::int)
               ELSE 0
             END
           ), 0) as call_log_seconds
         FROM call_logs 
         WHERE call_time::date = CURRENT_DATE
         GROUP BY agent_extension
       ) cl ON cl.agent_extension = u.extension_number
       WHERE u.role = 'agent' AND u.is_active = true
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
