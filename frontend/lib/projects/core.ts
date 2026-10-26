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
import { jwtVerify } from 'jose';
import { query, queryOne } from '@/lib/db';
import { HttpError } from '@/lib/training/http';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'
);

export type Role = 'hr' | 'agent' | 'developer';
export interface Viewer { userId: number; role: Role; name: string }

export async function getViewer(request: NextRequest): Promise<Viewer> {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) throw new HttpError(401, 'No token provided');
  let payload: any;
  try {
    payload = (await jwtVerify(header.slice(7), JWT_SECRET)).payload;
  } catch {
    throw new HttpError(401, 'Invalid or expired token');
  }
  const user = await queryOne<{ id: string; role: Role; full_name: string; is_active: boolean | null }>(
    `SELECT id, role, full_name, is_active FROM users WHERE id = $1`,
    [Number(payload.userId)]
  );
  if (!user || user.is_active === false) throw new HttpError(401, 'Account not active');
  return { userId: Number(user.id), role: user.role, name: user.full_name };
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
  deal_value: string | null; source: string; lead_id: number | null; sale_id: number | null;
  created_by: number; supervisor_id: number | null; start_date: string | null; deadline: string | null;
  expected_delivery: string | null; delivered_at: string | null; closed_at: string | null; created_at: string; updated_at: string;
}

/** SQL fragment restricting projects to what the viewer may see. Uses $1 = viewer id. */
export function visibilityClause(v: Viewer, alias = 'p'): string {
  // Reference $1 even for HR so the parameter's type is always known.
  if (v.role === 'hr') return '($1::bigint IS NOT NULL)';
  if (v.role === 'developer') return `EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = ${alias}.id AND m.user_id = $1)`;
  return `${alias}.created_by = $1`;
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

export async function loadProject(id: number, v: Viewer): Promise<ProjectRow> {
  const p = await queryOne<ProjectRow>(
    `SELECT p.* FROM projects p WHERE p.id = $2 AND ${visibilityClause(v)}`,
    [v.userId, id]
  );
  if (!p) throw new HttpError(404, 'Project not found');
  // pg returns BIGINT as strings and DATEs as local-midnight Dates; normalise both.
  return normalizeProject(p);
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
