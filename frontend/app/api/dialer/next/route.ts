import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { query, queryOne } from '@/lib/db';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'
);

interface JwtPayload {
  userId: number;
  username: string;
  role: string;
}

interface LeadRecord {
  id: number;
  name: string;
  phone_number: string;
  status: string;
  assigned_agent_id: number;
  last_called_at: string | null;
  created_at: string;
  website: string | null;
  notes: string | null;
}

export async function GET(request: NextRequest) {
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

    // 2. Query for the next pending lead assigned to this agent
    // Order by created_at to process leads in FIFO order
    const nextLead = await queryOne<LeadRecord>(
      `SELECT id, name, phone_number, status, assigned_agent_id, last_called_at, created_at, website, notes
       FROM leads 
       WHERE assigned_agent_id = $1 
         AND status = 'pending'
       ORDER BY created_at ASC
       LIMIT 1`,
      [jwtPayload.userId]
    );

    // 3. Check if there are any pending leads
    if (!nextLead) {
      return NextResponse.json({
        status: 'success',
        message: 'List Complete',
        data: null,
        hasMore: false,
        upcoming: [],
      });
    }

    // 4. Get upcoming leads (next 10 after the current one)
    const upcomingLeads = await query<LeadRecord>(
      `SELECT id, name, phone_number, status, assigned_agent_id, last_called_at, created_at, website, notes
       FROM leads 
       WHERE assigned_agent_id = $1 
         AND status = 'pending'
         AND id != $2
       ORDER BY created_at ASC
       LIMIT 10`,
      [jwtPayload.userId, nextLead.id]
    );

    // 5. Return the next lead with upcoming list
    return NextResponse.json({
      status: 'success',
      data: {
        id: nextLead.id,
        name: nextLead.name,
        phone_number: nextLead.phone_number,
        status: nextLead.status,
        website: nextLead.website,
        notes: nextLead.notes,
        last_called_at: nextLead.last_called_at,
        created_at: nextLead.created_at,
      },
      hasMore: true,
      upcoming: upcomingLeads.map(lead => ({
        id: lead.id,
        name: lead.name,
        phone_number: lead.phone_number,
        website: lead.website,
        notes: lead.notes,
      })),
    });
  } catch (error) {
    console.error('Get next lead API error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Failed to get next lead' },
      { status: 500 }
    );
  }
}
