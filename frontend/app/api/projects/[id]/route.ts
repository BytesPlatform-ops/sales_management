import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { getViewer, loadProject, systemMessage, openNextCycle, fmtDay, normalizeProject } from '@/lib/projects/core';
import { envAccessMap, isVaultEnv } from '@/lib/vault/access';
import { grantVaultEnvs } from '@/lib/access/grants';
import { ensureOriginal, syncOriginalBrief } from '@/lib/brief/core';

export const dynamic = 'force-dynamic';

/** GET /api/projects/{id} — full project: people, milestones, meetings, cycles, permissions. */
export const GET = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const v = await getViewer(request);
  const p = await loadProject(Number(params.id), v);
  const [members, milestones, meetings, cycles, people] = await Promise.all([
    query(`SELECT m.user_id AS id, u.full_name AS name, u.role, m.member_role, m.added_at
           FROM project_members m JOIN users u ON u.id = m.user_id WHERE m.project_id = $1 ORDER BY u.full_name`, [p.id]),
    query(`SELECT ms.*, ms.start_date::text AS start_date, ms.due_date::text AS due_date, u.full_name AS assignee_name
           FROM project_milestones ms LEFT JOIN users u ON u.id = ms.assignee_id
           WHERE ms.project_id = $1 ORDER BY ms.due_date, ms.sort_order, ms.id`, [p.id]),
    query(`SELECT mt.*, u.full_name AS created_by_name FROM project_meetings mt LEFT JOIN users u ON u.id = mt.created_by
           WHERE mt.project_id = $1 ORDER BY mt.starts_at`, [p.id]),
    query(`SELECT *, period_start::text AS period_start, period_end::text AS period_end, deadline::text AS deadline
           FROM project_cycles WHERE project_id = $1 ORDER BY cycle_no`, [p.id]),
    queryOne<any>(`SELECT (SELECT full_name FROM users WHERE id = $1) AS created_by_name, (SELECT full_name FROM users WHERE id = $2) AS supervisor_name`,
      [p.created_by, p.supervisor_id]),
  ]);
  const hr = v.role === 'hr';
  // Help-request access is read + comment only: no project edits.
  const viaGrant = p.access?.via === 'grant';
  const briefEntryId = await ensureOriginal(p as any);
  const myMembership = (members as any[]).find((m) => Number(m.id) === v.userId);
  const envAccess = envAccessMap(v.role, myMembership?.member_role);
  // Temporary helpers (help-request grant) see the environments their grant opens.
  if (p.access?.via === 'grant') for (const e of grantVaultEnvs(p.access.grant as any)) if (isVaultEnv(e)) envAccess[e] = true;
  return ok({
    project: {
      ...p,
      start_date: p.start_date ? String(p.start_date).slice(0, 10) : null,
      deadline: p.deadline ? String(p.deadline).slice(0, 10) : null,
      expected_delivery: p.expected_delivery ? String(p.expected_delivery).slice(0, 10) : null,
      recurrence_end: p.recurrence_end ? String(p.recurrence_end).slice(0, 10) : null,
      created_by_name: people?.created_by_name, supervisor_name: people?.supervisor_name,
    },
    members, milestones, meetings, cycles,
    permissions: {
      role: v.role,
      edit_details: hr || (v.role === 'agent' && p.created_by === v.userId),
      edit_dates: hr,
      manage_members: hr,
      manage_milestones: hr || (v.role === 'developer' && !viaGrant),
      manage_meetings: !viaGrant,
      set_status: hr || (v.role === 'developer' && !viaGrant),
      deliver_cycle: hr,
      close: hr,
      env: envAccess,
      // HR and the client's agent add brief updates and brief files.
      brief_add: hr || (v.role === 'agent' && p.created_by === v.userId),
      // Temporary/shared access: what it allows and until when.
      grant: viaGrant ? { level: p.access.grant?.level ?? 'view', expires_at: p.access.grant?.expires_at ?? null, source: p.access.grant?.source ?? null } : null,
    },
    brief_entry_id: briefEntryId,
  });
});

const DETAIL_FIELDS = ['title', 'description', 'service_type', 'priority', 'client_name', 'client_company', 'client_email', 'client_phone', 'client_timezone', 'deal_value'];
const HR_FIELDS = ['start_date', 'deadline', 'expected_delivery', 'supervisor_id', 'project_type', 'recurrence', 'recurrence_end'];
const LABELS: Record<string, string> = {
  start_date: 'work start', deadline: 'deadline', expected_delivery: 'expected delivery', recurrence_end: 'recurring until',
};

/** PATCH /api/projects/{id} — edit details (agent who opened it / HR) and dates & recurring settings (HR). */
export const PATCH = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const v = await getViewer(request);
  const p = await loadProject(Number(params.id), v);
  const b = await readJson(request);
  const canDetails = v.role === 'hr' || (v.role === 'agent' && p.created_by === v.userId);
  const allowed = [...(canDetails ? DETAIL_FIELDS : []), ...(v.role === 'hr' ? HR_FIELDS : [])];
  const keys = Object.keys(b).filter((k) => allowed.includes(k));
  if (!keys.length) throw new HttpError(403, 'Nothing you can change here');
  if (b.project_type === 'recurring' && !['weekly', 'monthly', 'quarterly'].includes(b.recurrence ?? p.recurrence)) {
    throw new HttpError(400, 'Pick how often the recurring work repeats');
  }

  const vals = keys.map((k) => (b[k] === '' ? null : b[k]));
  vals.push(p.id);
  const updated = await queryOne<any>(
    `UPDATE projects SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(', ')}, updated_at = NOW() WHERE id = $${vals.length} RETURNING *`,
    vals
  );

  // Thread entries for the things everyone needs to notice.
  const changes: string[] = [];
  for (const k of ['start_date', 'deadline', 'expected_delivery', 'recurrence_end']) {
    if (k in b && String(b[k] || '') !== String(p[k as keyof typeof p] ? String(p[k as keyof typeof p]).slice(0, 10) : '')) {
      changes.push(`${LABELS[k]} → ${b[k] ? fmtDay(b[k]) : 'cleared'}`);
    }
  }
  if ('project_type' in b && b.project_type !== p.project_type) {
    changes.push(b.project_type === 'recurring' ? `now a recurring project (${b.recurrence || p.recurrence})` : 'now a one-time project');
  }
  if ('supervisor_id' in b && Number(b.supervisor_id) !== Number(p.supervisor_id)) {
    const s = await queryOne<{ full_name: string }>(`SELECT full_name FROM users WHERE id = $1`, [Number(b.supervisor_id)]);
    changes.push(`supervisor → ${s?.full_name || 'none'}`);
  }
  if (changes.length) await systemMessage(p.id, `${v.name} updated ${changes.join(', ')}.`, v.userId);
  // The description is the original brief (version 1 of the brief timeline); keep them in step.
  if ('description' in b) {
    await ensureOriginal(p as any);
    await syncOriginalBrief(p.id, String(b.description ?? ''), v.userId);
  }
  if (updated.project_type === 'recurring') {
    const open = await queryOne(`SELECT 1 FROM project_cycles WHERE project_id = $1`, [p.id]);
    if (!open) await openNextCycle(p.id);
  }
  return ok(normalizeProject((await queryOne<any>(`SELECT * FROM projects WHERE id = $1`, [p.id]))!));
});
