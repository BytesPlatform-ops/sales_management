/**
 * Project templates: default epics, tickets, milestones and vault placeholders per
 * service (WordPress site, Shopify store, …). Applying one adds to a project; it
 * never removes anything already there.
 */
import { query, queryOne } from '@/lib/db';
import { HttpError } from '@/lib/training/http';
import { insertTicket } from './core';
import { isType } from './rules';

export interface TemplateBody {
  epics?: { title: string; color?: string; tickets?: { title: string; type?: string; checklist?: string[] }[] }[];
  milestones?: { title: string; offset_days: number }[];
  vault_placeholders?: { environment: string; key: string; note?: string }[];
}

export function parseTemplateBody(raw: unknown): TemplateBody {
  const b = (raw && typeof raw === 'object' ? raw : {}) as any;
  const epics = Array.isArray(b.epics) ? b.epics.slice(0, 30).map((e: any) => ({
    title: String(e?.title || '').trim().slice(0, 200),
    color: /^#[0-9a-f]{6}$/i.test(e?.color || '') ? e.color : '#6366f1',
    tickets: (Array.isArray(e?.tickets) ? e.tickets : []).slice(0, 100).map((t: any) => ({
      title: String(t?.title || '').trim().slice(0, 300),
      type: isType(t?.type) ? t.type : 'task',
      checklist: Array.isArray(t?.checklist) ? t.checklist.map((s: unknown) => String(s).slice(0, 500)).slice(0, 50) : [],
    })).filter((t: any) => t.title),
  })).filter((e: any) => e.title) : [];
  const milestones = Array.isArray(b.milestones) ? b.milestones.slice(0, 50).map((m: any) => ({
    title: String(m?.title || '').trim().slice(0, 200),
    offset_days: Math.max(0, Math.min(3650, Math.round(Number(m?.offset_days) || 0))),
  })).filter((m: any) => m.title) : [];
  const vault_placeholders = Array.isArray(b.vault_placeholders) ? b.vault_placeholders.slice(0, 100).map((v: any) => ({
    environment: ['development', 'staging', 'production'].includes(v?.environment) ? v.environment : 'development',
    key: String(v?.key || '').trim().slice(0, 200),
    note: String(v?.note || '').slice(0, 500),
  })).filter((v: any) => /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(v.key)) : [];
  return { epics, milestones, vault_placeholders };
}

export async function applyProjectTemplate(projectId: number, templateId: number, userId: number) {
  const tpl = await queryOne<{ id: number; body: unknown }>(`SELECT id, body FROM project_templates WHERE id = $1`, [templateId]);
  if (!tpl) throw new HttpError(404, 'Project template not found');
  const project = await queryOne<{ id: number; ticket_no: string; start_date: string | null }>(
    `SELECT id, ticket_no, start_date::text AS start_date FROM projects WHERE id = $1`, [projectId]
  );
  if (!project) throw new HttpError(404, 'Project not found');
  const body = parseTemplateBody(tpl.body);
  let epics = 0, tickets = 0, milestones = 0, placeholders = 0;

  for (const e of body.epics || []) {
    const epic = await queryOne<{ id: number }>(
      `INSERT INTO epics (project_id, title, color, sort_order, created_by)
       VALUES ($1, $2, $3, COALESCE((SELECT MAX(sort_order) + 1 FROM epics WHERE project_id = $1), 0), $4) RETURNING id`,
      [projectId, e.title, e.color, userId]
    );
    epics++;
    for (const t of e.tickets || []) {
      const row = await insertTicket(project, userId, {
        title: t.title, type: t.type || 'task', priority: 'normal', status: 'open', epic_id: epic!.id, created_via: 'template',
      });
      if (t.checklist?.length) {
        await query(
          `INSERT INTO ticket_checklist_items (ticket_id, body, sort_order) SELECT $1, b, o FROM unnest($2::text[]) WITH ORDINALITY x(b, o)`,
          [row.id, t.checklist]
        );
      }
      tickets++;
    }
  }

  const start = project.start_date ? new Date(project.start_date + 'T00:00:00Z') : new Date();
  const ms = body.milestones || [];
  for (let i = 0; i < ms.length; i++) {
    const m = ms[i];
    const due = new Date(start.getTime() + m.offset_days * 86_400_000).toISOString().slice(0, 10);
    await query(`INSERT INTO project_milestones (project_id, title, due_date, sort_order) VALUES ($1, $2, $3, $4)`, [projectId, m.title, due, i]);
    milestones++;
  }

  // Vault placeholders: an empty value with a note ("Waiting on client"), only when the vault is configured.
  if (body.vault_placeholders?.length && process.env.VAULT_MASTER_KEY) {
    const { projectDataKey, encryptValue } = await import('@/lib/vault/store');
    const dataKey = await projectDataKey(projectId);
    for (const v of body.vault_placeholders) {
      const s = encryptValue(dataKey, projectId, v.environment as any, v.key, '');
      const r = await query(
        `INSERT INTO vault_secrets (project_id, environment, key_name, ciphertext, iv, tag, note, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8) ON CONFLICT (project_id, environment, key_name) DO NOTHING RETURNING id`,
        [projectId, v.environment, v.key, s.ciphertext, s.iv, s.tag, v.note || null, userId]
      );
      placeholders += r.length;
    }
  }
  await query(`UPDATE projects SET template_id = $2, updated_at = NOW() WHERE id = $1`, [projectId, templateId]);
  return { epics, tickets, milestones, vault_placeholders: placeholders };
}

