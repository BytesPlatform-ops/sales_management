import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

interface AgentLead {
  id: string;
  agentId: number;
  customerName: string;
  customerEmail: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy: number | null;
  reviewedAt: string | null;
  createdAt: string;
}

// GET - Get all approved leads for an agent on a specific date
export async function GET(
  request: NextRequest,
  { params }: { params: { agentId: string } }
) {
  try {
    const agentId = params.agentId;
    const searchParams = request.nextUrl.searchParams;
    const date = searchParams.get('date'); // Format: YYYY-MM-DD

    if (!date || !agentId) {
      return NextResponse.json(
        { status: 'error', message: 'Missing date or agentId parameter' },
        { status: 400 }
      );
    }

    // Fetch approved leads for the agent on the specific date
    const { data: leads, error } = await supabase
      .from('agent_leads')
      .select('*')
      .eq('agent_id', parseInt(agentId, 10))
      .eq('status', 'approved')
      .gte('created_at', `${date}T00:00:00Z`)
      .lt('created_at', `${date}T23:59:59Z`)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Supabase error:', error);
      return NextResponse.json(
        { status: 'error', message: error.message },
        { status: 500 }
      );
    }

    // Transform snake_case to camelCase
    const transformedLeads = (leads || []).map((lead: any) => ({
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
      agentId: parseInt(agentId, 10),
    });
  } catch (error) {
    console.error('Error fetching agent leads:', error);
    return NextResponse.json(
      { status: 'error', message: 'Internal server error' },
      { status: 500 }
    );
  }
}
