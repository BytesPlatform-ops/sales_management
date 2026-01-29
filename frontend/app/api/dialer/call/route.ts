import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { query, queryOne } from '@/lib/db';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'
);

const CX_HOST = process.env.CX_HOST || 'your-3cx-host.3cx.com';

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
  assigned_agent_id: number | null;
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

    // 2. Parse request body
    const body = await request.json();
    const { lead_id, agent_extension } = body;

    if (!lead_id) {
      return NextResponse.json(
        { status: 'error', message: 'lead_id is required' },
        { status: 400 }
      );
    }

    if (!agent_extension) {
      return NextResponse.json(
        { status: 'error', message: 'agent_extension is required' },
        { status: 400 }
      );
    }

    // 3. Fetch the lead from database
    const lead = await queryOne<LeadRecord>(
      'SELECT id, name, phone_number, status, assigned_agent_id FROM leads WHERE id = $1',
      [lead_id]
    );

    if (!lead) {
      return NextResponse.json(
        { status: 'error', message: 'Lead not found' },
        { status: 404 }
      );
    }

    // 4. Verify agent owns this lead (optional security check)
    if (lead.assigned_agent_id && lead.assigned_agent_id !== jwtPayload.userId) {
      return NextResponse.json(
        { status: 'error', message: 'Lead is not assigned to you' },
        { status: 403 }
      );
    }

    // 5. Construct 3CX MakeCall URL
    const phoneNumber = encodeURIComponent(lead.phone_number);
    const extension = encodeURIComponent(agent_extension);
    const makeCallUrl = `https://${CX_HOST}/api/make_call?ext=${extension}&to=${phoneNumber}`;

    console.log(`📞 Initiating call: Agent ${agent_extension} -> ${lead.phone_number} (${lead.name})`);

    // 6. Trigger 3CX MakeCall
    try {
      const callResponse = await fetch(makeCallUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!callResponse.ok) {
        const errorText = await callResponse.text();
        console.error('3CX API error:', errorText);
        
        // Still update the lead status even if 3CX fails (for testing purposes)
        // In production, you might want to handle this differently
      }
    } catch (callError) {
      console.error('3CX API call failed:', callError);
      // Continue to update lead status for testing
      // In production, you might want to return an error here
    }

    // 7. Update lead status to 'called' and set last_called_at
    const updatedLead = await queryOne<LeadRecord>(
      `UPDATE leads 
       SET status = 'called', 
           last_called_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [lead_id]
    );

    console.log(`✅ Lead ${lead_id} marked as called`);

    return NextResponse.json({
      status: 'success',
      message: `Call initiated to ${lead.name}`,
      data: {
        lead_id: lead.id,
        name: lead.name,
        phone_number: lead.phone_number,
        call_status: 'initiated',
      },
    });
  } catch (error) {
    console.error('Dialer call API error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Failed to initiate call' },
      { status: 500 }
    );
  }
}
