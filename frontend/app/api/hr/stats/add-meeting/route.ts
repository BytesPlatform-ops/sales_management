import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'
);

interface JwtPayload {
  userId: number;
  username: string;
  role: string;
}

interface AddMeetingRequest {
  agentId: number;
  date: string; // YYYY-MM-DD format
  durationMinutes: number;
  reason?: string;
}

// POST - Add meeting time to agent's daily stats
export async function POST(request: NextRequest) {
  try {
    // Verify JWT token and check if user is HR
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { status: 'error', message: 'No token provided' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    const verified = (await jwtVerify(token, JWT_SECRET)) as any;
    const payload = verified.payload as JwtPayload;

    // Only HR can add meeting time
    if (payload.role !== 'hr') {
      return NextResponse.json(
        { status: 'error', message: 'Only HR can add meeting time' },
        { status: 403 }
      );
    }

    // Parse request body
    const body: AddMeetingRequest = await request.json();
    const { agentId, date, durationMinutes, reason } = body;

    // Validate inputs
    if (!agentId || !date || !durationMinutes || durationMinutes <= 0) {
      return NextResponse.json(
        { status: 'error', message: 'Invalid agentId, date, or durationMinutes' },
        { status: 400 }
      );
    }

    // Validate date format (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { status: 'error', message: 'Invalid date format. Use YYYY-MM-DD' },
        { status: 400 }
      );
    }

    // Convert minutes to seconds
    const durationSeconds = Math.round(durationMinutes * 60);

    // Start transaction: get or create daily_stats record, then update it
    const rows = await query(
      `SELECT id, talk_time_seconds, meeting_seconds 
       FROM daily_stats 
       WHERE user_id = $1 AND date = $2`,
      [agentId, date]
    );

    let dailyStatId: number;
    let previousTalkTime = 0;
    let previousMeetingTime = 0;

    if (rows.length > 0) {
      // Record exists, update it
      dailyStatId = (rows[0] as any).id;
      previousTalkTime = (rows[0] as any).talk_time_seconds || 0;
      previousMeetingTime = (rows[0] as any).meeting_seconds || 0;
    } else {
      // Record doesn't exist, create it
      const insertResult = await query(
        `INSERT INTO daily_stats (user_id, date, talk_time_seconds, meeting_seconds)
         VALUES ($1, $2, $3, $4)
         RETURNING id, talk_time_seconds, meeting_seconds`,
        [agentId, date, durationSeconds, durationSeconds]
      );

      dailyStatId = (insertResult[0] as any).id;
      previousTalkTime = durationSeconds;
      previousMeetingTime = durationSeconds;

      console.log(`Created new daily_stats record for agent ${agentId} on ${date}`);
      return NextResponse.json({
        status: 'success',
        message: 'Meeting time added successfully',
        data: {
          dailyStatId,
          previousMeetingSeconds: 0,
          newMeetingSeconds: durationSeconds,
          previousTalkTimeSeconds: 0,
          newTalkTimeSeconds: durationSeconds,
          hrUserId: payload.userId,
          reason: reason || null,
        },
      });
    }

    // Update existing record: increment both meeting_seconds and talk_time_seconds
    const updateResult = await query(
      `UPDATE daily_stats
       SET meeting_seconds = meeting_seconds + $1,
           talk_time_seconds = talk_time_seconds + $2,
           updated_at = NOW()
       WHERE id = $3
       RETURNING talk_time_seconds, meeting_seconds`,
      [durationSeconds, durationSeconds, dailyStatId]
    );

    const newTalkTime = (updateResult[0] as any).talk_time_seconds;
    const newMeetingTime = (updateResult[0] as any).meeting_seconds;

    console.log(`Added ${durationMinutes} minutes of meeting time for agent ${agentId}`, {
      date,
      durationSeconds,
      previousMeetingTime,
      newMeetingTime,
      previousTalkTime,
      newTalkTime,
      reason,
      hrUserId: payload.userId,
    });

    return NextResponse.json({
      status: 'success',
      message: 'Meeting time added successfully',
      data: {
        dailyStatId,
        previousMeetingSeconds: previousMeetingTime,
        newMeetingSeconds: newMeetingTime,
        previousTalkTimeSeconds: previousTalkTime,
        newTalkTimeSeconds: newTalkTime,
        systemTalkTimeSeconds: newTalkTime - newMeetingTime,
        hrUserId: payload.userId,
        reason: reason || null,
      },
    });
  } catch (error: any) {
    console.error('Error adding meeting time:', error);
    return NextResponse.json(
      { status: 'error', message: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
