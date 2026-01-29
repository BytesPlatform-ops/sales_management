/**
 * API Route: /api/hr/leads/approve
 * POST - Approve or reject a lead submission
 * On approval: Updates lead status AND increments agent's daily_stats.leads_count
 */

import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { query, queryOne, pool } from '@/lib/db';
import { getShiftStartTimeUTC } from '@/lib/attendance-utils';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'
);

interface AgentLead {
  id: string;
  agent_id: number;
  customer_name: string;
  customer_email: string;
  status: string;
  created_at: string;
}

interface User {
  id: number;
  shift_start: string;
  shift_end: string;
}

export async function POST(request: NextRequest) {
  const client = await pool.connect();
  
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
    
    let payload;
    try {
      const { payload: verifiedPayload } = await jwtVerify(token, JWT_SECRET);
      payload = verifiedPayload;
    } catch {
      return NextResponse.json(
        { status: 'error', message: 'Invalid token' },
        { status: 401 }
      );
    }

    const hrUserId = payload.userId as number;
    const role = payload.role as string;
    
    // Only HR can approve/reject leads
    if (role !== 'hr') {
      return NextResponse.json(
        { status: 'error', message: 'Only HR can approve or reject leads' },
        { status: 403 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { leadId, action } = body;

    // Validate input
    if (!leadId) {
      return NextResponse.json(
        { status: 'error', message: 'Lead ID is required' },
        { status: 400 }
      );
    }

    if (!action || !['approve', 'reject'].includes(action)) {
      return NextResponse.json(
        { status: 'error', message: 'Action must be "approve" or "reject"' },
        { status: 400 }
      );
    }

    // Start transaction
    await client.query('BEGIN');

    // Get the lead
    const leadResult = await client.query<AgentLead>(
      `SELECT * FROM agent_leads WHERE id = $1 FOR UPDATE`,
      [leadId]
    );

    const lead = leadResult.rows[0];

    if (!lead) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { status: 'error', message: 'Lead not found' },
        { status: 404 }
      );
    }

    // Check if lead is still pending
    if (lead.status !== 'pending') {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { status: 'error', message: `Lead has already been ${lead.status}` },
        { status: 400 }
      );
    }

    const newStatus = action === 'approve' ? 'approved' : 'rejected';

    // Update the lead status
    await client.query(
      `UPDATE agent_leads 
       SET status = $1, reviewed_by = $2, reviewed_at = NOW() 
       WHERE id = $3`,
      [newStatus, hrUserId, leadId]
    );

    // If approved, increment the agent's daily_stats.leads_count
    if (action === 'approve') {
      // Get agent's shift info
      const userResult = await client.query<User>(
        'SELECT id, shift_start, shift_end FROM users WHERE id = $1',
        [lead.agent_id]
      );

      const agent = userResult.rows[0];

      if (!agent) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { status: 'error', message: 'Agent not found' },
          { status: 404 }
        );
      }

      // Get the shift date based on when the lead was created
      // Use the lead creation time to determine which shift day it belongs to
      const shiftTiming = getShiftStartTimeUTC(agent.shift_start, agent.shift_end);
      const shiftDate = shiftTiming.shiftDatePKT;
      
      console.log(`✅ Approving lead ${leadId} for agent ${lead.agent_id} on shift date: ${shiftDate}`);

      // Upsert daily_stats: increment leads_count
      await client.query(
        `INSERT INTO daily_stats (user_id, date, calls_count, talk_time_seconds, leads_count, sales_amount)
         VALUES ($1, $2, 0, 0, 1, 0)
         ON CONFLICT (user_id, date)
         DO UPDATE SET 
           leads_count = daily_stats.leads_count + 1,
           updated_at = NOW()`,
        [lead.agent_id, shiftDate]
      );
    }

    // Commit transaction
    await client.query('COMMIT');

    console.log(`📋 Lead ${leadId} ${newStatus} by HR user ${hrUserId}`);

    return NextResponse.json({
      status: 'success',
      message: `Lead ${newStatus} successfully`,
      data: {
        leadId,
        status: newStatus,
        agentId: lead.agent_id,
        customerName: lead.customer_name
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Lead approval error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Internal server error' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

// GET - Get all pending leads for HR review
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
    
    let payload;
    try {
      const { payload: verifiedPayload } = await jwtVerify(token, JWT_SECRET);
      payload = verifiedPayload;
    } catch {
      return NextResponse.json(
        { status: 'error', message: 'Invalid token' },
        { status: 401 }
      );
    }

    const role = payload.role as string;
    
    if (role !== 'hr') {
      return NextResponse.json(
        { status: 'error', message: 'Only HR can view pending leads' },
        { status: 403 }
      );
    }

    // Get all pending leads with agent info
    const leads = await query(
      `SELECT 
        al.id,
        al.agent_id,
        al.customer_name,
        al.customer_email,
        al.status,
        al.created_at,
        u.full_name as agent_name,
        u.username as agent_username
       FROM agent_leads al
       JOIN users u ON al.agent_id = u.id
       WHERE al.status = 'pending'
       ORDER BY al.created_at ASC`
    );

    return NextResponse.json({
      status: 'success',
      data: leads
    });

  } catch (error) {
    console.error('Get pending leads error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Internal server error' },
      { status: 500 }
    );
  }
}
