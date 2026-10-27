/**
 * Projects & ticketing.
 *
 * Who can do what:
 *   agent      opens tickets for clients they converted; sees projects they
 *              opened; chats, schedules client meetings, edits client details
 *   developer  sees projects they're assigned to; chats; manages milestones;
 *              moves work to in_progress / review
 *   hr         supervisor: sees everything; assigns developers; sets dates,
 *              status, recurring settings; delivers / closes / reopens
 */
import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { HttpError } from '@/lib/training/http';
import { AuthError, effectiveRole, RealRole, verifyRequest } from '@/lib/auth/session';
import { Grant, GrantLevel, guestExpired, levelAtLeast, projectGrantSql } from '@/lib/access/grants';

/** Permission role. A CEO is 'hr' here (see lib/auth/session); `realRole` keeps 'ceo'. */
export type Role = 'hr' | 'agent' | 'developer';
export interface Viewer {
  userId: number; role: Role; name: string;
  realRole?: RealRole;
  /** "View as" token: reads only. */
  readonly?: boolean;
  /** HTTP method of the request — access that comes only from a grant is read-only for writes. */
  method?: string;
}

export async function getViewer(request: NextRequest): Promise<Viewer> {
  let a;
  try {
    a = await verifyRequest(request);
  } catch (e) {
    if (e instanceof AuthError) throw new HttpError(e.status, e.message);
    throw e;
  }
  const user = await queryOne<{ id: string; role: RealRole; full_name: string; is_active: boolean | null }>(
    `SELECT id, role, full_name, is_active FROM users WHERE id = $1`,
    [a.userId]
  );
  if (!user || user.is_active === false) throw new HttpError(401, 'Account not active');
  // Guest (freelance) developers lose all access when their window ends.
  if (user.role === 'developer' && await guestExpired(Number(user.id))) throw new HttpError(401, 'Your guest access has expired');
  return {
    userId: Number(user.id), role: effectiveRole(user.role), realRole: user.role, name: user.full_name, readonly: a.readonly,
    method: request.method,
  };
}

export const STATUSES = ['new', 'in_progress', 'review', 'delivered', 'on_hold', 'closed', 'cancelled'] as const;
export type Status = (typeof STATUSES)[number];
export const OPEN_STATUSES: Status[] = ['new', 'in_progress', 'review', 'delivered', 'on_hold'];

export const STATUS_LABELS: Record<Status, string> = {
  new: 'New', in_progress: 'In progress', review: 'In review', delivered: 'Delivered',
  on_hold: 'On hold', closed: 'Closed', cancelled: 'Cancelled',
};

/** Which status changes each role may make. */
export function canSetStatus(role: Role, from: Status, to: Status): boolean {
  if (from === to) return false;
  if (role === 'hr') return true;
  if (role === 'developer') {
    return (['new', 'in_progress', 'review', 'on_hold'] as Status[]).includes(from) && (['in_progress', 'review'] as Status[]).includes(to);
  }
  return false;
}

export interface ProjectRow {
  id: number; ticket_no: string; title: string; description: string; service_type: string; priority: string;
  status: Status; project_type: 'one_time' | 'recurring'; recurrence: string | null; recurrence_end: string | null;
  client_name: string; client_company: string | null; client_email: string | null; client_phone: string | null; client_timezone: string | null;
  deal_value: string | null; source: string; lead_id: number | null; sale_id: string | null;
  created_by: number; supervisor_id: number | null; start_date: string | null; deadline: string | null;
  expected_delivery: string | null; delivered_at: string | null; closed_at: string | null; created_at: string; updated_at: string;
}

/** Projects the viewer sees by right (HR all, developer member, agent creator) — no grants. */
function ownAccessClause(v: Viewer, alias: string): string {
  // Reference $1 even for HR so the parameter's type is always known.
  if (v.role === 'hr') return '($1::bigint IS NOT NULL)';
  if (v.role === 'developer') return `EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = ${alias}.id AND m.user_id = $1)`;
  return `${alias}.created_by = $1`;
}

