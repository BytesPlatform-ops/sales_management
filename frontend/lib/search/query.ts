/**
 * Search syntax:  free words  plus  key:value filters
 *
 *   assignee:me | assignee:ali       status:"In progress" | status:in_review
 *   type:bug                         priority:urgent
 *   project:PRJ-0012                 due:<today | due:>2026-11-01 | due:today | due:overdue
 *   is:blocked | is:open | is:mine
 *
 * Quoted values may contain spaces. Unknown keys are treated as plain words.
 */
import { STATUS_LABELS, TICKET_STATUSES, TICKET_TYPES, TYPE_LABELS, PRIORITIES, TicketStatus } from '@/lib/tickets/rules';

export interface ParsedSearch {
  text: string;
  assignee?: string;               // 'me' or a username
  status?: TicketStatus[];
  type?: string;
  priority?: string;
  project?: string;                // PRJ-0012
  due?: { op: '<' | '>' | '='; date: string };   // resolved YYYY-MM-DD
  blocked?: boolean;
  open?: boolean;
  mine?: boolean;
  /** Only ticket-specific filters (anything but project/text) limit results to tickets. */
  ticketOnly: boolean;
  /** An exact ticket key typed on its own, e.g. "PRJ-0012-T5". */
  key?: string;
}

const norm = (s: string) => s.toLowerCase().replace(/[\s-]+/g, '_');

function statusOf(v: string): TicketStatus | null {
  const n = norm(v);
  if ((TICKET_STATUSES as readonly string[]).includes(n)) return n as TicketStatus;
  const byLabel = (Object.entries(STATUS_LABELS) as [TicketStatus, string][]).find(([, l]) => norm(l) === n);
  return byLabel ? byLabel[0] : null;
}

function typeOf(v: string): string | null {
  const n = norm(v);
  if ((TICKET_TYPES as readonly string[]).includes(n)) return n;
  if (n === 'cr') return 'change_request';
  const byLabel = Object.entries(TYPE_LABELS).find(([, l]) => norm(l) === n);
  return byLabel ? byLabel[0] : null;
}

/** today/yesterday/tomorrow or YYYY-MM-DD, relative to `today`. */
function dateOf(v: string, today: string): string | null {
  const n = v.toLowerCase();
  const shift = (d: number) => new Date(Date.parse(today + 'T00:00:00Z') + d * 86_400_000).toISOString().slice(0, 10);
  if (n === 'today') return today;
  if (n === 'tomorrow') return shift(1);
  if (n === 'yesterday') return shift(-1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(n) && !Number.isNaN(Date.parse(n))) return n;
  return null;
}

export function parseSearch(input: string, today: string): ParsedSearch {
  const out: ParsedSearch = { text: '', ticketOnly: false };
  const words: string[] = [];
  const re = /(\w+):("([^"]*)"|'([^']*)'|(\S+))|"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input.slice(0, 500)))) {
    if (m[1]) {
      const key = m[1].toLowerCase();
      const val = (m[3] ?? m[4] ?? m[5] ?? '').trim();
      if (!val) continue;
      let used = true;
      switch (key) {
        case 'assignee': out.assignee = val.toLowerCase().replace(/^@/, ''); break;
        case 'status': {
          const s = val.split(',').map(statusOf).filter(Boolean) as TicketStatus[];
          if (s.length) out.status = s; else used = false;
          break;
        }
        case 'type': { const t = typeOf(val); if (t) out.type = t; else used = false; break; }
        case 'priority': {
          const p = val.toLowerCase();
          if ((PRIORITIES as readonly string[]).includes(p)) out.priority = p; else used = false;
          break;
        }
        case 'project': out.project = val.toUpperCase(); break;
        case 'due': {
          const op = val[0] === '<' || val[0] === '>' ? (val[0] as '<' | '>') : '=';
          const rest = op === '=' ? val : val.slice(1);
          if (rest.toLowerCase() === 'overdue') { out.due = { op: '<', date: today }; out.open = true; break; }
          const d = dateOf(rest, today);
          if (d) out.due = { op, date: d }; else used = false;
          break;
        }
        case 'is': {
          const v = val.toLowerCase();
          if (v === 'blocked') out.blocked = true;
          else if (v === 'open') out.open = true;
          else if (v === 'mine') out.mine = true;
          else used = false;
          break;
        }
        default: used = false;
      }
      if (!used) words.push(m[0]);
    } else {
      words.push(m[6] ?? m[7]);
    }
  }
  out.text = words.join(' ').trim();
  out.ticketOnly = !!(out.assignee || out.status || out.type || out.priority || out.due || out.blocked || out.open || out.mine);
  const key = /^PRJ-\d{4,}-T\d+$/i.exec(out.text);
  if (key) out.key = key[0].toUpperCase();
  return out;
}
