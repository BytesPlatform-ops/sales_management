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
    const { payload } = await jwtVerify(token, JWT_SECRET);
    
    // Check if user is HR
    if (payload.role !== 'hr') {
      return NextResponse.json(
        { status: 'error', message: 'Access denied. HR only.' },
        { status: 403 }
      );
    }

    // Fetch pending attendance approvals (late or half_day not yet approved)
    const pending = await query<any>(
      `SELECT a.id, a.user_id, a.date, a.status, a.check_in_time, a.notes, a.hr_approved,
              u.full_name, u.extension_number
       FROM attendance a
       JOIN users u ON a.user_id = u.id
       WHERE a.hr_approved = false 
         AND a.status IN ('late', 'half_day')
       ORDER BY a.date DESC, a.check_in_time DESC`
    );

    return NextResponse.json({
      status: 'success',
      data: pending,
    });
  } catch (error) {
    console.error('Pending approvals API error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Failed to fetch pending approvals' },
      { status: 500 }
    );
  }
}
