/**
 * API Route: /api/agent/sales/[id]/payment
 * POST - Submit a payment for HR approval (does NOT update commission immediately)
 */

import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { query, queryOne } from '@/lib/db';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'
);

interface Sale {
  id: string;
  agent_id: number;
  customer_name: string;
  total_deal_value: string | number;
  amount_collected: string | number;
  status: 'partial' | 'completed';
  commission_paid: boolean;
  commission_amount: string | number;
  approval_status: string;
}

interface Payment {
  id: string;
  sale_id: string;
  agent_id: number;
  amount: string | number;
  status: string;
  created_at: string;
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
        { status: 'error', message: 'Only agents can submit payments' },
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

    // Check if sale is approved first
    if (sale.approval_status !== 'approved') {
      return NextResponse.json(
        { status: 'error', message: 'Sale must be approved before adding payments' },
        { status: 400 }
      );
    }

    if (sale.status === 'completed') {
      return NextResponse.json(
        { status: 'error', message: 'Sale is already completed' },
        { status: 400 }
      );
    }

    // Get total approved payments for this sale
    const approvedPaymentsResult = await queryOne<{ total: string }>(
      `SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE sale_id = $1 AND status = 'approved'`,
      [saleId]
    );
    const approvedPayments = Number(approvedPaymentsResult?.total || 0);
    
    // Get total pending payments for this sale
    const pendingPaymentsResult = await queryOne<{ total: string }>(
      `SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE sale_id = $1 AND status = 'pending'`,
      [saleId]
    );
    const pendingPayments = Number(pendingPaymentsResult?.total || 0);

    const totalDealValue = Number(sale.total_deal_value);
    const currentCollected = Number(sale.amount_collected);
    const remaining = totalDealValue - currentCollected - pendingPayments;

    if (amount > remaining) {
      return NextResponse.json(
        { status: 'error', message: `Payment exceeds remaining amount. Maximum allowed: $${remaining.toFixed(2)}` },
        { status: 400 }
      );
    }

    // Insert payment as pending (does NOT update sale or commission)
    const paymentResult = await query<Payment>(
      `INSERT INTO payments (sale_id, agent_id, amount, status)
       VALUES ($1, $2, $3, 'pending')
       RETURNING *`,
      [saleId, auth.userId, amount]
    );

    const payment = paymentResult[0];

    console.log(`🕒 Payment submitted for approval:`);
    console.log(`   Sale: ${sale.customer_name}`);
    console.log(`   Amount: $${amount}`);
    console.log(`   Status: pending approval`);

    return NextResponse.json({
      status: 'success',
      message: 'Payment submitted for approval.',
      data: {
        payment: {
          id: payment.id,
          saleId: payment.sale_id,
          amount: Number(payment.amount),
          status: payment.status,
        },
        sale: {
          customerName: sale.customer_name,
          totalDealValue: totalDealValue,
          amountCollected: currentCollected,
          pendingPayments: pendingPayments + amount,
          remaining: remaining - amount,
        },
      },
    });
  } catch (error) {
    console.error('Submit payment error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Failed to submit payment' },
      { status: 500 }
    );
  }
}
