/**
 * API Route: /api/hr/payments/approve
 * POST - Approve or reject a payment submission
 * On approval: Updates sale's amount_collected, checks for completion, updates commission
 * GET - Get all pending payments for HR review
 */

import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { query, queryOne, pool } from '@/lib/db';
import { getShiftStartTimeUTC } from '@/lib/attendance-utils';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'
);

interface Payment {
  id: string;
  sale_id: string;
  agent_id: number;
  amount: string | number;
  status: string;
  created_at: string;
}

interface Sale {
  id: string;
  agent_id: number;
  customer_name: string;
  total_deal_value: string | number;
  amount_collected: string | number;
  status: string;
  commission_paid: boolean;
  commission_amount: string | number;
  approval_status: string;
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
    
    // Only HR can approve/reject payments
    if (role !== 'hr') {
      return NextResponse.json(
        { status: 'error', message: 'Only HR can approve or reject payments' },
        { status: 403 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { paymentId, action } = body;

    // Validate input
    if (!paymentId) {
      return NextResponse.json(
        { status: 'error', message: 'Payment ID is required' },
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

    // Get the payment
    const paymentResult = await client.query<Payment>(
      `SELECT * FROM payments WHERE id = $1 FOR UPDATE`,
      [paymentId]
    );

    const payment = paymentResult.rows[0];

    if (!payment) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { status: 'error', message: 'Payment not found' },
        { status: 404 }
      );
    }

    // Check if payment is still pending
    if (payment.status !== 'pending') {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { status: 'error', message: `Payment has already been ${payment.status}` },
        { status: 400 }
      );
    }

    const newStatus = action === 'approve' ? 'approved' : 'rejected';

    // Update the payment status
    await client.query(
      `UPDATE payments 
       SET status = $1, reviewed_by = $2, reviewed_at = NOW() 
       WHERE id = $3`,
      [newStatus, hrUserId, paymentId]
    );

    let saleCompleted = false;
    let commissionEarned = 0;

    // If approved, update the sale
    if (action === 'approve') {
      // Get the sale
      const saleResult = await client.query<Sale>(
        `SELECT * FROM sales WHERE id = $1 FOR UPDATE`,
        [payment.sale_id]
      );

      const sale = saleResult.rows[0];

      if (!sale) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { status: 'error', message: 'Sale not found' },
          { status: 404 }
        );
      }

      const paymentAmount = Number(payment.amount);
      const currentCollected = Number(sale.amount_collected);
      const totalDealValue = Number(sale.total_deal_value);
      const newAmountCollected = currentCollected + paymentAmount;
      
      // Check if this completes the sale
      const isCompleted = newAmountCollected >= totalDealValue;
      const newSaleStatus = isCompleted ? 'completed' : 'partial';
      
      // Calculate commission if completing (5% of total deal value)
      commissionEarned = isCompleted && !sale.commission_paid ? totalDealValue * 0.05 : 0;

      // Update the sale
      await client.query(
        `UPDATE sales 
         SET amount_collected = $1, 
             status = $2, 
             commission_paid = $3,
             commission_amount = $4
         WHERE id = $5`,
        [newAmountCollected, newSaleStatus, isCompleted, commissionEarned, payment.sale_id]
      );

      saleCompleted = isCompleted;

      console.log(`✅ Payment ${paymentId} approved:`);
      console.log(`   Sale: ${sale.customer_name}`);
      console.log(`   Payment Amount: $${paymentAmount}`);
      console.log(`   New Amount Collected: $${newAmountCollected} / $${totalDealValue}`);
      console.log(`   Sale Status: ${newSaleStatus}`);

      // If sale is completed, add commission to agent's earnings
      if (isCompleted && commissionEarned > 0) {
        // Get agent's shift info
        const userResult = await client.query<User>(
          'SELECT id, shift_start, shift_end, sales_target FROM users WHERE id = $1',
          [sale.agent_id]
        );

        const agent = userResult.rows[0];

        if (agent) {
          const shiftTiming = getShiftStartTimeUTC(agent.shift_start, agent.shift_end);
          const shiftDate = shiftTiming.shiftDatePKT;

          // Add commission to daily_stats.sales_amount
          await client.query(
            `INSERT INTO daily_stats (user_id, date, calls_count, talk_time_seconds, leads_count, sales_amount)
             VALUES ($1, $2, 0, 0, 0, $3)
             ON CONFLICT (user_id, date)
             DO UPDATE SET 
               sales_amount = daily_stats.sales_amount + $3,
               updated_at = NOW()`,
            [sale.agent_id, shiftDate, commissionEarned]
          );

          console.log(`   🎉 Commission earned: $${commissionEarned.toFixed(2)}`);
        }
      }
    }

    // Commit transaction
    await client.query('COMMIT');

    console.log(`📋 Payment ${paymentId} ${newStatus} by HR user ${hrUserId}`);

    return NextResponse.json({
      status: 'success',
      message: `Payment ${newStatus} successfully`,
      data: {
        paymentId,
        status: newStatus,
        agentId: payment.agent_id,
        amount: Number(payment.amount),
        saleCompleted,
        commissionEarned,
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Payment approval error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Internal server error' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

// GET - Get all pending payments for HR review
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
        { status: 'error', message: 'Only HR can view pending payments' },
        { status: 403 }
      );
    }

    // Get all pending payments with sale and agent info
    const payments = await query(
      `SELECT 
        p.id,
        p.sale_id,
        p.agent_id,
        p.amount,
        p.status,
        p.created_at,
        s.customer_name,
        s.total_deal_value,
        s.amount_collected,
        s.status as sale_status,
        u.full_name as agent_name,
        u.username as agent_username
       FROM payments p
       JOIN sales s ON p.sale_id = s.id
       JOIN users u ON p.agent_id = u.id
       WHERE p.status = 'pending'
       ORDER BY p.created_at ASC`
    );

    return NextResponse.json({
      status: 'success',
      data: payments
    });

  } catch (error) {
    console.error('Get pending payments error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Internal server error' },
      { status: 500 }
    );
  }
}
