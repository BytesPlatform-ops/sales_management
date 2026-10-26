import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { getViewer, visibilityClause, systemMessage, openNextCycle, OPEN_STATUSES, normalizeProject } from '@/lib/projects/core';

export const dynamic = 'force-dynamic';

const SERVICES = ['website_new', 'revamp', 'seo', 'smm', 'automation', 'contract_mgmt', 'other'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const RECURRENCES = ['weekly', 'monthly', 'quarterly'];

/**
 * GET /api/projects?view=active|recurring|closed|all&q=&mine=1
 * Projects the viewer can see, with people, next meeting, unread count and
 * deadline flags.
 */
export const GET = handler(async (request: NextRequest) => {
  const v = await getViewer(request);
  const sp = new URL(request.url).searchParams;
  const view = sp.get('view') || 'active';
  const q = (sp.get('q') || '').trim();
  const where: string[] = [visibilityClause(v)];
  const params: any[] = [v.userId];

  if (view === 'active') where.push(`p.status = ANY(ARRAY['${OPEN_STATUSES.join("','")}'])`);
  else if (view === 'recurring') where.push(`p.project_type = 'recurring' AND p.status NOT IN ('closed', 'cancelled')`);
  else if (view === 'closed') where.push(`p.status IN ('closed', 'cancelled')`);
  if (sp.get('mine') === '1' && v.role === 'hr') where.push(`(p.supervisor_id = $1 OR p.created_by = $1)`);
  if (q) {
    params.push(`%${q}%`);
    where.push(`(p.title ILIKE $${params.length} OR p.ticket_no ILIKE $${params.length} OR p.client_name ILIKE $${params.length} OR p.client_company ILIKE $${params.length})`);
  }

  const rows = await query<any>(
    `SELECT p.*, cu.full_name AS created_by_name, su.full_name AS supervisor_name,
            COALESCE((SELECT json_agg(json_build_object('id', u.id, 'name', u.full_name, 'member_role', m.member_role) ORDER BY u.full_name)
                      FROM project_members m JOIN users u ON u.id = m.user_id WHERE m.project_id = p.id), '[]') AS members,
            (SELECT COUNT(*) FROM project_messages msg WHERE msg.project_id = p.id
               AND msg.id > COALESCE((SELECT last_read_message_id FROM project_reads r WHERE r.project_id = p.id AND r.user_id = $1), 0)
               AND COALESCE(msg.user_id, 0) <> $1)::int AS unread,
            (SELECT json_build_object('id', mt.id, 'title', mt.title, 'starts_at', mt.starts_at, 'kind', mt.kind)
               FROM project_meetings mt WHERE mt.project_id = p.id AND mt.status = 'scheduled' AND mt.starts_at >= NOW()
               ORDER BY mt.starts_at LIMIT 1) AS next_meeting,
            (SELECT COUNT(*) FILTER (WHERE status = 'done')::int || '/' || COUNT(*)::int FROM project_milestones ms WHERE ms.project_id = p.id) AS milestones_done,
            (SELECT json_build_object('cycle_no', c.cycle_no, 'period_start', c.period_start, 'period_end', c.period_end, 'status', c.status)
               FROM project_cycles c WHERE c.project_id = p.id ORDER BY c.cycle_no DESC LIMIT 1) AS current_cycle,
            (p.deadline IS NOT NULL AND p.deadline < CURRENT_DATE AND p.status NOT IN ('delivered', 'closed', 'cancelled')) AS overdue
     FROM projects p
     LEFT JOIN users cu ON cu.id = p.created_by
     LEFT JOIN users su ON su.id = p.supervisor_id
     WHERE ${where.join(' AND ')}
     ORDER BY (p.deadline IS NULL), p.deadline ASC, p.updated_at DESC
     LIMIT 300`,
    params
  );

  const counts = await queryOne<any>(
    `SELECT COUNT(*) FILTER (WHERE p.status = ANY(ARRAY['${OPEN_STATUSES.join("','")}']))::int AS active,
            COUNT(*) FILTER (WHERE p.project_type = 'recurring' AND p.status NOT IN ('closed', 'cancelled'))::int AS recurring,
            COUNT(*) FILTER (WHERE p.status IN ('closed', 'cancelled'))::int AS closed,
            COUNT(*) FILTER (WHERE p.deadline < CURRENT_DATE AND p.status NOT IN ('delivered', 'closed', 'cancelled'))::int AS overdue
     FROM projects p WHERE ${visibilityClause(v)}`,
    [v.userId]
  );
  return ok({ projects: rows.map(normalizeProject), counts, role: v.role });
});

/**
 * POST /api/projects — open a ticket. Agents (for clients they converted) and HR.
 * { title, client_name, client_company?, client_email?, client_phone?, client_timezone?,
 *   service_type, priority?, description, deal_value?, source?, lead_id?, sale_id?,
 *   expected_delivery?, project_type?, recurrence?, start_date? }
 */
export const POST = handler(async (request: NextRequest) => {
  const v = await getViewer(request);
  if (v.role === 'developer') throw new HttpError(403, 'Developers can’t open tickets');
  const b = await readJson(request);
  if (!String(b.title || '').trim()) throw new HttpError(400, 'Give the project a title');
  if (!String(b.client_name || '').trim()) throw new HttpError(400, 'Client name is required');
  const service = SERVICES.includes(b.service_type) ? b.service_type : 'other';
  const priority = PRIORITIES.includes(b.priority) ? b.priority : 'normal';
  const recurring = b.project_type === 'recurring';
  if (recurring && !RECURRENCES.includes(b.recurrence)) throw new HttpError(400, 'Pick how often the recurring work repeats');

  // Source: an agent can only attach their own lead / sale.
  let source = 'manual', leadId: number | null = null, saleId: number | null = null;
  if (b.lead_id) {
    const lead = await queryOne<any>(`SELECT id, assigned_agent_id FROM dialer_leads WHERE id = $1`, [Number(b.lead_id)]);
    if (!lead) throw new HttpError(404, 'Lead not found');
    if (v.role === 'agent' && Number(lead.assigned_agent_id) !== v.userId) throw new HttpError(403, 'That lead isn’t yours');
    source = 'lead'; leadId = Number(lead.id);
  }
  if (b.sale_id) {
    const sale = await queryOne<any>(`SELECT id, agent_id FROM sales WHERE id = $1`, [Number(b.sale_id)]);
    if (!sale) throw new HttpError(404, 'Sale not found');
    if (v.role === 'agent' && Number(sale.agent_id) !== v.userId) throw new HttpError(403, 'That sale isn’t yours');
    source = 'sale'; saleId = Number(sale.id);
  }

  const hr = await queryOne<{ id: string }>(`SELECT id FROM users WHERE role = 'hr' AND COALESCE(is_active, true) ORDER BY id LIMIT 1`);
  const supervisor = v.role === 'hr' ? v.userId : hr ? Number(hr.id) : null;

  const p = await queryOne<any>(
    `INSERT INTO projects (title, description, service_type, priority, client_name, client_company, client_email, client_phone,
                           client_timezone, deal_value, source, lead_id, sale_id, created_by, supervisor_id,
                           expected_delivery, start_date, project_type, recurrence, recurrence_end)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
    [String(b.title).trim().slice(0, 200), String(b.description || ''), service, priority, String(b.client_name).trim(),
      b.client_company || null, b.client_email || null, b.client_phone || null, b.client_timezone || 'America/New_York',
      b.deal_value ? Number(b.deal_value) : null, source, leadId, saleId, v.userId, supervisor,
      b.expected_delivery || null, b.start_date || null, recurring ? 'recurring' : 'one_time', recurring ? b.recurrence : null,
      recurring ? b.recurrence_end || null : null]
  );
  await systemMessage(p.id, `${v.name} opened ticket ${p.ticket_no} for ${p.client_name}${p.client_company ? ` (${p.client_company})` : ''}.`, v.userId);
  if (String(b.description || '').trim()) {
    await query(`INSERT INTO project_messages (project_id, user_id, body) VALUES ($1, $2, $3)`, [p.id, v.userId, String(b.description).trim()]);
  }
  if (recurring) await openNextCycle(p.id);
  return ok(normalizeProject((await queryOne<any>(`SELECT * FROM projects WHERE id = $1`, [p.id]))!));
});
