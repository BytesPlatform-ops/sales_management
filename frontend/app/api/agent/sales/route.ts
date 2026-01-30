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

    // Insert the sale as pending approval
    const saleResult = await query<Sale>(
      `INSERT INTO sales (agent_id, customer_name, total_deal_value, amount_collected, status, commission_paid, commission_amount, approval_status)
       VALUES ($1, $2, $3, $4, 'partial', false, 0, 'pending')
       RETURNING *`,
      [auth.userId, customerName.trim(), totalDealValue, payment]
    );

    const sale = saleResult[0];

    console.log(`🕒 Sale submitted for approval by agent ${auth.userId}:`);
    console.log(`   Customer: ${customerName}`);
    console.log(`   Total Deal: $${totalDealValue}`);
    console.log(`   Initial Payment: $${payment}`);
    console.log(`   Status: pending approval`);

    return NextResponse.json({
      status: 'success',
      message: 'Sale submitted for approval.',
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
