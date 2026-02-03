import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

interface AgentLead {
  id: string;
  agent_id: number;
  customer_name: string;
  customer_email: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by: number | null;
  reviewed_at: string | null;
  created_at: string;
}

// GET - Get all approved leads for an agent on a specific date
export async function GET(
  request: NextRequest,
  { params }: { params: { agentId: string } }
) {
  try {
    const agentId = parseInt(params.agentId, 10);
    const searchParams = request.nextUrl.searchParams;
    const date = searchParams.get('date'); // Format: YYYY-MM-DD

    if (!date || !agentId) {
      return NextResponse.json(
        { status: 'error', message: 'Missing date or agentId parameter' },
        { status: 400 }
      );
    }

    // Fetch all approved leads for the agent
    const leads = await query<AgentLead>(
      `SELECT id, agent_id, customer_name, customer_email, status, reviewed_by, reviewed_at, created_at
       FROM agent_leads
       WHERE agent_id = $1 AND status = $2
       ORDER BY created_at DESC`,
      [agentId, 'approved']
    );

    // Filter by date in application (UTC date - same as daily stats)
    // The date parameter represents: startOfDay UTC to endOfDay UTC
    const filteredLeads = leads.filter((lead) => {
      const leadDate = new Date(lead.created_at);
      const utcDateStr = leadDate.toISOString().split('T')[0];
      return utcDateStr === date;
    });

    console.log('Debug agent leads:', {
      agentId,
      date,
      totalLeads: leads.length,
      filteredLeads: filteredLeads.length,
      sampleLeads: leads.slice(0, 2).map((l) => ({
        id: l.id,
        agent_id: l.agent_id,
        status: l.status,
        created_at: l.created_at,
        utcDate: new Date(l.created_at).toISOString().split('T')[0],
        karachiDate: new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Karachi',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date(l.created_at)),
      })),
    });

    // Transform to camelCase for response
    const transformedLeads = filteredLeads.map((lead) => ({
      id: lead.id,
      agentId: lead.agent_id,
      customerName: lead.customer_name,
      customerEmail: lead.customer_email,
      status: lead.status,
      reviewedBy: lead.reviewed_by,
      reviewedAt: lead.reviewed_at,
      createdAt: lead.created_at,
    }));

    return NextResponse.json({
      status: 'success',
      data: transformedLeads,
      date,
      agentId,
    });
  } catch (error) {
    console.error('Error fetching agent leads:', error);
    return NextResponse.json(
      { status: 'error', message: 'Internal server error' },
      { status: 500 }
    );
  }
}
