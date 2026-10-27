import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { currentShiftDateSql, shiftCallTotalsSql } from '@/lib/call-stats';
import { legacyAuth, withAuth } from '@/lib/auth/session';

async function GET__handler(request: NextRequest) {
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
    await legacyAuth(request);

    // This month = shift dates from the 1st to each agent's current shift date,
    // counted the shared way (lib/call-stats.ts), plus HR-added meeting time.
    const result = await query(
      `WITH agents AS (
         SELECT u.id, u.full_name, u.extension_number, ${currentShiftDateSql()} AS shift_date
           FROM users u
          WHERE u.role = 'agent' AND u.is_active = true
       ),
       bounds AS (
         SELECT DATE_TRUNC('month', MAX(shift_date))::date AS month_start, MAX(shift_date) AS month_end FROM agents
       ),
       calls AS ${shiftCallTotalsSql('(SELECT month_start FROM bounds)', '(SELECT month_end FROM bounds)')}
       SELECT
        a.id as user_id,
        a.full_name,
        a.extension_number,
        COALESCE(cl.total_calls, 0) as total_calls,
        COALESCE(cl.total_talk, 0) + COALESCE(ds.total_meeting_seconds, 0) as total_talk_time,
        COALESCE(ds.total_leads, 0) as total_leads,
        ROW_NUMBER() OVER (
          ORDER BY
            COALESCE(cl.total_calls, 0) DESC,
            COALESCE(cl.total_talk, 0) + COALESCE(ds.total_meeting_seconds, 0) DESC
        ) as rank
       FROM agents a
       LEFT JOIN (
         SELECT ds.user_id,
                SUM(ds.leads_count) as total_leads,
                SUM(COALESCE(ds.meeting_seconds, 0)) as total_meeting_seconds
           FROM daily_stats ds
           JOIN agents a ON a.id = ds.user_id
          WHERE ds.date >= DATE_TRUNC('month', a.shift_date)::date AND ds.date <= a.shift_date
          GROUP BY ds.user_id
       ) ds ON ds.user_id = a.id
       LEFT JOIN (
         SELECT c.user_id, SUM(c.calls_count) as total_calls, SUM(c.talk_time_seconds) as total_talk
           FROM calls c
           JOIN agents a ON a.id = c.user_id
          WHERE c.date::date >= DATE_TRUNC('month', a.shift_date)::date AND c.date::date <= a.shift_date
          GROUP BY c.user_id
       ) cl ON cl.user_id = a.id
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

export const GET = withAuth(GET__handler);
