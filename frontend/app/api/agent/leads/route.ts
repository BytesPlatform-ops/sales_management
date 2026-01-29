/**
 * API Route: /api/agent/leads
 * POST - Submit a lead for verification (creates pending lead, does NOT increment stats)
 * GET - Get agent's submitted leads
 */

import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { query, queryOne } from '@/lib/db';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'
);

interface AgentLead {
  id: string;
  agent_id: number;
  customer_name: string;
  customer_email: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
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

    const userId = payload.userId as number;
    const role = payload.role as string;
    
    // Only agents can submit leads
    if (role !== 'agent') {
      return NextResponse.json(
        { status: 'error', message: 'Only agents can submit leads' },
        { status: 403 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { customerName, customerEmail } = body;

    // Validate required fields
    if (!customerName || !customerName.trim()) {
      return NextResponse.json(
        { status: 'error', message: 'Customer name is required' },
        { status: 400 }
      );
    }

    if (!customerEmail || !customerEmail.trim()) {
      return NextResponse.json(
        { status: 'error', message: 'Customer email is required' },
        { status: 400 }
      );
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(customerEmail.trim())) {
      return NextResponse.json(
        { status: 'error', message: 'Invalid email format' },
        { status: 400 }
      );
    }

    console.log(`📋 Submitting lead for verification - Agent ${userId}: ${customerName} (${customerEmail})`);
    
    // Insert into agent_leads with status 'pending'
    // This does NOT update daily_stats - that happens only on approval
    const result = await query<AgentLead>(
      `INSERT INTO agent_leads (agent_id, customer_name, customer_email, status)
       VALUES ($1, $2, $3, 'pending')
       RETURNING *`,
      [userId, customerName.trim(), customerEmail.trim()]
    );

    const lead = result[0];

    return NextResponse.json({
      status: 'success',
      message: 'Lead submitted for verification',
      data: lead
    });

  } catch (error) {
    console.error('Submit lead error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET - Get agent's submitted leads
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

    const userId = payload.userId as number;
    const role = payload.role as string;
    
    if (role !== 'agent') {
      return NextResponse.json(
        { status: 'error', message: 'Only agents can view their leads' },
        { status: 403 }
      );
    }

    // Get agent's leads from the last 30 days
    const leads = await query<AgentLead>(
      `SELECT * FROM agent_leads 
       WHERE agent_id = $1 
       AND created_at > NOW() - INTERVAL '30 days'
       ORDER BY created_at DESC`,
      [userId]
    );

    return NextResponse.json({
      status: 'success',
      data: leads
    });

  } catch (error) {
    console.error('Get leads error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Internal server error' },
      { status: 500 }
    );
  }
}
