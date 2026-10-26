'use client';

/**
 * Browser helpers for the Projects screens: a fetch wrapper for /api/projects
 * (and /api/hr/developers), SWR hook, shared types, labels and date/time-zone
 * utilities. Dates travel as YYYY-MM-DD; meetings as UTC ISO timestamps.
 */
import useSWR, { SWRConfiguration } from 'swr';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Fetch any app API path (e.g. `/api/projects/3`). Returns `data`, throws Error(message). */
export async function papi<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const t = typeof window === 'undefined' ? null : localStorage.getItem('token');
  if (t) headers.Authorization = `Bearer ${t}`;
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, { method: opts.method || (body ? 'POST' : 'GET'), headers, body, cache: 'no-store' });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    throw new ApiError(res.status, `Request failed (${res.status})`);
  }
  if (!res.ok || json?.status === 'error') throw new ApiError(res.status, json?.message || 'Request failed');
  return json.data as T;
}

export function usePapi<T = any>(path: string | null, config?: SWRConfiguration) {
  return useSWR<T>(path, (p: string) => papi<T>(p), { revalidateOnFocus: false, ...config });
}

// ------------------------------------------------------------------ types

export type Status = 'new' | 'in_progress' | 'review' | 'delivered' | 'on_hold' | 'closed' | 'cancelled';
export type Role = 'hr' | 'agent' | 'developer';

export interface Member { id: string | number; name: string; role?: Role; member_role: string; added_at?: string }
export interface Milestone {
  id: number; project_id: number; cycle_id: number | null; title: string; description: string | null;
  start_date: string | null; due_date: string; status: 'pending' | 'in_progress' | 'done';
  assignee_id: string | number | null; assignee_name: string | null; completed_at: string | null;
}
export interface Meeting {
  id: number; project_id: number; title: string; kind: 'client' | 'internal'; starts_at: string; duration_min: number;
  location: string | null; agenda: string | null; outcome: string | null; status: 'scheduled' | 'done' | 'cancelled';
  created_by: string | number; created_by_name: string | null;
}
export interface Cycle {
  id: number; cycle_no: number; period_start: string; period_end: string; deadline: string;
  status: 'open' | 'delivered' | 'skipped'; delivered_at: string | null; notes: string | null;
}
export interface Project {
  id: number; ticket_no: string; title: string; description: string; service_type: string; priority: string; status: Status;
  project_type: 'one_time' | 'recurring'; recurrence: string | null; recurrence_end: string | null;
  client_name: string; client_company: string | null; client_email: string | null; client_phone: string | null; client_timezone: string | null;
  deal_value: string | null; source: string; lead_id: number | null; sale_id: number | null;
  created_by: string | number; supervisor_id: string | number | null; start_date: string | null; deadline: string | null;
  expected_delivery: string | null; delivered_at: string | null; closed_at: string | null; created_at: string; updated_at: string;
  created_by_name?: string | null; supervisor_name?: string | null;
}
export interface Permissions {
  role: Role; edit_details: boolean; edit_dates: boolean; manage_members: boolean; manage_milestones: boolean;
  manage_meetings: boolean; set_status: boolean; deliver_cycle: boolean; close: boolean;
}
export interface ProjectDetail { project: Project; members: Member[]; milestones: Milestone[]; meetings: Meeting[]; cycles: Cycle[]; permissions: Permissions }
export interface ListProject extends Project {
  members: Member[]; unread: number; next_meeting: { id: number; title: string; starts_at: string; kind: string } | null;
  milestones_done: string | null; current_cycle: { cycle_no: number; period_start: string; period_end: string; status: string } | null;
  overdue: boolean;
}
export interface Message {
  id: number; project_id: number; user_id: string | number | null; kind: 'message' | 'system'; body: string; reply_to: number | null;
  edited_at: string | null; created_at: string; author: string | null; author_role: Role | null; reply_body: string | null; reply_author: string | null;
}
export interface Person { id: string | number; name: string; username: string; role: Role; open_projects: number }

// ------------------------------------------------------------------ labels

export const STATUS_LABELS: Record<Status, string> = {
  new: 'New', in_progress: 'In progress', review: 'In review', delivered: 'Delivered',
  on_hold: 'On hold', closed: 'Closed', cancelled: 'Cancelled',
};
export const STATUS_ORDER: Status[] = ['new', 'in_progress', 'review', 'on_hold', 'delivered', 'closed', 'cancelled'];

