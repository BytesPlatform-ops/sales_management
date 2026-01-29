import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { query, queryOne } from '@/lib/db';
import {
  determineAttendanceStatus,
  getCurrentTimeKarachi,
  getAttendanceDate,
} from '@/lib/attendance-utils';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'
);

interface JwtPayload {
  userId: number;
  username: string;
  role: string;
}

interface UserRecord {
  id: number;
  shift_start: string;
  shift_end: string;
  full_name: string;
}

interface AttendanceRecord {
  id: number;
  user_id: number;
  date: string;
  check_in_time: string | null;
  check_out_time: string | null;
  status: string;
  hr_approved: boolean;
}

// GET - Get current user's attendance for today
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { status: 'error', message: 'No token provided' },
        { status: 401 }
      );
    }

    const token = authHeader.split(' ')[1];
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const jwtPayload = payload as unknown as JwtPayload;

    // Get user's shift info
    const user = await queryOne<UserRecord>(
      'SELECT id, shift_start, shift_end, full_name FROM users WHERE id = $1',
      [jwtPayload.userId]
    );

    if (!user) {
      return NextResponse.json(
        { status: 'error', message: 'User not found' },
        { status: 404 }
      );
    }

    // Get the appropriate date
    const attendanceDate = getAttendanceDate(user.shift_start, user.shift_end);

    // Get today's attendance
    const attendance = await queryOne<AttendanceRecord>(
      'SELECT * FROM attendance WHERE user_id = $1 AND date = $2',
      [jwtPayload.userId, attendanceDate]
    );

    return NextResponse.json({
      status: 'success',
      data: attendance || null,
    });
  } catch (error) {
    console.error('Attendance GET error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Failed to get attendance' },
      { status: 500 }
    );
  }
}

// POST - Check in
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { status: 'error', message: 'No token provided' },
        { status: 401 }
      );
    }

    const token = authHeader.split(' ')[1];
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const jwtPayload = payload as unknown as JwtPayload;

    // Get user's shift info
    const user = await queryOne<UserRecord>(
      'SELECT id, shift_start, shift_end, full_name FROM users WHERE id = $1',
      [jwtPayload.userId]
    );

    if (!user) {
      return NextResponse.json(
        { status: 'error', message: 'User not found' },
        { status: 404 }
      );
    }

    // Get the appropriate date
    const attendanceDate = getAttendanceDate(user.shift_start, user.shift_end);

    // Check if already checked in
    const existing = await queryOne<AttendanceRecord>(
      'SELECT * FROM attendance WHERE user_id = $1 AND date = $2',
      [jwtPayload.userId, attendanceDate]
    );

    if (existing) {
      return NextResponse.json(
        { status: 'error', message: 'Already checked in for today' },
        { status: 400 }
      );
    }

    // Determine attendance status
    const attendanceResult = determineAttendanceStatus(user.shift_start);
    const currentTime = getCurrentTimeKarachi();

    // Insert attendance record
    const newAttendance = await queryOne<AttendanceRecord>(
      `INSERT INTO attendance (user_id, date, check_in_time, status, hr_approved)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        jwtPayload.userId,
        attendanceDate,
        currentTime.toISOString(),
        attendanceResult.status,
        false,
      ]
    );

    console.log(
      `✅ Check-in: ${user.full_name} - ${attendanceResult.status} (${attendanceResult.minutesLate} mins late)`
    );

    return NextResponse.json({
      status: 'success',
      data: newAttendance,
      message: attendanceResult.message,
    });
  } catch (error) {
    console.error('Check-in error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Check-in failed' },
      { status: 500 }
    );
  }
}

// PUT - Check out
export async function PUT(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { status: 'error', message: 'No token provided' },
        { status: 401 }
      );
    }

    const token = authHeader.split(' ')[1];
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const jwtPayload = payload as unknown as JwtPayload;

    // Get user's shift info
    const user = await queryOne<UserRecord>(
      'SELECT id, shift_start, shift_end, full_name FROM users WHERE id = $1',
      [jwtPayload.userId]
    );

    if (!user) {
      return NextResponse.json(
        { status: 'error', message: 'User not found' },
        { status: 404 }
      );
    }

    // Get the appropriate date
    const attendanceDate = getAttendanceDate(user.shift_start, user.shift_end);

    // Get today's attendance
    const existing = await queryOne<AttendanceRecord>(
      'SELECT * FROM attendance WHERE user_id = $1 AND date = $2',
      [jwtPayload.userId, attendanceDate]
    );

    if (!existing) {
      return NextResponse.json(
        { status: 'error', message: 'No check-in record found for today' },
        { status: 400 }
      );
    }

    if (existing.check_out_time) {
      return NextResponse.json(
        { status: 'error', message: 'Already checked out for today' },
        { status: 400 }
      );
    }

    // Update with check-out time
    const currentTime = getCurrentTimeKarachi();
    const updated = await queryOne<AttendanceRecord>(
      `UPDATE attendance 
       SET check_out_time = $1
       WHERE id = $2
       RETURNING *`,
      [currentTime.toISOString(), existing.id]
    );

    console.log(`✅ Check-out: ${user.full_name}`);

    return NextResponse.json({
      status: 'success',
      data: updated,
      message: 'Successfully checked out',
    });
  } catch (error) {
    console.error('Check-out error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Check-out failed' },
      { status: 500 }
    );
  }
}
