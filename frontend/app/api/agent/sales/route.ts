/**
 * API Route: /api/agent/sales
 * GET - List all sales for the authenticated agent
 * POST - Create a new sale
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
  created_at: string;
  updated_at: string;
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

// GET - List all sales for the agent
export async function GET(request: NextRequest) {
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
        { status: 'error', message: 'Only agents can view sales' },
        { status: 403 }
      );
    }

    // Fetch all sales for this agent
    const sales = await query<Sale>(
      `SELECT * FROM sales 
       WHERE agent_id = $1 
       ORDER BY created_at DESC`,
      [auth.userId]
    );

    // Calculate totals
    const totals = {
      totalSales: sales.length,
      totalDealValue: sales.reduce((sum, s) => sum + Number(s.total_deal_value), 0),
      totalCollected: sales.reduce((sum, s) => sum + Number(s.amount_collected), 0),
      completedSales: sales.filter(s => s.status === 'completed').length,
      partialSales: sales.filter(s => s.status === 'partial').length,
      totalCommissionEarned: sales.reduce((sum, s) => sum + Number(s.commission_amount || 0), 0),
    };

    return NextResponse.json({
      status: 'success',
      data: {
        sales: sales.map(sale => ({
          id: sale.id,
          customerName: sale.customer_name,
          totalDealValue: Number(sale.total_deal_value),
          amountCollected: Number(sale.amount_collected),
          status: sale.status,
          commissionPaid: sale.commission_paid,
          commissionAmount: Number(sale.commission_amount || 0),
          progress: Math.round((Number(sale.amount_collected) / Number(sale.total_deal_value)) * 100),
          createdAt: sale.created_at,
          updatedAt: sale.updated_at,
        })),
        totals,
      },
    });
  } catch (error) {
    console.error('Get sales error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Failed to fetch sales' },
      { status: 500 }
    );
  }
}

// POST - Create a new sale
export async function POST(request: NextRequest) {
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
        { status: 'error', message: 'Only agents can create sales' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { customerName, totalDealValue, initialPayment } = body;

    // Validation
    if (!customerName || typeof customerName !== 'string' || customerName.trim().length === 0) {
      return NextResponse.json(
        { status: 'error', message: 'Customer name is required' },
        { status: 400 }
      );
    }

    if (typeof totalDealValue !== 'number' || totalDealValue <= 0) {
      return NextResponse.json(
        { status: 'error', message: 'Total deal value must be a positive number' },
        { status: 400 }
      );
    }

    const payment = typeof initialPayment === 'number' ? initialPayment : 0;
    if (payment < 0) {
      return NextResponse.json(
        { status: 'error', message: 'Initial payment cannot be negative' },
        { status: 400 }
      );
    }

    if (payment > totalDealValue) {
      return NextResponse.json(
        { status: 'error', message: 'Initial payment cannot exceed total deal value' },
        { status: 400 }
      );
    }

    // Determine initial status
    const status = payment >= totalDealValue ? 'completed' : 'partial';
    const commissionAmount = status === 'completed' ? totalDealValue * 0.05 : 0;

    // Get user's shift info for updating daily_stats
    const user = await queryOne<User>(
      'SELECT id, role, shift_start, shift_end FROM users WHERE id = $1',
      [auth.userId]
    );

    if (!user) {
      return NextResponse.json(
        { status: 'error', message: 'User not found' },
        { status: 404 }
      );
    }

    // Get shift date for sales_amount tracking
    const shiftTiming = getShiftStartTimeUTC(user.shift_start, user.shift_end);
    const shiftDate = shiftTiming.shiftDatePKT;

    // Insert the sale
    const saleResult = await query<Sale>(
      `INSERT INTO sales (agent_id, customer_name, total_deal_value, amount_collected, status, commission_paid, commission_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [auth.userId, customerName.trim(), totalDealValue, payment, status, status === 'completed', commissionAmount]
    );

    const sale = saleResult[0];

    // Update daily_stats with the TOTAL DEAL VALUE (for Golden Ticket progress)
    // This adds the full deal value to sales_amount immediately
    await query(
      `INSERT INTO daily_stats (user_id, date, calls_count, talk_time_seconds, leads_count, sales_amount)
       VALUES ($1, $2, 0, 0, 0, $3)
       ON CONFLICT (user_id, date)
       DO UPDATE SET 
         sales_amount = daily_stats.sales_amount + $3,
         updated_at = NOW()`,
      [auth.userId, shiftDate, totalDealValue]
    );

    console.log(`💰 Sale created for agent ${auth.userId}:`);
    console.log(`   Customer: ${customerName}`);
    console.log(`   Total Deal: $${totalDealValue}`);
    console.log(`   Initial Payment: $${payment}`);
    console.log(`   Status: ${status}`);
    console.log(`   Added to Golden Ticket progress: $${totalDealValue}`);

    // If completed immediately, log commission
    if (status === 'completed') {
      console.log(`   🎉 Commission earned: $${commissionAmount.toFixed(2)}`);
    }

    return NextResponse.json({
      status: 'success',
      message: status === 'completed' 
        ? `Sale completed! Commission of $${commissionAmount.toFixed(2)} earned!`
        : 'Sale logged successfully',
      data: {
        sale: {
          id: sale.id,
          customerName: sale.customer_name,
          totalDealValue: Number(sale.total_deal_value),
          amountCollected: Number(sale.amount_collected),
          status: sale.status,
          commissionPaid: sale.commission_paid,
          commissionAmount: Number(sale.commission_amount || 0),
          progress: Math.round((Number(sale.amount_collected) / Number(sale.total_deal_value)) * 100),
        },
        goldenTicketAdded: totalDealValue,
        commissionEarned: status === 'completed' ? commissionAmount : 0,
      },
    });
  } catch (error) {
    console.error('Create sale error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Failed to create sale' },
      { status: 500 }
    );
  }
}