export const SERVICE_LABELS: Record<string, string> = {
  website_new: 'New website', revamp: 'Website revamp', seo: 'SEO', smm: 'Social media',
  automation: 'Automation / AI', contract_mgmt: 'Contract-management build', other: 'Other',
};
export const PRIORITY_LABELS: Record<string, string> = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' };
export const RECURRENCE_LABELS: Record<string, string> = { weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly' };
export const MEMBER_ROLE_LABELS: Record<string, string> = { developer: 'Developer', lead_developer: 'Lead developer', watcher: 'Watcher' };
export const ROLE_LABELS: Record<string, string> = { agent: 'Agent', developer: 'Developer', hr: 'Supervisor' };

export const TIMEZONES: { value: string; label: string }[] = [
  { value: 'America/New_York', label: 'Eastern (New York)' },
  { value: 'America/Chicago', label: 'Central (Chicago)' },
  { value: 'America/Denver', label: 'Mountain (Denver)' },
  { value: 'America/Phoenix', label: 'Arizona (Phoenix, no DST)' },
  { value: 'America/Los_Angeles', label: 'Pacific (Los Angeles)' },
  { value: 'Asia/Karachi', label: 'Pakistan (Karachi)' },
];
export const PKT = 'Asia/Karachi';
export const tzLabel = (tz: string | null | undefined) => TIMEZONES.find((t) => t.value === tz)?.label || tz || 'Eastern (New York)';

export const sameId = (a: unknown, b: unknown) => a != null && b != null && String(a) === String(b);

// ------------------------------------------------------------------ dates

const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar date → YYYY-MM-DD. */
export function ymd(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** YYYY-MM-DD (or ISO) → local Date at midnight. */
export function parseDay(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(s: string, n: number): string {
  const d = parseDay(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}
/** Whole days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86_400_000);
}
export const today = () => ymd(new Date());

/** "Oct 30, 2026" for a YYYY-MM-DD (or timestamp, using its local date). */
export function fmtDay(s: string | null | undefined, opts?: { weekday?: boolean; noYear?: boolean }): string {
  if (!s) return '—';
  const d = s.length === 10 ? parseDay(s) : new Date(s);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', ...(opts?.noYear ? {} : { year: 'numeric' }), ...(opts?.weekday ? { weekday: 'short' } : {}),
  });
}

/** Mon–Fri days after today up to and including `to`. */
export function workingDaysUntil(to: string, from = today()): number {
  let n = 0;
  const d = parseDay(from);
  const end = parseDay(to);
  while (d < end) {
    d.setDate(d.getDate() + 1);
    const w = d.getDay();
    if (w !== 0 && w !== 6) n++;
  }
  return n;
}

export function fmtMoney(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (!isFinite(n)) return '—';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: n % 1 ? 2 : 0 });
}

export function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const m = Math.round(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  return fmtDay(iso);
}
export const fmtExact = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

// ------------------------------------------------------------------ time zones

/** Offset (ms) of `tz` from UTC at instant `t`: local wall time − UTC. */
export function tzOffset(t: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(t));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return asUtc - Math.floor(t / 1000) * 1000;
}

/** Wall-clock date (YYYY-MM-DD) + time (HH:mm) in `tz` → UTC ISO string. */
export function zonedToUtcIso(date: string, time: string, tz: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let t = wall - tzOffset(wall, tz);
  // Second pass settles DST boundaries.
  t = wall - tzOffset(t, tz);
  return new Date(t).toISOString();
}

/** UTC instant → { date, time } wall-clock strings in `tz` (for edit forms). */
export function utcToZoned(iso: string, tz: string): { date: string; time: string } {
  const t = new Date(iso).getTime();
  const local = new Date(t + tzOffset(t, tz));
  return {
    date: `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`,
    time: `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`,
  };
}

/** "Wed, Oct 28, 10:00 AM EDT" in a zone. */
export function fmtInTz(iso: string | number | Date, tz: string, opts: { date?: boolean; zone?: boolean } = {}): string {
  const { date = true, zone = true } = opts;
  return new Date(iso).toLocaleString('en-US', {
    timeZone: tz,
    ...(date ? { weekday: 'short', month: 'short', day: 'numeric' } : {}),
    hour: 'numeric', minute: '2-digit',
    ...(zone ? { timeZoneName: 'short' } : {}),
  });
}
/** PKT label: Intl prints "GMT+5" for Karachi; say "PKT". */
export function fmtPkt(iso: string | number | Date, opts: { date?: boolean } = {}): string {
  return `${fmtInTz(iso, PKT, { date: opts.date ?? true, zone: false })} PKT`;
}
export function tzAbbr(tz: string, at: number = Date.now()): string {
  if (tz === PKT) return 'PKT';
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date(at));
  return p.find((x) => x.type === 'timeZoneName')?.value || tz;
}
