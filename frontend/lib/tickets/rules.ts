/**
 * Ticket rules with no database access: statuses, who may do what, status
 * moves, triage SLA, backlog ordering. Shared by the API routes and the UI.
 *
 * Flow: triage → open → in_progress → in_review → in_qa → done → closed
 *       triage → declined (decline, or merged as a duplicate)
 * "Blocked" is not a status; it's a badge while a 'blocks' relation is still open.
 */
export const TICKET_STATUSES = ['triage', 'open', 'in_progress', 'in_review', 'in_qa', 'done', 'closed', 'declined'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const STATUS_LABELS: Record<TicketStatus, string> = {
  triage: 'Triage', open: 'Open', in_progress: 'In progress', in_review: 'In review', in_qa: 'In QA',
  done: 'Done', closed: 'Closed', declined: 'Declined',
};

/** Statuses a ticket moves between once accepted (board columns). */
export const WORK_STATUSES: TicketStatus[] = ['open', 'in_progress', 'in_review', 'in_qa', 'done'];
export const FINISHED: TicketStatus[] = ['done', 'closed', 'declined'];

export const TICKET_TYPES = ['feature', 'bug', 'task', 'change_request', 'content', 'qa', 'spike', 'question'] as const;
export type TicketType = (typeof TICKET_TYPES)[number];
export const TYPE_LABELS: Record<TicketType, string> = {
  feature: 'Feature', bug: 'Bug', task: 'Task', change_request: 'Change request', content: 'Content',
  qa: 'QA', spike: 'Research', question: 'Question',
};

export const PRIORITIES = ['urgent', 'high', 'normal', 'low'] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS: Record<Priority, string> = { urgent: 'Urgent', high: 'High', normal: 'Normal', low: 'Low' };

export const DEFAULT_SLA_HOURS: Record<Priority, number> = { urgent: 4, high: 24, normal: 72, low: 168 };

export const isStatus = (v: unknown): v is TicketStatus => typeof v === 'string' && (TICKET_STATUSES as readonly string[]).includes(v);
export const isType = (v: unknown): v is TicketType => typeof v === 'string' && (TICKET_TYPES as readonly string[]).includes(v);
export const isPriority = (v: unknown): v is Priority => typeof v === 'string' && (PRIORITIES as readonly string[]).includes(v);

// ------------------------------------------------------------------ who may do what

export interface TicketActor {
  role: 'hr' | 'agent' | 'developer';
  userId: number;
  /** project_members.member_role, or null when not on the project */
  memberRole: string | null;
  /** projects.created_by — the agent whose client it is */
  projectCreatedBy: number;
  /** projects.triage_owner_id */
  triageOwnerId?: number | null;
  /**
   * Set when the actor reaches this ticket only through a grant (help request or
   * share): view = read, comment = read + comment, edit = also edit and work it.
   */
  grantLevel?: 'view' | 'comment' | 'edit' | null;
}

export const isProjectDev = (a: TicketActor) =>
  a.role === 'developer' && (a.memberRole === 'developer' || a.memberRole === 'lead_developer');

export const isOwnClientAgent = (a: TicketActor) => a.role === 'agent' && a.projectCreatedBy === a.userId;

export function canCreateTicket(a: TicketActor): boolean {
  return a.role === 'hr' || isProjectDev(a) || isOwnClientAgent(a);
}

/** Agent tickets go to Triage; developer/HR tickets start Open. */
export function initialStatus(a: TicketActor, via: string = 'manual'): TicketStatus {
  if (a.role === 'agent') return 'triage';
  if (via === 'brief' || via === 'meeting' || via === 'client_link') return 'triage';
  return 'open';
}

export function canTriage(a: TicketActor): boolean {
  return a.role === 'hr' || (isProjectDev(a) && (a.memberRole === 'lead_developer' || a.triageOwnerId === a.userId));
}

/** Title, description, type, priority, dates, labels, epic. */
export function canEditTicket(a: TicketActor, t: { created_by: number; status: TicketStatus }): boolean {
  if (a.role === 'hr' || isProjectDev(a) || a.grantLevel === 'edit') return true;
  // Agents may fix up their own ticket until a developer picks it up.
  return isOwnClientAgent(a) && Number(t.created_by) === a.userId && (t.status === 'triage' || t.status === 'open');
}

/** Status, assignees, checklist, estimate, relations. */
export function canWorkTicket(a: TicketActor): boolean {
  return a.role === 'hr' || isProjectDev(a) || a.grantLevel === 'edit';
}

/** Anyone who sees the ticket by right may comment; through a grant only at comment/edit level. */
export function canCommentTicket(a: TicketActor): boolean {
  return !a.grantLevel || a.grantLevel === 'comment' || a.grantLevel === 'edit';
}

export const canDeleteTicket = (a: TicketActor) => a.role === 'hr';

/**
 * Plain status moves (triage has its own actions). Returns an error message or null.
 * HR may move anything anywhere except into triage/declined (use triage actions).
 */
export function statusMoveError(a: TicketActor, t: { status: TicketStatus; type: string; cr_status: string | null }, to: TicketStatus): string | null {
  if (t.status === to) return 'Already in that status';
  if (!canWorkTicket(a)) return 'Only the project’s developers or HR can change status';
  if (t.status === 'triage' || t.status === 'declined') return 'Accept the ticket from Triage first';
  if (to === 'triage' || to === 'declined') return 'Use the triage actions for that';
  if (to === 'closed' && a.role !== 'hr' && a.memberRole !== 'lead_developer') return 'Only HR or the lead developer can close tickets';
  if (t.type === 'change_request' && t.cr_status !== 'approved' && ['in_progress', 'in_review', 'in_qa', 'done'].includes(to)) {
    return 'This change request needs HR approval before work starts';
  }
  return null;
}

// ------------------------------------------------------------------ triage SLA

export function triageDueAt(createdAt: Date, priority: Priority, hours: Partial<Record<Priority, number>> = {}): Date {
  const h = hours[priority] ?? DEFAULT_SLA_HOURS[priority];
  return new Date(createdAt.getTime() + h * 3600_000);
}

// ------------------------------------------------------------------ keys and branches

export const ticketKey = (projectTicketNo: string, n: number) => `${projectTicketNo}-T${n}`;
export const TICKET_KEY_RE = /\b(PRJ-\d{4,}-T\d+)\b/gi;

export function branchName(key: string, title: string, type: string): string {
  const prefix = type === 'bug' ? 'fix' : 'feature';
  const slug = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  return `${prefix}/${key}${slug ? '-' + slug : ''}`;
}

// ------------------------------------------------------------------ backlog order
// Fractional ranks over a–z ('a' = 0 … 'z' = 25). Generated ranks never end in 'a',
// so there is always room to insert before any of them.

const digit = (c: string | undefined) => (c === undefined ? -1 : c.charCodeAt(0) - 97);
const char = (d: number) => String.fromCharCode(97 + d);

/** A rank strictly between a and b; null means "before everything" / "after everything". */
export function rankBetween(a: string | null, b: string | null): string {
  if (a !== null && b === null) return rankAfter(a);
  const lo = a ?? '';
  if (b !== null && lo >= b) throw new Error('rankBetween: a must sort before b');
  if (b !== null) {
    // Shared prefix (a padded with 'a'): keep it and recurse on the rest.
    let i = 0;
    while (i < b.length && (lo[i] ?? 'a') === b[i]) i++;
    if (i > 0) return b.slice(0, i) + rankBetween(lo.slice(i) || null, b.slice(i));
  }
  const da = Math.max(digit(lo[0]), 0);
  const db = b === null || b === '' ? 26 : digit(b[0]);
  if (db - da > 1) return char(Math.round((da + db) / 2));
  // Adjacent first digits: b's first digit alone sorts between them when b is longer.
  if (b !== null && b.length > 1) return b[0];
  return char(da) + rankBetween(lo.slice(1) || null, null);
}

/**
 * Append after `a` (what every new ticket does): add one to the last character
 * with carry, dropping trailing 'a's. Ranks stay short however many are appended.
 */
function rankAfter(a: string): string {
  const d = a.split('').map((c) => digit(c));
  let i = d.length - 1;
  while (i >= 0 && d[i] === 25) i--;
  if (i < 0) return a + 'n';
  d[i]++;
  return d.slice(0, i + 1).map(char).join('');
}