/** Snapshot a project's epics, top-level tickets and milestone offsets as a new template. */
export async function projectAsTemplateBody(projectId: number): Promise<TemplateBody> {
  const project = await queryOne<{ start_date: string | null; created_at: string }>(
    `SELECT start_date::text AS start_date, created_at FROM projects WHERE id = $1`, [projectId]
  );
  const epics = await query<{ id: number; title: string; color: string }>(
    `SELECT id, title, color FROM epics WHERE project_id = $1 AND status <> 'archived' ORDER BY sort_order, id`, [projectId]
  );
  const tickets = await query<{ id: number; epic_id: number | null; title: string; type: string }>(
    `SELECT id, epic_id, title, type FROM tickets WHERE project_id = $1 AND parent_id IS NULL AND deleted_at IS NULL
        AND status NOT IN ('triage','declined') ORDER BY rank, id`, [projectId]
  );
  const checklists = await query<{ ticket_id: number; body: string }>(
    `SELECT c.ticket_id, c.body FROM ticket_checklist_items c JOIN tickets t ON t.id = c.ticket_id
      WHERE t.project_id = $1 ORDER BY c.sort_order, c.id`, [projectId]
  );
  const milestones = await query<{ title: string; due_date: string }>(
    `SELECT title, due_date::text AS due_date FROM project_milestones WHERE project_id = $1 AND cycle_id IS NULL ORDER BY due_date`, [projectId]
  );
  const start = new Date((project?.start_date || String(project?.created_at).slice(0, 10)) + 'T00:00:00Z').getTime();
  const tk = (epicId: number | null) => tickets.filter((t) => t.epic_id === epicId).map((t) => ({
    title: t.title, type: t.type, checklist: checklists.filter((c) => c.ticket_id === t.id).map((c) => c.body),
  }));
  const body: TemplateBody = {
    epics: epics.map((e) => ({ title: e.title, color: e.color, tickets: tk(e.id) })),
    milestones: milestones.map((m) => ({ title: m.title, offset_days: Math.max(0, Math.round((Date.parse(m.due_date + 'T00:00:00Z') - start) / 86_400_000)) })),
    vault_placeholders: (await query<{ environment: string; key_name: string; note: string | null }>(
      `SELECT environment, key_name, note FROM vault_secrets WHERE project_id = $1 ORDER BY environment, key_name`, [projectId]
    ).catch(() => [])).map((v) => ({ environment: v.environment, key: v.key_name, note: v.note || '' })),
  };
  const loose = tk(null);
  if (loose.length) body.epics!.push({ title: 'General', color: '#64748b', tickets: loose });
  return body;
}
