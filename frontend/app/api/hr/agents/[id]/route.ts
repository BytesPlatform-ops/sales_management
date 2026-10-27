import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { query, queryOne } from '@/lib/db';
import { shiftCallTotalsSql } from '@/lib/call-stats';
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

// HR-editable personal/profile columns. Dates are returned as YYYY-MM-DD strings
// (to_char) so pg doesn't shift them through a local-time Date.
const PROFILE_TEXT_FIELDS = [
  'phone',
  'personal_email',
  'cnic',
  'address',
  'emergency_contact_name',
  'emergency_contact_phone',
  'bank_name',
  'bank_account_title',
  'bank_account_number',
] as const;
const PROFILE_DATE_FIELDS = ['date_of_joining', 'date_of_birth'] as const;

const PROFILE_SELECT = [
  ...PROFILE_TEXT_FIELDS,
  ...PROFILE_DATE_FIELDS.map((f) => `to_char(${f}, 'YYYY-MM-DD') AS ${f}`),
].join(', ');

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

    const agent = await queryOne<Agent & Record<string, any>>(
      `SELECT id, username, full_name, extension_number, base_salary, 
              sales_target, shift_start, shift_end, employment_type, is_active,
              created_at, ${PROFILE_SELECT}
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

    // Month-to-date and lifetime activity for the profile page
    const monthStart = `to_char(date_trunc('month', (NOW() AT TIME ZONE 'Asia/Karachi')), 'YYYY-MM-DD')::date`;

    const attendance = await queryOne<Record<string, string>>(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'on_time') AS on_time,
         COUNT(*) FILTER (WHERE status = 'late') AS late,
         COUNT(*) FILTER (WHERE status = 'half_day') AS half_day,
         COUNT(*) FILTER (WHERE status = 'absent') AS absent
       FROM attendance
       WHERE user_id = $1 AND date >= ${monthStart}`,
      [agentId]
    );

    // Per shift date: calls and call talk time from call_logs (lib/call-stats.ts)
    // plus HR-added meeting time; daily_stats alone on days without call_logs.
    const statsSql = (fromDate: string) =>
      `WITH c AS ${shiftCallTotalsSql(fromDate, 'CURRENT_DATE + 1', 'AND u.id = $1')},
            d AS (SELECT date::text AS date, calls_count, talk_time_seconds,
                         COALESCE(meeting_seconds, 0) AS meeting_seconds, leads_count
                    FROM daily_stats WHERE user_id = $1 AND date >= ${fromDate})
       SELECT COALESCE(SUM(CASE WHEN c.date IS NOT NULL THEN c.calls_count ELSE d.calls_count END), 0) AS calls,
              COALESCE(SUM(CASE WHEN c.date IS NOT NULL THEN c.talk_time_seconds + COALESCE(d.meeting_seconds, 0)
                                ELSE d.talk_time_seconds END), 0) AS talk_time_seconds,
              COALESCE(SUM(d.leads_count), 0) AS leads,
              COUNT(*) AS days_worked
         FROM d FULL JOIN c ON c.date = d.date`;
    const monthStats = await queryOne<Record<string, string>>(statsSql(monthStart), [agentId]);
    const lifetimeStats = await queryOne<Record<string, string>>(statsSql(`'2000-01-01'::date`), [agentId]);

    const salesSql = (where: string) =>
      `SELECT COUNT(*) AS count, COALESCE(SUM(amount_collected), 0) AS collected
       FROM sales
       WHERE agent_id = $1 AND approval_status = 'approved' ${where}`;
    const monthSales = await queryOne<Record<string, string>>(
      salesSql(`AND (created_at AT TIME ZONE 'Asia/Karachi')::date >= ${monthStart}`),
      [agentId]
    );
    const lifetimeSales = await queryOne<Record<string, string>>(salesSql(''), [agentId]);

    const toStats = (s: Record<string, string> | null, sales: Record<string, string> | null) => ({
      calls: Number(s?.calls || 0),
      talk_time_seconds: Number(s?.talk_time_seconds || 0),
      leads: Number(s?.leads || 0),
      days_worked: Number(s?.days_worked || 0),
      sales_count: Number(sales?.count || 0),
      sales_collected: Number(sales?.collected || 0),
    });

    return NextResponse.json({
      status: 'success',
      data: {
        ...agent,
        id: Number(agent.id),
        base_salary: Number(agent.base_salary),
        sales_target: Number(agent.sales_target || 0),
        summary: {
          attendance_this_month: {
            on_time: Number(attendance?.on_time || 0),
            late: Number(attendance?.late || 0),
            half_day: Number(attendance?.half_day || 0),
            absent: Number(attendance?.absent || 0),
          },
          this_month: toStats(monthStats, monthSales),
          lifetime: toStats(lifetimeStats, lifetimeSales),
        },
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

    for (const field of PROFILE_DATE_FIELDS) {
      const value = body[field];
      if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return NextResponse.json(
          { status: 'error', message: `Invalid ${field.replace(/_/g, ' ')}` },
          { status: 400 }
        );
      }
    }

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

    // Profile fields: empty string clears the value
    for (const field of [...PROFILE_TEXT_FIELDS, ...PROFILE_DATE_FIELDS]) {
      if (body[field] !== undefined) {
        const value = typeof body[field] === 'string' ? body[field].trim() : body[field];
        updates.push(`${field} = $${paramIndex++}`);
        values.push(value === '' ? null : value);
      }
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
                 sales_target, shift_start, shift_end, employment_type, is_active,
                 ${PROFILE_SELECT}`,
      values
    );

    // If agent was deactivated via update, return their pending leads to fresh pool
    let returnedLeadsCount = 0;
    if (is_active === false) {
      const returnedLeads = await query(
        `UPDATE dialer_leads
         SET pool = 'fresh', assigned_agent_id = NULL, assigned_date = NULL, updated_at = NOW()
         WHERE assigned_agent_id = $1 AND call_outcome = 'pending' AND pool = 'active'
         RETURNING id`,
        [agentId]
      );
      returnedLeadsCount = returnedLeads.length;
    }

    console.log(`✅ Agent updated: ${updatedAgent?.full_name} (ID: ${agentId})${returnedLeadsCount > 0 ? `, ${returnedLeadsCount} leads returned to fresh pool` : ''}`);

    return NextResponse.json({
      status: 'success',
      message: returnedLeadsCount > 0
        ? `Agent updated. ${returnedLeadsCount} pending leads returned to pool.`
        : 'Agent updated successfully',
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

    // Return agent's pending leads to fresh pool
    const returnedLeads = await query(
      `UPDATE dialer_leads
       SET pool = 'fresh', assigned_agent_id = NULL, assigned_date = NULL, updated_at = NOW()
       WHERE assigned_agent_id = $1 AND call_outcome = 'pending' AND pool = 'active'
       RETURNING id`,
      [agentId]
    );

    console.log(`🗑️ Agent deactivated: ${existingAgent.full_name} (ID: ${agentId}), ${returnedLeads.length} leads returned to fresh pool`);

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
