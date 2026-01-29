import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { query, queryOne } from '@/lib/db';
import bcrypt from 'bcryptjs';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'
);

interface Agent {
  id: number;
  username: string;
  full_name: string;
  extension_number: string;
  base_salary: number;
  sales_target: number;
  shift_start: string;
  shift_end: string;
  employment_type: string;
  is_active: boolean;
  created_at: string;
}

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

    // Fetch all agents
    const agents = await query<Agent>(
      `SELECT id, username, full_name, extension_number, base_salary, 
              sales_target, shift_start, shift_end, employment_type, is_active, created_at
       FROM users 
       WHERE role = 'agent'
       ORDER BY full_name ASC`
    );

    // Get today's attendance for each agent
    const today = new Date().toISOString().split('T')[0];
    const attendanceRows = await query<{ user_id: number; status: string; check_in_time: string }>(
      `SELECT user_id, status, check_in_time 
       FROM attendance 
       WHERE date = $1`,
      [today]
    );

    const attendanceMap = new Map(
      attendanceRows.map(a => [Number(a.user_id), { status: a.status, checkInTime: a.check_in_time }])
    );

    // Combine agents with their attendance
    const agentsWithAttendance = agents.map(agent => ({
      ...agent,
      id: Number(agent.id),
      base_salary: Number(agent.base_salary),
      sales_target: Number(agent.sales_target || 0),
      todayAttendance: attendanceMap.get(Number(agent.id)) || null,
    }));

    return NextResponse.json({
      status: 'success',
      data: agentsWithAttendance,
    });
  } catch (error) {
    console.error('HR agents API error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Failed to fetch agents' },
      { status: 500 }
    );
  }
}

// POST - Create new agent
export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const {
      username,
      password,
      full_name,
      extension_number,
      base_salary,
      sales_target,
      shift_start,
      shift_end,
      employment_type,
    } = body;

    // Validate required fields
    if (!username || !password || !full_name || !extension_number || !base_salary) {
      return NextResponse.json(
        { status: 'error', message: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Check if username already exists
    const existingUser = await queryOne<{ id: number }>(
      'SELECT id FROM users WHERE username = $1',
      [username]
    );

    if (existingUser) {
      return NextResponse.json(
        { status: 'error', message: 'Username already exists' },
        { status: 400 }
      );
    }

    // Check if extension number already exists
    const existingExtension = await queryOne<{ id: number }>(
      'SELECT id FROM users WHERE extension_number = $1',
      [extension_number]
    );

    if (existingExtension) {
      return NextResponse.json(
        { status: 'error', message: 'Extension number already in use' },
        { status: 400 }
      );
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Insert new agent
    const result = await query<Agent>(
      `INSERT INTO users (
        username, password, full_name, extension_number, 
        base_salary, sales_target, shift_start, shift_end, employment_type, role, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'agent', true)
      RETURNING id, username, full_name, extension_number, base_salary, 
                sales_target, shift_start, shift_end, employment_type, is_active, created_at`,
      [
        username,
        passwordHash,
        full_name,
        extension_number,
        base_salary,
        sales_target || 0,
        shift_start || '09:00:00',
        shift_end || '18:00:00',
        employment_type || 'full_time',
      ]
    );

    return NextResponse.json({
      status: 'success',
      message: 'Agent created successfully',
      data: result[0],
    });
  } catch (error) {
    console.error('Create agent error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Failed to create agent' },
      { status: 500 }
    );
  }
}
