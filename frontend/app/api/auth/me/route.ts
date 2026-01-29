import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { queryOne } from '@/lib/db';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'
);

interface User {
  id: number;
  username: string;
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

export async function GET(request: NextRequest) {
  try {
    // Get token from Authorization header
    const authHeader = request.headers.get('authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { status: 'error', message: 'No token provided' },
        { status: 401 }
      );
    }

    const token = authHeader.split(' ')[1];

    // Verify JWT
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const userId = payload.userId as number;

    // Fetch user from database
    const user = await queryOne<User>(
      `SELECT id, username, full_name, extension_number, role, base_salary, 
              shift_start, shift_end, employment_type, is_active, created_at, updated_at 
       FROM users WHERE id = $1`,
      [userId]
    );

    if (!user) {
      return NextResponse.json(
        { status: 'error', message: 'User not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      status: 'success',
      data: user,
    });
  } catch (error) {
    console.error('Get me error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Invalid or expired token' },
      { status: 401 }
    );
  }
}
