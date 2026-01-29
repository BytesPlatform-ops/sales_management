import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { query, queryOne } from '@/lib/db';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'
);

interface JwtPayload {
  userId: number;
  username: string;
  role: string;
}

// GET - Get attendance records by date
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

    // Check if user is HR
    if (jwtPayload.role !== 'hr') {
      return NextResponse.json(
        { status: 'error', message: 'Access denied. HR only.' },
        { status: 403 }
      );
    }

    // Get date from query params
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date') || new Date().toISOString().split('T')[0];

    // Get all attendance records for the date with user info
    const attendance = await query<any>(
      `SELECT a.id, a.user_id, a.date, a.check_in_time, a.check_out_time, 
              a.status, a.hr_approved, a.notes,
              u.full_name, u.extension_number, u.shift_start, u.shift_end
       FROM attendance a
       JOIN users u ON a.user_id = u.id
       WHERE a.date = $1
       ORDER BY a.check_in_time ASC`,
      [date]
    );

    // Also get all active agents to show who hasn't checked in
    const allAgents = await query<any>(
      `SELECT id, full_name, extension_number, shift_start, shift_end
       FROM users 
       WHERE role = 'agent' AND is_active = true`
    );

    // Find agents who haven't checked in
    const checkedInUserIds = new Set(attendance.map((a: any) => a.user_id));
    const notCheckedIn = allAgents.filter((agent: any) => !checkedInUserIds.has(agent.id));

    return NextResponse.json({
      status: 'success',
      data: attendance,
      notCheckedIn,
      date,
    });
  } catch (error) {
    console.error('HR Attendance GET error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Failed to get attendance records' },
      { status: 500 }
    );
  }
}

// PUT - Update attendance record (approve, change status, etc.)
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

    // Check if user is HR
    if (jwtPayload.role !== 'hr') {
      return NextResponse.json(
        { status: 'error', message: 'Access denied. HR only.' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { id, hr_approved, status, notes } = body;

    if (!id) {
      return NextResponse.json(
        { status: 'error', message: 'Attendance ID is required' },
        { status: 400 }
      );
    }

    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (typeof hr_approved === 'boolean') {
      updates.push(`hr_approved = $${paramIndex++}`);
      values.push(hr_approved);
    }

    if (status) {
      updates.push(`status = $${paramIndex++}`);
      values.push(status);
    }

    if (notes !== undefined) {
      updates.push(`notes = $${paramIndex++}`);
      values.push(notes);
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { status: 'error', message: 'No update fields provided' },
        { status: 400 }
      );
    }

    values.push(id);
    const updateQuery = `
      UPDATE attendance 
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const updated = await queryOne<any>(updateQuery, values);

    if (!updated) {
      return NextResponse.json(
        { status: 'error', message: 'Attendance record not found' },
        { status: 404 }
      );
    }

    console.log(`✅ HR updated attendance ID ${id}:`, { hr_approved, status, notes });

    return NextResponse.json({
      status: 'success',
      data: updated,
      message: 'Attendance updated successfully',
    });
  } catch (error) {
    console.error('HR Attendance PUT error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Failed to update attendance' },
      { status: 500 }
    );
  }
}