/**
 * SQL fragment restricting projects to what the viewer may see. Uses $1 = viewer id.
 * Includes active project-level grants (help requests); see lib/access/grants.
 */
export function visibilityClause(v: Viewer, alias = 'p'): string {
  if (v.role === 'hr') return ownAccessClause(v, alias);
  return `(${ownAccessClause(v, alias)} OR ${projectGrantSql(alias)})`;
}

/**
 * pg parses DATE columns into JS Dates at *local* midnight, which shifts the day
 * when serialised as UTC (PKT is UTC+5). Always hand dates out as YYYY-MM-DD.
 */
export function toYmd(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  return String(v).slice(0, 10);
}

const PROJECT_DATES = ['start_date', 'deadline', 'expected_delivery', 'recurrence_end'] as const;

export function normalizeProject<T extends Record<string, any>>(row: T): T {
  if (!row) return row;
  const out: any = { ...row };
  for (const k of PROJECT_DATES) if (k in out) out[k] = toYmd(out[k]);
  if ('created_by' in out && out.created_by !== null) out.created_by = Number(out.created_by);
  if ('supervisor_id' in out && out.supervisor_id !== null) out.supervisor_id = Number(out.supervisor_id);
  return out;
}

export function normalizeDates<T extends Record<string, any>>(row: T, keys: string[]): T {
  if (!row) return row;
  const out: any = { ...row };
  for (const k of keys) if (k in out) out[k] = toYmd(out[k]);
  return out;
}

/** How the viewer reaches a project: by right, or only through a (temporary) grant. */
export interface ProjectAccess { via: 'own' | 'grant'; grant: Pick<Grant, 'id' | 'level' | 'scope' | 'expires_at' | 'source'> | null }

const WRITE = (m?: string) => !!m && !['GET', 'HEAD', 'OPTIONS'].includes(m.toUpperCase());

/**
 * Load a project the viewer may see (404 otherwise). The row carries `access`.
 *
 * Access that comes ONLY from a grant is read-only: a write request (POST/PATCH/…)
 * is refused unless the caller opts in with `grantWrite`, naming the lowest grant
 * level that may do it (e.g. 'comment' for posting a comment). This keeps every
 * existing developer-write route closed to helpers by default.
 */
export async function loadProject(id: number, v: Viewer, opts: { grantWrite?: GrantLevel } = {}): Promise<ProjectRow & { access: ProjectAccess }> {
  const p = await queryOne<ProjectRow & { own_access: boolean; grant_json: any }>(
    `SELECT p.*, ${ownAccessClause(v, 'p')} AS own_access,
            (SELECT row_to_json(x) FROM (
               SELECT g.id, g.level, g.scope, g.expires_at, g.source FROM access_grants g
                WHERE g.grantee_id = $1 AND g.resource_type = 'project' AND g.resource_id = p.id::text
                  AND g.revoked_at IS NULL AND g.starts_at <= NOW() AND (g.expires_at IS NULL OR g.expires_at > NOW())
                  AND NOT COALESCE((g.scope->>'pending_approval')::boolean, false)
                ORDER BY CASE g.level WHEN 'edit' THEN 0 WHEN 'comment' THEN 1 ELSE 2 END LIMIT 1) x) AS grant_json
       FROM projects p WHERE p.id = $2 AND ${visibilityClause(v)}`,
    [v.userId, id]
  );
  if (!p) throw new HttpError(404, 'Project not found');
  const { own_access, grant_json: grant, ...row } = p;
  const access: ProjectAccess = own_access ? { via: 'own', grant: null } : { via: 'grant', grant: grant ? { ...grant, id: Number(grant.id) } : null };
  if (access.via === 'grant' && WRITE(v.method) && !(opts.grantWrite && levelAtLeast(access.grant?.level, opts.grantWrite))) {
    throw new HttpError(403, 'Your temporary access to this project is read-only');
  }
  // pg returns BIGINT as strings and DATEs as local-midnight Dates; normalise both.
  return { ...normalizeProject(row as ProjectRow), access };
}

