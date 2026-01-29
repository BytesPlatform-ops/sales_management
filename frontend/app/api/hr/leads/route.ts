import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { query } from '@/lib/db';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'
);

interface JwtPayload {
  userId: number;
  username: string;
  role: string;
}

interface LeadInput {
  name: string;
  phone_number: string;
  website?: string;
  notes?: string;
}

export async function POST(request: NextRequest) {
  try {
    // 1. Verify JWT token
    const authHeader = request.headers.get('authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { status: 'error', message: 'No token provided' },
        { status: 401 }
      );
    }

    const token = authHeader.split(' ')[1];
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const jwtPayload = payload as unknown as JwtPayload;

    // 2. Check if user is HR
    if (jwtPayload.role !== 'hr') {
      return NextResponse.json(
        { status: 'error', message: 'Access denied. HR only.' },
        { status: 403 }
      );
    }

    // 3. Parse request body
    const body = await request.json();
    const { agent_id, leads } = body as { agent_id: number; leads: LeadInput[] };

    if (!agent_id) {
      return NextResponse.json(
        { status: 'error', message: 'agent_id is required' },
        { status: 400 }
      );
    }

    if (!leads || !Array.isArray(leads) || leads.length === 0) {
      return NextResponse.json(
        { status: 'error', message: 'leads array is required' },
        { status: 400 }
      );
    }

    // 4. Validate leads
    const validLeads = leads.filter(
      (lead) => lead.name && lead.phone_number
    );

    if (validLeads.length === 0) {
      return NextResponse.json(
        { status: 'error', message: 'No valid leads found (name and phone_number required)' },
        { status: 400 }
      );
    }

    // 5. Build bulk insert query
    const values: any[] = [];
    const placeholders: string[] = [];
    let paramIndex = 1;

    for (const lead of validLeads) {
      placeholders.push(
        `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`
      );
      values.push(
        lead.name,
        lead.phone_number,
        'pending',
        agent_id,
        lead.notes || null
      );
    }

    const insertQuery = `
      INSERT INTO leads (name, phone_number, status, assigned_agent_id, notes)
      VALUES ${placeholders.join(', ')}
      RETURNING id
    `;

    const result = await query<{ id: number }>(insertQuery, values);

    console.log(`✅ HR imported ${result.length} leads for agent ${agent_id}`);

    return NextResponse.json({
      status: 'success',
      message: `Successfully imported ${result.length} leads`,
      data: {
        count: result.length,
        agent_id,
      },
    });
  } catch (error) {
    console.error('Leads import API error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Failed to import leads' },
      { status: 500 }
    );
  }
}

// GET - Get leads for an agent (optional - for viewing)
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
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const jwtPayload = payload as unknown as JwtPayload;

    // Check if user is HR
    if (jwtPayload.role !== 'hr') {
      return NextResponse.json(
        { status: 'error', message: 'Access denied. HR only.' },
        { status: 403 }
      );
    }

    // Get agent_id from query params (optional)
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agent_id');

    let leadsQuery = `
      SELECT l.*, u.full_name as agent_name
      FROM leads l
      LEFT JOIN users u ON l.assigned_agent_id = u.id
    `;
    const params: any[] = [];

    if (agentId) {
      leadsQuery += ' WHERE l.assigned_agent_id = $1';
      params.push(agentId);
    }

    leadsQuery += ' ORDER BY l.created_at DESC LIMIT 100';

    const leads = await query<any>(leadsQuery, params);

    // Get summary stats
    const statsQuery = `
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'called') as called,
        COUNT(*) FILTER (WHERE status = 'busy') as busy,
        COUNT(*) FILTER (WHERE status = 'bad_number') as bad_number
      FROM leads
      ${agentId ? 'WHERE assigned_agent_id = $1' : ''}
    `;

    const stats = await query<any>(statsQuery, agentId ? [agentId] : []);

    return NextResponse.json({
      status: 'success',
      data: leads,
      stats: stats[0] || {},
    });
  } catch (error) {
    console.error('Leads GET API error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Failed to fetch leads' },
      { status: 500 }
    );
  }
}
