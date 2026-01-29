import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { query, queryOne } from '@/lib/db';
import { getShiftStartTimeUTC } from '@/lib/attendance-utils';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'
);

interface User {
  id: number;
  username: string;
  extension_number: string;
  role: 'hr' | 'agent';
  shift_start: string;
  shift_end: string;
}

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
    const userId = payload.userId as number;

    // Parse request body
    const body = await request.json();
    const { amount } = body;

    // Validate amount
    if (typeof amount !== 'number' || amount <= 0) {
      return NextResponse.json(
        { status: 'error', message: 'Invalid sale amount. Must be a positive number.' },
        { status: 400 }
      );
    }

    // Limit maximum single sale to prevent abuse
    if (amount > 100000) {
      return NextResponse.json(
        { status: 'error', message: 'Sale amount exceeds maximum allowed ($100,000)' },
        { status: 400 }
      );
    }

    // Fetch user data
    const user = await queryOne<User>(
      'SELECT * FROM users WHERE id = $1',
      [userId]
    );

    if (!user) {
      return NextResponse.json(
        { status: 'error', message: 'User not found' },
        { status: 404 }
      );
    }

    if (user.role !== 'agent') {
      return NextResponse.json(
        { status: 'error', message: 'Only agents can log sales' },
        { status: 403 }
      );
    }

    // Get current shift date for the agent
    const shiftTiming = getShiftStartTimeUTC(user.shift_start, user.shift_end);
    const shiftDate = shiftTiming.shiftDatePKT;

    console.log(`💰 Logging sale for agent ${user.username}:`);
    console.log(`   Amount: $${amount}`);
    console.log(`   Shift Date: ${shiftDate}`);

    // Update or insert daily_stats with the new sale amount
    // First check if record exists for today
    interface DailyStatsRow {
      id: number;
      sales_amount: string | number;
    }
    
    const existingStats = await queryOne<DailyStatsRow>(
      `SELECT id, sales_amount FROM daily_stats WHERE user_id = $1 AND date = $2`,
      [userId, shiftDate]
    );

    let newSalesAmount: number;

    if (existingStats) {
      // Update existing record - add to current sales_amount
      const currentAmount = Number(existingStats.sales_amount || 0);
      newSalesAmount = currentAmount + amount;
      
      await query(
        `UPDATE daily_stats SET sales_amount = $1 WHERE id = $2`,
        [newSalesAmount, existingStats.id]
      );
      
      console.log(`   Updated sales_amount: $${currentAmount} -> $${newSalesAmount}`);
    } else {
      // Insert new record
      newSalesAmount = amount;
      
      await query(
        `INSERT INTO daily_stats (user_id, date, calls_count, talk_time_seconds, leads_count, sales_amount)
         VALUES ($1, $2, 0, 0, 0, $3)`,
        [userId, shiftDate, amount]
      );
      
      console.log(`   Created new daily_stats record with sales_amount: $${amount}`);
    }

    // Log the sale for audit trail
    await query(
      `INSERT INTO sale_logs (user_id, amount, logged_at, shift_date)
       VALUES ($1, $2, NOW(), $3)
       ON CONFLICT DO NOTHING`,
      [userId, amount, shiftDate]
    ).catch(() => {
      // sale_logs table might not exist, ignore error
      console.log('   Note: sale_logs table not available, skipping audit log');
    });

    // Get user's sales target
    interface UserTarget {
      sales_target: string | number;
    }
    const userTarget = await queryOne<UserTarget>(
      `SELECT sales_target FROM users WHERE id = $1`,
      [userId]
    );
    
    const salesTarget = Number(userTarget?.sales_target || 0);
    const targetHit = salesTarget > 0 && newSalesAmount >= salesTarget;

    return NextResponse.json({
      status: 'success',
      message: `Sale of $${amount.toFixed(2)} logged successfully`,
      data: {
        saleAmount: amount,
        totalSalesAmount: newSalesAmount,
        salesTarget: salesTarget,
        targetHit: targetHit,
        shiftDate: shiftDate,
      },
    });
  } catch (error) {
    console.error('Log sale API error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Failed to log sale' },
      { status: 500 }
    );
  }
}
