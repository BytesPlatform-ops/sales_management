/**
 * GitHub tracking rules with no I/O: webhook signatures, ticket keys, which
 * automatic status moves are allowed, environment names, repo names, health.
 *
 * Automatic moves only ever go FORWARD, never touch Triage/Declined tickets,
 * never set a project Delivered/Closed, and never happen on On hold / Cancelled
 * projects. A person can always move things by hand; GitHub never undoes that.
 */
import { createHmac, timingSafeEqual } from 'crypto';

// ------------------------------------------------------------------ webhook signature

/** X-Hub-Signature-256: "sha256=<hex hmac of the raw body>". Timing-safe. */
export function verifySignature(secret: string, rawBody: string | Buffer, header: string | null | undefined): boolean {
  if (!secret || !header || !header.startsWith('sha256=')) return false;
  const expected = Buffer.from('sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex'));
  const got = Buffer.from(header);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export function signBody(secret: string, rawBody: string | Buffer): string {
  return 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
}

// ------------------------------------------------------------------ ticket keys

/**
 * Ticket keys of ONE project found in text: "feature/PRJ-0012-T5-login", "Fix PRJ-0012-T7".
 * Keys of other projects are ignored, so a stray key can't move someone else's ticket.
 */
export function ticketKeysFor(projectTicketNo: string, ...texts: (string | null | undefined)[]): string[] {
  const prefix = projectTicketNo.toUpperCase();
  const out = new Set<string>();
  const re = /(?:^|[^A-Za-z0-9])(PRJ-\d{4,}-T\d+)(?![0-9A-Za-z])/gi;
  for (const text of texts) {
    if (!text) continue;
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(text))) {
      const key = m[1].toUpperCase();
      if (key.startsWith(prefix + '-T')) out.add(key);
    }
  }
  return Array.from(out);
}

// ------------------------------------------------------------------ automatic ticket moves

const TICKET_ORDER: Record<string, number> = { open: 0, in_progress: 1, in_review: 2, in_qa: 3, done: 4, closed: 5 };

export type TicketSignal = 'branch' | 'commit' | 'pr_opened' | 'pr_merged';

const TARGET: Record<TicketSignal, string> = { branch: 'in_progress', commit: 'in_progress', pr_opened: 'in_review', pr_merged: 'done' };

/**
 * Where a ticket should move for a GitHub signal, or null for "leave it".
 * Forward only; Triage/Declined/Closed tickets are never touched; change requests
 * need HR approval first (crBlocked).
 */
export function ticketAutoMove(current: string, signal: TicketSignal, opts: { crBlocked?: boolean } = {}): string | null {
  if (!(current in TICKET_ORDER) || current === 'closed') return null; // triage, declined, closed
  const target = TARGET[signal];
  if (TICKET_ORDER[current] >= TICKET_ORDER[target]) return null;      // never backwards, never sideways
  if (opts.crBlocked) return null;
  return target;
}

const FROZEN_PROJECT = ['on_hold', 'cancelled', 'delivered', 'closed'];

export type ProjectSignal = 'push' | 'pr_opened';

/** Project status moves: first push → In progress (from New); PR opened → In review (from In progress). */
export function projectAutoMove(current: string, signal: ProjectSignal): string | null {
  if (FROZEN_PROJECT.includes(current)) return null;
  if (signal === 'push' && current === 'new') return 'in_progress';
  if (signal === 'pr_opened' && current === 'in_progress') return 'review';
  return null;
}

/** On hold / Cancelled projects get no automatic changes at all (activity is still recorded). */
export const projectFrozen = (status: string) => status === 'on_hold' || status === 'cancelled';

// ------------------------------------------------------------------ environments

export function isProductionEnv(env: string | null | undefined, productionName: string | null | undefined): boolean {
  if (!env) return false;
  return env.trim().toLowerCase() === String(productionName || 'Production').trim().toLowerCase();
}

export function isStagingEnv(env: string | null | undefined): boolean {
  return !!env && /(stag|preview|uat|test|qa|dev)/i.test(env);
}

// ------------------------------------------------------------------ repo names

/** PRJ-0012 + "Acme Dental, Inc." → PRJ-0012-acme-dental-inc (GitHub-safe, ≤ 100 chars). */
export function repoName(ticketNo: string, client: string | null | undefined): string {
  const slug = String(client || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  return slug ? `${ticketNo}-${slug}` : ticketNo;
}

// ------------------------------------------------------------------ health

export type Health = 'green' | 'yellow' | 'red';
const CLOSED_PROJECT = ['delivered', 'closed', 'cancelled'];

/**
 * green  = activity in the last 3 days
 * yellow = 3–6 days without activity
 * red    = 7+ days without activity, or past its deadline
 * Delivered / closed / cancelled projects are green (nothing to chase).
 */
export function computeHealth(p: { status: string; last_activity_at: string | Date | null; created_at: string | Date; deadline: string | null }, now = new Date(), todayPkt?: string): Health {
  if (CLOSED_PROJECT.includes(p.status)) return 'green';
  const today = todayPkt || pktDate(now);
  if (p.deadline && String(p.deadline).slice(0, 10) < today) return 'red';
  const last = new Date(p.last_activity_at || p.created_at).getTime();
  const days = (now.getTime() - last) / 86_400_000;
  if (days >= 7) return 'red';
  if (days >= 3) return 'yellow';
  return 'green';
}

export function pktDate(d = new Date()): string {
  return new Date(d.getTime() + 5 * 3600_000).toISOString().slice(0, 10);
}

export function pktHourOf(d = new Date()): number {
  return new Date(d.getTime() + 5 * 3600_000).getUTCHours();
}
