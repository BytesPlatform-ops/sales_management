import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { distributeLeads } from '@/lib/auto-distribute';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'
);

interface JwtPayload {
  userId: number;
  username: string;
  role: string;
}

/**
 * POST /api/hr/dialer-leads/distribute
 * Manual distribution by HR with priority: callbacks → recycled → fresh
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ status: 'error', message: 'No token provided' }, { status: 401 });
    }

    const token = authHeader.split(' ')[1];
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const jwt = payload as unknown as JwtPayload;

    if (jwt.role !== 'hr') {
      return NextResponse.json({ status: 'error', message: 'Access denied. HR only.' }, { status: 403 });
    }

    const body = await request.json();
    const leadsPerAgent = body.leads_per_agent || 200;
    const agentIds: number[] | undefined = body.agent_ids;

    const result = await distributeLeads(leadsPerAgent, agentIds);

    return NextResponse.json({
      status: 'success',
      message: result.message,
      data: result,
    });
  } catch (error) {
    console.error('Distribute leads error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Failed to distribute leads' },
      { status: 500 }
    );
  }
}
