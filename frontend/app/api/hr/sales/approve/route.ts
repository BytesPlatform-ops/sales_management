/**
 * API Route: /api/hr/sales/approve
 * POST - Approve or reject a sale submission
 * On approval: Updates sale status AND updates agent's daily_stats.sales_amount (Golden Ticket)
 * GET - Get all pending sales for HR review
 */

import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { query, queryOne, pool } from '@/lib/db';
import { getShiftStartTimeUTC } from '@/lib/attendance-utils';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'
);

interface Sale {
  id: string;
  agent_id: number;
  customer_name: string;
  total_deal_value: string | number;
  amount_collected: string | number;
  status: string;
  approval_status: string;
  created_at: string;
}

interface User {
  id: number;
  shift_start: string;
  shift_end: string;
  sales_target: number;
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
    
    // Only HR can approve/reject sales
    if (role !== 'hr') {
      return NextResponse.json(
        { status: 'error', message: 'Only HR can approve or reject sales' },
        { status: 403 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { saleId, action } = body;

    // Validate input
    if (!saleId) {
      return NextResponse.json(
        { status: 'error', message: 'Sale ID is required' },
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

    // Get the sale
    const saleResult = await client.query<Sale>(
      `SELECT * FROM sales WHERE id = $1 FOR UPDATE`,
      [saleId]
    );

    const sale = saleResult.rows[0];

    if (!sale) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { status: 'error', message: 'Sale not found' },
        { status: 404 }
      );
    }

    // Check if sale is still pending
    if (sale.approval_status !== 'pending') {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { status: 'error', message: `Sale has already been ${sale.approval_status}` },
        { status: 400 }
      );
    }

    const newStatus = action === 'approve' ? 'approved' : 'rejected';

    // Update the sale approval_status
    await client.query(
      `UPDATE sales 
       SET approval_status = $1, approved_at = NOW() 
       WHERE id = $2`,
      [newStatus, saleId]
    );

    let goldenTicketTriggered = false;
    let newSalesAmount = 0;

    // If approved, update the agent's daily_stats.sales_amount (Golden Ticket progress)
    if (action === 'approve') {
      // Get agent's shift info
      const userResult = await client.query<User>(
        'SELECT id, shift_start, shift_end, sales_target FROM users WHERE id = $1',
        [sale.agent_id]
      );

      const agent = userResult.rows[0];

      if (!agent) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { status: 'error', message: 'Agent not found' },
          { status: 404 }
        );
      }

      // Get the shift date for this sale (use current shift date)
      const shiftTiming = getShiftStartTimeUTC(agent.shift_start, agent.shift_end);
      const shiftDate = shiftTiming.shiftDatePKT;
      
      const totalDealValue = Number(sale.total_deal_value);
      
      console.log(`✅ Approving sale ${saleId} for agent ${sale.agent_id} on shift date: ${shiftDate}`);
      console.log(`   Deal Value: $${totalDealValue}`);

      // Upsert daily_stats: increment sales_amount (Golden Ticket progress)
      const statsResult = await client.query(
        `INSERT INTO daily_stats (user_id, date, calls_count, talk_time_seconds, leads_count, sales_amount)
         VALUES ($1, $2, 0, 0, 0, $3)
         ON CONFLICT (user_id, date)
         DO UPDATE SET 
           sales_amount = daily_stats.sales_amount + $3,
           updated_at = NOW()
         RETURNING sales_amount`,
        [sale.agent_id, shiftDate, totalDealValue]
      );

      newSalesAmount = Number(statsResult.rows[0]?.sales_amount || 0);
      
      // Check if Golden Ticket target is hit
      if (agent.sales_target > 0 && newSalesAmount >= agent.sales_target) {
        goldenTicketTriggered = true;
        console.log(`   🎫 GOLDEN TICKET TRIGGERED! Target: $${agent.sales_target}, Achieved: $${newSalesAmount}`);
      }
    }

    // Commit transaction
    await client.query('COMMIT');

    console.log(`📋 Sale ${saleId} ${newStatus} by HR user ${hrUserId}`);

    return NextResponse.json({
      status: 'success',
      message: `Sale ${newStatus} successfully`,
      data: {
        saleId,
        status: newStatus,
        agentId: sale.agent_id,
        customerName: sale.customer_name,
        dealValue: Number(sale.total_deal_value),
        goldenTicketTriggered,
        newSalesAmount,
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Sale approval error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Internal server error' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

// GET - Get all pending sales for HR review
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
        { status: 'error', message: 'Only HR can view pending sales' },
        { status: 403 }
      );
    }

    // Get all pending sales with agent info
    const sales = await query(
      `SELECT 
        s.id,
        s.agent_id,
        s.customer_name,
        s.total_deal_value,
        s.amount_collected,
        s.status,
        s.approval_status,
        s.created_at,
        u.full_name as agent_name,
        u.username as agent_username
       FROM sales s
       JOIN users u ON s.agent_id = u.id
       WHERE s.approval_status = 'pending'
       ORDER BY s.created_at ASC`
    );

    return NextResponse.json({
      status: 'success',
      data: sales
    });

  } catch (error) {
    console.error('Get pending sales error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Internal server error' },
      { status: 500 }
    );
  }
}
