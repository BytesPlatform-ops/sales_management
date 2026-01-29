import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { getTodayDate } from '@/lib/date-utils';

/**
 * 3CX Webhook Endpoint
 * Receives call data from 3CX phone system and updates daily_stats
 * 
 * Expected Payload:
 * {
 *   "agent_extension": "101",
 *   "duration": "00:05:30",  // HH:MM:SS or MM:SS format
 *   "call_type": "Outbound"  // Outbound, Inbound, etc.
 * }
 */

interface WebhookPayload {
  agent_extension: string;
  duration: string;
  call_type?: string;
}

/**
 * Parse duration string to seconds
 * Supports: HH:MM:SS, MM:SS, or just seconds
 */
function parseDurationToSeconds(duration: string): number {
  if (!duration) return 0;
  
  const trimmed = duration.trim();
  const parts = trimmed.split(':');
  
  try {
    if (parts.length === 3) {
      // HH:MM:SS
      const [h, m, s] = parts.map(Number);
      return h * 3600 + m * 60 + s;
    } else if (parts.length === 2) {
      // MM:SS
      const [m, s] = parts.map(Number);
      return m * 60 + s;
    } else if (parts.length === 1) {
      // Just seconds
      return parseInt(parts[0], 10) || 0;
    }
  } catch {
    return 0;
  }
  
  return 0;
}

export async function POST(request: NextRequest) {
  try {
    const body: WebhookPayload = await request.json();
    
    // Validate required fields
    if (!body.agent_extension) {
      return NextResponse.json(
        { status: 'error', message: 'Missing agent_extension' },
        { status: 400 }
      );
    }
    
    if (!body.duration) {
      return NextResponse.json(
        { status: 'error', message: 'Missing duration' },
        { status: 400 }
      );
    }
    
    const { agent_extension, duration, call_type } = body;
    
    // Lookup user by extension number
    const user = await queryOne<{ id: number; full_name: string }>(
      'SELECT id, full_name FROM users WHERE extension_number = $1 AND is_active = true',
      [agent_extension]
    );
    
    if (!user) {
      console.warn(`3CX Webhook: Unknown extension ${agent_extension}`);
      return NextResponse.json(
        { status: 'error', message: `Unknown extension: ${agent_extension}` },
        { status: 404 }
      );
    }
    
    // Parse duration to seconds
    const durationSeconds = parseDurationToSeconds(duration);
    
    // Get today's date in Karachi timezone
    const today = getTodayDate();
    
    // Upsert into daily_stats
    // If record exists for today, increment calls_count and add to talk_time_seconds
    // If not, create a new record
    await query(
      `INSERT INTO daily_stats (user_id, date, calls_count, talk_time_seconds, leads_count)
       VALUES ($1, $2, 1, $3, 0)
       ON CONFLICT (user_id, date) 
       DO UPDATE SET 
         calls_count = daily_stats.calls_count + 1,
         talk_time_seconds = daily_stats.talk_time_seconds + $3,
         updated_at = CURRENT_TIMESTAMP`,
      [user.id, today, durationSeconds]
    );
    
    console.log(`3CX Webhook: ${user.full_name} (${agent_extension}) - ${call_type || 'Call'} - ${duration} (${durationSeconds}s)`);
    
    return NextResponse.json({
      status: 'success',
      message: 'Call recorded',
      data: {
        user_id: user.id,
        extension: agent_extension,
        date: today,
        duration_seconds: durationSeconds,
        call_type: call_type || 'Unknown',
      },
    });
    
  } catch (error) {
    console.error('3CX Webhook error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Also support GET for health check
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    message: '3CX Webhook endpoint is running',
    timestamp: new Date().toISOString(),
  });
}
