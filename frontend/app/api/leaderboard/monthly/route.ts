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

    // Use CURRENT_DATE and DATE_TRUNC directly from database to match dashboard.py logic
    // This ensures consistent timezone handling with the database server

    // Get monthly leaderboard - includes ALL active agents
    // Uses call_logs for calls/talk_time (matching dashboard.py), daily_stats for leads
    const result = await query(
      `SELECT 
        u.id as user_id,
        u.full_name,
        u.extension_number,
        COALESCE(cl.call_log_calls, 0) as total_calls,
        COALESCE(cl.call_log_seconds, 0) as total_talk_time,
        COALESCE(ds.total_leads, 0) as total_leads,
        ROW_NUMBER() OVER (
          ORDER BY 
            COALESCE(cl.call_log_calls, 0) DESC, 
            COALESCE(cl.call_log_seconds, 0) DESC
        ) as rank
       FROM users u
       LEFT JOIN (
         SELECT 
           user_id,
           SUM(leads_count) as total_leads
         FROM daily_stats 
         WHERE date >= DATE_TRUNC('month', CURRENT_DATE)::date 
           AND date <= CURRENT_DATE
         GROUP BY user_id
       ) ds ON ds.user_id = u.id
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
         WHERE call_time::date >= DATE_TRUNC('month', CURRENT_DATE)::date 
           AND call_time::date <= CURRENT_DATE
         GROUP BY agent_extension
       ) cl ON cl.agent_extension = u.extension_number
       WHERE u.role = 'agent' AND u.is_active = true
       ORDER BY total_calls DESC, total_talk_time DESC
       LIMIT 10`,
      []
    );

    return NextResponse.json({
      status: 'success',
      data: result.map((row: any) => ({
        ...row,
        rank: parseInt(row.rank),
        total_calls: parseInt(row.total_calls),
        total_talk_time: parseInt(row.total_talk_time),
        total_leads: parseInt(row.total_leads),
      })),
    });
  } catch (error) {
    console.error('Get monthly leaderboard error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Internal server error' },
      { status: 500 }
    );
  }
}
