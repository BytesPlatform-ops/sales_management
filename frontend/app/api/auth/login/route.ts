import { NextRequest, NextResponse } from 'next/server';
import { SignJWT } from 'jose';
import { query, queryOne } from '@/lib/db';
import {
  determineAttendanceStatus,
  getTodayDateKarachi,
  getCurrentTimeKarachi,
  getAttendanceDate,
  isWeekendShift,
} from '@/lib/attendance-utils';

// Use jose library for Edge-compatible JWT (install: npm install jose)
const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'
);

interface User {
  id: number;
  username: string;
  password: string;
  full_name: string;
  extension_number: string;
  role: 'hr' | 'agent';
  base_salary: number;
  shift_start: string;
  shift_end: string;
  employment_type: string;
  is_active: boolean;
  created_at: string;
}

interface AttendanceRecord {
  id: number;
  user_id: number;
  date: string;
  status: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, password } = body;

    // Validate input
    if (!username || !password) {
      return NextResponse.json(
        { status: 'error', message: 'Username and password are required' },
        { status: 400 }
      );
    }

    // 1. Fetch user from database
    const user = await queryOne<User>(
      'SELECT * FROM users WHERE username = $1',
      [username]
    );

    if (!user) {
      return NextResponse.json(
        { status: 'error', message: 'Invalid username or password' },
        { status: 401 }
      );
    }

    if (!user.is_active) {
      return NextResponse.json(
        { status: 'error', message: 'Account is deactivated' },
        { status: 401 }
      );
    }

    // 2. Verify password (using bcrypt comparison)
    // For Edge runtime, we'll use a simple comparison or import bcryptjs
    const bcrypt = await import('bcryptjs');
    const isValidPassword = await bcrypt.compare(password, user.password);

    if (!isValidPassword) {
      return NextResponse.json(
        { status: 'error', message: 'Invalid username or password' },
        { status: 401 }
      );
    }

    // 3. Generate JWT token
    const token = await new SignJWT({
      userId: user.id,
      username: user.username,
      role: user.role,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(JWT_SECRET);

    // 4. Handle attendance for agents (not HR)
    let attendanceInfo = null;
    let isWeekend = false;
    
    if (user.role === 'agent') {
      // Get the appropriate date for this shift (handles overnight shifts like 9 PM - 5 AM)
      // If login is after midnight but before shift end, date = previous day
      const attendanceDate = getAttendanceDate(user.shift_start, user.shift_end);

      // Check if this shift falls on a weekend (based on shift START date)
      // Saturday/Sunday = Weekend (System Paused)
      isWeekend = isWeekendShift(user.shift_start, user.shift_end);

      if (isWeekend) {
        // Weekend shift - do NOT record attendance, do NOT mark absent/late
        attendanceInfo = {
          isNewRecord: false,
          date: attendanceDate,
          status: 'weekend',
          message: 'Weekend - System Paused. Enjoy your time off! 🎉',
        };

        console.log(
          `🎉 Weekend login for ${user.full_name} - attendance not tracked`
        );
      } else {
        // Working day - First-Login Rule: Check if attendance already exists for this shift date
        const existingAttendance = await queryOne<AttendanceRecord>(
          'SELECT * FROM attendance WHERE user_id = $1 AND date = $2',
          [user.id, attendanceDate]
        );

        if (!existingAttendance) {
          // This is the FIRST login for this shift - record attendance
          const attendanceResult = determineAttendanceStatus(user.shift_start);
          const currentTime = getCurrentTimeKarachi();

          // Insert new attendance record with check_in_time
          const newAttendance = await queryOne<AttendanceRecord>(
            `INSERT INTO attendance (user_id, date, check_in_time, status, hr_approved)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [
              user.id,
              attendanceDate,
              currentTime.toISOString(),  // Store as ISO timestamp
              attendanceResult.status,
              true, // Auto-approve attendance on login
            ]
          );

          attendanceInfo = {
            isNewRecord: true,
            date: attendanceDate,
            status: attendanceResult.status,
            minutesLate: attendanceResult.minutesLate,
            message: attendanceResult.message,
            checkInTime: currentTime.toISOString(),
          };

          console.log(
            `✅ First-login attendance recorded for ${user.full_name} on ${attendanceDate}: ${attendanceResult.status} (${attendanceResult.minutesLate} mins late)`
          );
        } else {
          // Attendance already exists - preserve original first login time
          attendanceInfo = {
            isNewRecord: false,
            date: attendanceDate,
            status: existingAttendance.status,
            message: 'Attendance already recorded (first login preserved)',
          };
          
          console.log(
            `ℹ️ ${user.full_name} already checked in for ${attendanceDate} - keeping original record`
          );
        }
      }
    }

    // 5. Prepare user response (exclude password)
    const { password: _, ...userWithoutPassword } = user;

    return NextResponse.json({
      status: 'success',
      data: {
        token,
        user: userWithoutPassword,
        attendance: attendanceInfo,
        is_weekend: isWeekend,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Internal server error' },
      { status: 500 }
    );
  }
}
