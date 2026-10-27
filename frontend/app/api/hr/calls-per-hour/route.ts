import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { pktHourSql, shiftDateSql, talkSecondsSql } from '@/lib/call-stats';
import { legacyAuth, withAuth } from '@/lib/auth/session';

interface JwtPayload {
  userId: number;
  username: string;
  role: string;
}

/**
 * Get the working date based on shift start time (9 PM logic).
 * Mirrors the logic in /api/hr/daily-stats so both views agree on "today".
 * If current time is before 6 AM, the working date is yesterday.
 */
function getWorkingDate(dateStr?: string): string {
  if (dateStr) return dateStr;

  const now = new Date();
  const dateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const hourFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Karachi',
    hour: 'numeric',
    hourCycle: 'h23',
  });

  const currentDate = dateFormatter.format(now);
  const hour = parseInt(hourFormatter.format(now), 10) % 24;

  if (hour < 6) {
    const [year, month, day] = currentDate.split('-').map(Number);
    const tempDate = new Date(year, month - 1, day - 1);
    return `${tempDate.getFullYear()}-${String(tempDate.getMonth() + 1).padStart(2, '0')}-${String(tempDate.getDate()).padStart(2, '0')}`;
  }

  return currentDate;
}

/**
 * Format a 0-23 hour into a readable clock label, e.g. 21 -> "9 PM".
 */
function formatHourLabel(hour: number): string {
  const period = hour < 12 ? 'AM' : 'PM';
  let h = hour % 12;
  if (h === 0) h = 12;
  return `${h} ${period}`;
}

/**
 * GET /api/hr/calls-per-hour?date=YYYY-MM-DD
 *
 * Returns a real, DB-backed hourly breakdown of calls for the working date:
 *   - one bucket per hour that had at least one call
 *   - each bucket has the total call count + a per-agent breakdown
 *
 * Calls come from the call_logs table (populated from 3CX). Hours are bucketed
 * in Asia/Karachi local time so they line up with the rest of the HR views.
 */
async function GET__handler(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { status: 'error', message: 'No token provided' },
        { status: 401 }
      );
    }

    const token = authHeader.split(' ')[1];
    const { payload } = await legacyAuth(request);
    const jwtPayload = payload as unknown as JwtPayload;

    if (jwtPayload.role !== 'hr') {
      return NextResponse.json(
        { status: 'error', message: 'Access denied. HR only.' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get('date');
    const targetDate = getWorkingDate(dateParam || undefined);

    // One row per (hour, agent) for this shift date. Calls belong to each
    // agent's own shift (lib/call-stats.ts); hours are PKT clock hours. Every
    // call counts; talk time only from calls >= 30 s.
    const rows = await query<any>(
      `
      SELECT
        ${pktHourSql('cl.call_time')} AS hour,
        u.id   AS agent_id,
        u.full_name AS agent_name,
        u.extension_number AS extension,
        COUNT(*)::int AS call_count,
        COALESCE(SUM(${talkSecondsSql('cl.call_duration')}), 0)::int AS talk_time_seconds
      FROM call_logs cl
      JOIN users u ON u.extension_number = cl.agent_extension
      WHERE cl.call_time >= ($1::date - 1)::timestamp
        AND cl.call_time < ($1::date + 2)::timestamp
        AND ${shiftDateSql('cl.call_time')} = $1::date
        AND u.role = 'agent'
      GROUP BY hour, u.id, u.full_name, u.extension_number
      ORDER BY hour ASC, call_count DESC, u.full_name ASC
      `,
      [targetDate]
    );

    // Group flat rows into hour buckets with per-agent breakdowns.
    const bucketMap = new Map<
      number,
      {
        hour: number;
        label: string;
        totalCalls: number;
        totalTalkTimeSeconds: number;
        agents: {
          agentId: number;
          agentName: string;
          extension: string;
          callCount: number;
          talkTimeSeconds: number;
        }[];
      }
    >();

    for (const r of rows) {
      const hour = Number(r.hour);
      if (!bucketMap.has(hour)) {
        bucketMap.set(hour, {
          hour,
          label: formatHourLabel(hour),
          totalCalls: 0,
          totalTalkTimeSeconds: 0,
          agents: [],
        });
      }
      const bucket = bucketMap.get(hour)!;
      const callCount = Number(r.call_count) || 0;
      const talk = Number(r.talk_time_seconds) || 0;
      bucket.totalCalls += callCount;
      bucket.totalTalkTimeSeconds += talk;
      bucket.agents.push({
        agentId: Number(r.agent_id),
        agentName: r.agent_name,
        extension: r.extension,
        callCount,
        talkTimeSeconds: talk,
      });
    }

    // Order hours from noon onward, wrapping past midnight, so overnight shifts
    // (8 PM or 9 PM starts) read top-to-bottom in the order they happened.
    const SHIFT_START_HOUR = 12;
    const hours = Array.from(bucketMap.values()).sort((a, b) => {
      const ra = (a.hour - SHIFT_START_HOUR + 24) % 24;
      const rb = (b.hour - SHIFT_START_HOUR + 24) % 24;
      return ra - rb;
    });

    const totalCalls = hours.reduce((sum, h) => sum + h.totalCalls, 0);

    return NextResponse.json({
      status: 'success',
      date: targetDate,
      totalCalls,
      hours,
      generatedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('calls-per-hour error:', error);
    return NextResponse.json(
      { status: 'error', message: error?.message || 'Failed to load calls per hour' },
      { status: 500 }
    );
  }
}

export const GET = withAuth(GET__handler);
