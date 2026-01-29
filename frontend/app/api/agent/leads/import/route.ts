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

// POST - Agent imports their own leads
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

    // 2. Parse request body
    const body = await request.json();
    const { leads } = body as { leads: LeadInput[] };

    if (!leads || !Array.isArray(leads) || leads.length === 0) {
      return NextResponse.json(
        { status: 'error', message: 'leads array is required' },
        { status: 400 }
      );
    }

    // 3. Validate leads
    const validLeads = leads.filter(
      (lead) => lead.name && lead.phone_number
    );

    if (validLeads.length === 0) {
      return NextResponse.json(
        { status: 'error', message: 'No valid leads found (name and phone_number required)' },
        { status: 400 }
      );
    }

    // 4. Build bulk insert query - assign to current agent
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
        jwtPayload.userId, // Assign to the logged-in agent
        lead.notes || null
      );
    }

    const insertQuery = `
      INSERT INTO leads (name, phone_number, status, assigned_agent_id, notes)
      VALUES ${placeholders.join(', ')}
      RETURNING id
    `;

    const result = await query<{ id: number }>(insertQuery, values);

    console.log(`✅ Agent ${jwtPayload.userId} imported ${result.length} leads`);

    return NextResponse.json({
      status: 'success',
      message: `Successfully imported ${result.length} leads`,
      data: {
        count: result.length,
      },
    });
  } catch (error) {
    console.error('Agent leads import API error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Failed to import leads' },
      { status: 500 }
    );
  }
}

// GET - Get agent's own leads
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

    // Get agent's leads
    const leads = await query<any>(
      `SELECT id, name, phone_number, status, last_called_at, notes, created_at
       FROM leads 
       WHERE assigned_agent_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [jwtPayload.userId]
    );

    // Get summary stats
    const stats = await query<any>(
      `SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'called') as called,
        COUNT(*) FILTER (WHERE status = 'busy') as busy,
        COUNT(*) FILTER (WHERE status = 'bad_number') as bad_number
       FROM leads
       WHERE assigned_agent_id = $1`,
      [jwtPayload.userId]
    );

    return NextResponse.json({
      status: 'success',
      data: leads,
      stats: stats[0] || {},
    });
  } catch (error) {
    console.error('Agent leads GET API error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Failed to fetch leads' },
      { status: 500 }
    );
  }
}
