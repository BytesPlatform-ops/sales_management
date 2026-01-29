/**
 * API Route: /api/agent/sales/[id]/payment
 * POST - Add a payment to an existing sale
 */

import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { query, queryOne } from '@/lib/db';
import { getShiftStartTimeUTC } from '@/lib/attendance-utils';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'
);

interface User {
  id: number;
  role: string;
  shift_start: string;
  shift_end: string;
}

interface Sale {
  id: string;
  agent_id: number;
  customer_name: string;
  total_deal_value: string | number;
  amount_collected: string | number;
  status: 'partial' | 'completed';
  commission_paid: boolean;
  commission_amount: string | number;
}

async function verifyAuth(request: NextRequest): Promise<{ userId: number; role: string } | null> {
  const authHeader = request.headers.get('authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  try {
    const token = authHeader.split(' ')[1];
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return {
      userId: payload.userId as number,
      role: payload.role as string,
    };
  } catch {
    return null;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await verifyAuth(request);
    
    if (!auth) {
      return NextResponse.json(
        { status: 'error', message: 'Unauthorized' },
        { status: 401 }
      );
    }

    if (auth.role !== 'agent') {
      return NextResponse.json(
        { status: 'error', message: 'Only agents can add payments' },
        { status: 403 }
      );
    }

    const saleId = params.id;
    const body = await request.json();
    const { amount } = body;

    // Validation
    if (typeof amount !== 'number' || amount <= 0) {
      return NextResponse.json(
        { status: 'error', message: 'Payment amount must be a positive number' },
        { status: 400 }
      );
    }

    // Fetch the sale
    const sale = await queryOne<Sale>(
      `SELECT * FROM sales WHERE id = $1 AND agent_id = $2`,
      [saleId, auth.userId]
    );

    if (!sale) {
      return NextResponse.json(
        { status: 'error', message: 'Sale not found' },
        { status: 404 }
      );
    }

    if (sale.status === 'completed') {
      return NextResponse.json(
        { status: 'error', message: 'Sale is already completed' },
        { status: 400 }
      );
    }

    const currentCollected = Number(sale.amount_collected);
    const totalDealValue = Number(sale.total_deal_value);
    const remaining = totalDealValue - currentCollected;

    // Cap the payment at the remaining amount
    const actualPayment = Math.min(amount, remaining);
    const newAmountCollected = currentCollected + actualPayment;
    
    // Check if this completes the sale
    const isCompleted = newAmountCollected >= totalDealValue;
    const newStatus = isCompleted ? 'completed' : 'partial';
    
    // Calculate commission if completing
    const commissionAmount = isCompleted ? totalDealValue * 0.05 : 0;

    // Update the sale
    const updatedSale = await query<Sale>(
      `UPDATE sales 
       SET amount_collected = $1, 
           status = $2, 
           commission_paid = $3,
           commission_amount = $4
       WHERE id = $5
       RETURNING *`,
      [newAmountCollected, newStatus, isCompleted, commissionAmount, saleId]
    );

    console.log(`💳 Payment added to sale ${saleId}:`);
    console.log(`   Customer: ${sale.customer_name}`);
    console.log(`   Payment: $${actualPayment}`);
    console.log(`   New Total Collected: $${newAmountCollected} / $${totalDealValue}`);
    console.log(`   Status: ${newStatus}`);

    // If completed, add commission to daily earnings
    let commissionAddedToEarnings = false;
    if (isCompleted && !sale.commission_paid) {
      // Get user's shift info
      const user = await queryOne<User>(
        'SELECT id, role, shift_start, shift_end FROM users WHERE id = $1',
        [auth.userId]
      );

      if (user) {
        const shiftTiming = getShiftStartTimeUTC(user.shift_start, user.shift_end);
        const shiftDate = shiftTiming.shiftDatePKT;

        // Add commission to daily_stats.sales_amount as bonus
        // Note: The original deal value was already added when the sale was created
        // This commission is an additional reward for completing the sale
        await query(
          `INSERT INTO daily_stats (user_id, date, calls_count, talk_time_seconds, leads_count, sales_amount)
           VALUES ($1, $2, 0, 0, 0, $3)
           ON CONFLICT (user_id, date)
           DO UPDATE SET 
             sales_amount = daily_stats.sales_amount + $3,
             updated_at = NOW()`,
          [auth.userId, shiftDate, commissionAmount]
        );

        commissionAddedToEarnings = true;
        console.log(`   🎉 Commission earned and added to earnings: $${commissionAmount.toFixed(2)}`);
      }
    }

    const result = updatedSale[0];

    return NextResponse.json({
      status: 'success',
      message: isCompleted 
        ? `Payment received! Sale completed. Commission of $${commissionAmount.toFixed(2)} added to your earnings!`
        : `Payment of $${actualPayment.toFixed(2)} received`,
      data: {
        sale: {
          id: result.id,
          customerName: result.customer_name,
          totalDealValue: Number(result.total_deal_value),
          amountCollected: Number(result.amount_collected),
          status: result.status,
          commissionPaid: result.commission_paid,
          commissionAmount: Number(result.commission_amount || 0),
          progress: Math.round((Number(result.amount_collected) / Number(result.total_deal_value)) * 100),
        },
        paymentAmount: actualPayment,
        isCompleted,
        commissionEarned: isCompleted ? commissionAmount : 0,
        commissionAddedToEarnings,
      },
    });
  } catch (error) {
    console.error('Add payment error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Failed to add payment' },
      { status: 500 }
    );
  }
}