export function requireSupervisor(v: Viewer) {
  if (v.role !== 'hr') throw new HttpError(403, 'Only a supervisor (HR) can do this');
}

/** Automatic thread entry ("Ali moved this to In progress"). */
export async function systemMessage(projectId: number, body: string, userId: number | null = null) {
  await query(`INSERT INTO project_messages (project_id, user_id, kind, body) VALUES ($1, $2, 'system', $3)`, [projectId, userId, body]);
  await query(`UPDATE projects SET updated_at = NOW() WHERE id = $1`, [projectId]);
}

export const fmtDay = (d: string | Date | null | undefined) =>
  d ? new Date(typeof d === 'string' && d.length === 10 ? d + 'T12:00:00Z' : d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—';

// ---------------------------------------------------------------- recurring cycles

function addPeriod(date: Date, recurrence: string): Date {
  const d = new Date(date.getTime());
  if (recurrence === 'weekly') d.setUTCDate(d.getUTCDate() + 7);
  else if (recurrence === 'quarterly') d.setUTCMonth(d.getUTCMonth() + 3);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Open the next delivery cycle for a recurring project. Cycle 1 starts on the
 * project's start date (or today); each cycle ends the day before the next
 * starts, and its deadline is its last day.
 */
export async function openNextCycle(projectId: number): Promise<number | null> {
  const raw = await queryOne<ProjectRow>(`SELECT * FROM projects WHERE id = $1`, [projectId]);
  const p = raw ? normalizeProject(raw) : null;
  if (!p || p.project_type !== 'recurring' || !p.recurrence) return null;
  if (['closed', 'cancelled'].includes(p.status)) return null;
  const last = await queryOne<{ cycle_no: number; period_end: string }>(
    `SELECT cycle_no, period_end::text FROM project_cycles WHERE project_id = $1 ORDER BY cycle_no DESC LIMIT 1`,
    [projectId]
  );
  const start = last
    ? new Date(new Date(last.period_end + 'T00:00:00Z').getTime() + 86_400_000)
    : new Date((p.start_date || ymd(new Date())) + 'T00:00:00Z');
  if (p.recurrence_end && ymd(start) > p.recurrence_end) return null;
  const end = new Date(addPeriod(start, p.recurrence).getTime() - 86_400_000);
  const no = (last?.cycle_no || 0) + 1;
  const row = await queryOne<{ id: number }>(
    `INSERT INTO project_cycles (project_id, cycle_no, period_start, period_end, deadline)
     VALUES ($1, $2, $3, $4, $4) ON CONFLICT (project_id, cycle_no) DO NOTHING RETURNING id`,
    [projectId, no, ymd(start), ymd(end)]
  );
  if (row) {
    await query(`UPDATE projects SET deadline = $2, expected_delivery = COALESCE(GREATEST(expected_delivery, $2::date), $2::date) WHERE id = $1`, [projectId, ymd(end)]);
    await systemMessage(projectId, `Cycle ${no} opened: ${fmtDay(ymd(start))} – ${fmtDay(ymd(end))} (deadline ${fmtDay(ymd(end))}).`);
  }
  return row?.id ?? null;
}

/** Daily job: open the next cycle for recurring projects whose current cycle has ended. */
export async function rollRecurringCycles(): Promise<number> {
  const due = await query<{ id: number }>(
    `SELECT p.id FROM projects p
     WHERE p.project_type = 'recurring' AND p.status NOT IN ('closed', 'cancelled')
       AND NOT EXISTS (
         SELECT 1 FROM project_cycles c WHERE c.project_id = p.id AND c.period_end >= CURRENT_DATE
       )`
  );
  let opened = 0;
  for (const p of due) {
    // Catch up if several periods passed (bounded).
    for (let i = 0; i < 12; i++) {
      const id = await openNextCycle(p.id);
      if (!id) break;
      opened++;
      const cur = await queryOne(`SELECT 1 FROM project_cycles WHERE project_id = $1 AND period_end >= CURRENT_DATE`, [p.id]);
      if (cur) break;
    }
  }
  return opened;
}
