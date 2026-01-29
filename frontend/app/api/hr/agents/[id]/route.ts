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
}

// Helper to verify HR access
async function verifyHRAccess(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { error: 'No token provided', status: 401 };
  }

  const token = authHeader.split(' ')[1];
  const { payload } = await jwtVerify(token, JWT_SECRET);
  
  if (payload.role !== 'hr') {
    return { error: 'Access denied. HR only.', status: 403 };
  }

  return { payload };
}

// GET - Get single agent by ID
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await verifyHRAccess(request);
    if ('error' in auth) {
      return NextResponse.json(
        { status: 'error', message: auth.error },
        { status: auth.status }
      );
    }

    const { id } = await params;
    const agentId = parseInt(id, 10);

    if (isNaN(agentId)) {
      return NextResponse.json(
        { status: 'error', message: 'Invalid agent ID' },
        { status: 400 }
      );
    }

    const agent = await queryOne<Agent>(
      `SELECT id, username, full_name, extension_number, base_salary, 
              sales_target, shift_start, shift_end, employment_type, is_active
       FROM users 
       WHERE id = $1 AND role = 'agent'`,
      [agentId]
    );

    if (!agent) {
      return NextResponse.json(
        { status: 'error', message: 'Agent not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      status: 'success',
      data: {
        ...agent,
        id: Number(agent.id),
        base_salary: Number(agent.base_salary),
        sales_target: Number(agent.sales_target || 0),
      },
    });
  } catch (error) {
    console.error('Get agent error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Failed to fetch agent' },
      { status: 500 }
    );
  }
}

// PUT - Update agent
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await verifyHRAccess(request);
    if ('error' in auth) {
      return NextResponse.json(
        { status: 'error', message: auth.error },
        { status: auth.status }
      );
    }

    const { id } = await params;
    const agentId = parseInt(id, 10);

    if (isNaN(agentId)) {
      return NextResponse.json(
        { status: 'error', message: 'Invalid agent ID' },
        { status: 400 }
      );
    }

    // Check if agent exists
    const existingAgent = await queryOne<Agent>(
      'SELECT id, username, extension_number FROM users WHERE id = $1 AND role = $2',
      [agentId, 'agent']
    );

    if (!existingAgent) {
      return NextResponse.json(
        { status: 'error', message: 'Agent not found' },
        { status: 404 }
      );
    }

    const body = await request.json();
    const {
      full_name,
      username,
      password, // Optional - only update if provided
      extension_number,
      base_salary,
      sales_target,
      shift_start,
      shift_end,
      employment_type,
      is_active,
    } = body;

    // Check if new username conflicts with existing (if changed)
    if (username && username !== existingAgent.username) {
      const usernameExists = await queryOne<{ id: number }>(
        'SELECT id FROM users WHERE username = $1 AND id != $2',
        [username, agentId]
      );
      if (usernameExists) {
        return NextResponse.json(
          { status: 'error', message: 'Username already exists' },
          { status: 400 }
        );
      }
    }

    // Check if new extension conflicts with existing (if changed)
    if (extension_number && extension_number !== existingAgent.extension_number) {
      const extensionExists = await queryOne<{ id: number }>(
        'SELECT id FROM users WHERE extension_number = $1 AND id != $2',
        [extension_number, agentId]
      );
      if (extensionExists) {
        return NextResponse.json(
          { status: 'error', message: 'Extension number already in use' },
          { status: 400 }
        );
      }
    }

    // Build dynamic update query
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (full_name !== undefined) {
      updates.push(`full_name = $${paramIndex++}`);
      values.push(full_name);
    }
    if (username !== undefined) {
      updates.push(`username = $${paramIndex++}`);
      values.push(username);
    }
    if (password) {
      const passwordHash = await bcrypt.hash(password, 10);
      updates.push(`password = $${paramIndex++}`);
      values.push(passwordHash);
    }
    if (extension_number !== undefined) {
      updates.push(`extension_number = $${paramIndex++}`);
      values.push(extension_number);
    }
    if (base_salary !== undefined) {
      updates.push(`base_salary = $${paramIndex++}`);
      values.push(base_salary);
    }
    if (sales_target !== undefined) {
      updates.push(`sales_target = $${paramIndex++}`);
      values.push(sales_target);
    }
    if (shift_start !== undefined) {
      updates.push(`shift_start = $${paramIndex++}`);
      values.push(shift_start);
    }
    if (shift_end !== undefined) {
      updates.push(`shift_end = $${paramIndex++}`);
      values.push(shift_end);
    }
    if (employment_type !== undefined) {
      updates.push(`employment_type = $${paramIndex++}`);
      values.push(employment_type);
    }
    if (is_active !== undefined) {
      updates.push(`is_active = $${paramIndex++}`);
      values.push(is_active);
    }

    // Always update updated_at
    updates.push(`updated_at = CURRENT_TIMESTAMP`);

    if (updates.length === 1) {
      return NextResponse.json(
        { status: 'error', message: 'No fields to update' },
        { status: 400 }
      );
    }

    // Add agent ID as the last parameter
    values.push(agentId);

    const updatedAgent = await queryOne<Agent>(
      `UPDATE users 
       SET ${updates.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING id, username, full_name, extension_number, base_salary, 
                 sales_target, shift_start, shift_end, employment_type, is_active`,
      values
    );

    console.log(`✅ Agent updated: ${updatedAgent?.full_name} (ID: ${agentId})`);

    return NextResponse.json({
      status: 'success',
      message: 'Agent updated successfully',
      data: {
        ...updatedAgent,
        id: Number(updatedAgent?.id),
        base_salary: Number(updatedAgent?.base_salary),
        sales_target: Number(updatedAgent?.sales_target || 0),
      },
    });
  } catch (error) {
    console.error('Update agent error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Failed to update agent' },
      { status: 500 }
    );
  }
}

// DELETE - Soft delete agent (set is_active = false)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await verifyHRAccess(request);
    if ('error' in auth) {
      return NextResponse.json(
        { status: 'error', message: auth.error },
        { status: auth.status }
      );
    }

    const { id } = await params;
    const agentId = parseInt(id, 10);

    if (isNaN(agentId)) {
      return NextResponse.json(
        { status: 'error', message: 'Invalid agent ID' },
        { status: 400 }
      );
    }

    // Check if agent exists
    const existingAgent = await queryOne<Agent>(
      'SELECT id, full_name, is_active FROM users WHERE id = $1 AND role = $2',
      [agentId, 'agent']
    );

    if (!existingAgent) {
      return NextResponse.json(
        { status: 'error', message: 'Agent not found' },
        { status: 404 }
      );
    }

    // Soft delete - set is_active = false
    await query(
      `UPDATE users 
       SET is_active = false, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [agentId]
    );

    console.log(`🗑️ Agent deactivated: ${existingAgent.full_name} (ID: ${agentId})`);

    return NextResponse.json({
      status: 'success',
      message: `Agent "${existingAgent.full_name}" has been deactivated`,
    });
  } catch (error) {
    console.error('Delete agent error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Failed to deactivate agent' },
      { status: 500 }
    );
  }
}
