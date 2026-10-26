import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { handler, ok } from '@/lib/training/http';
import { getViewer } from '@/lib/projects/core';

export const dynamic = 'force-dynamic';

/**
 * GET /api/projects/sources — clients an agent converted, to prefill a new ticket:
 * pipeline leads (interested) and sales. Anything that already has a ticket is flagged.
 * HR sees everyone's.
 */
export const GET = handler(async (request: NextRequest) => {
  const v = await getViewer(request);
  if (v.role === 'developer') return ok({ leads: [], sales: [] });
  const mine = v.role === 'agent';
  const [leads, sales] = await Promise.all([
    query<any>(
      `SELECT l.id, l.firm_name, l.contact_person, l.phone_number, l.raw_data, l.state, l.pipeline_stage, l.deal_value, l.pipeline_notes,
              u.full_name AS agent_name,
              (SELECT ticket_no FROM projects p WHERE p.lead_id = l.id ORDER BY p.id DESC LIMIT 1) AS existing_ticket
       FROM dialer_leads l LEFT JOIN users u ON u.id = l.assigned_agent_id
       WHERE l.pool = 'interested' ${mine ? 'AND l.assigned_agent_id = $1' : ''}
       ORDER BY l.updated_at DESC NULLS LAST LIMIT 100`,
      mine ? [v.userId] : []
    ),
    query<any>(
      `SELECT s.id, s.customer_name, s.total_deal_value, s.amount_collected, s.status, s.approval_status, s.created_at,
              u.full_name AS agent_name,
              (SELECT ticket_no FROM projects p WHERE p.sale_id = s.id ORDER BY p.id DESC LIMIT 1) AS existing_ticket
       FROM sales s LEFT JOIN users u ON u.id = s.agent_id
       WHERE s.approval_status <> 'rejected' ${mine ? 'AND s.agent_id = $1' : ''}
       ORDER BY s.created_at DESC LIMIT 100`,
      mine ? [v.userId] : []
    ),
  ]);
  const pick = (raw: any, re: RegExp) => {
    if (!raw || typeof raw !== 'object') return null;
    for (const [k, val] of Object.entries(raw)) if (re.test(k) && val) return String(val);
    return null;
  };
  return ok({
    leads: leads.map((l) => ({
      id: l.id, firm_name: l.firm_name, contact_person: l.contact_person, phone_number: l.phone_number, state: l.state,
      email: pick(l.raw_data, /e-?mail/i), website: pick(l.raw_data, /website|url|web/i),
      pipeline_stage: l.pipeline_stage, deal_value: l.deal_value, notes: l.pipeline_notes, agent_name: l.agent_name, existing_ticket: l.existing_ticket,
    })),
    sales: sales.map((s) => ({ ...s, total_deal_value: Number(s.total_deal_value), amount_collected: Number(s.amount_collected) })),
  });
});
