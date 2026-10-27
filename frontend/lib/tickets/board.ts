/** Board helpers with no I/O: WIP limits (warning only) and swimlane grouping. */
import { WORK_STATUSES, TicketStatus } from './rules';

export type WipLimits = Partial<Record<TicketStatus, number>>;
export type WipState = 'none' | 'ok' | 'near' | 'over';

/** Keep only work-column limits that are whole numbers 1–999. */
export function sanitizeWipLimits(raw: unknown): WipLimits {
  const out: WipLimits = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const s of WORK_STATUSES) {
    const n = Number((raw as Record<string, unknown>)[s]);
    if (Number.isInteger(n) && n >= 1 && n <= 999) out[s] = n;
  }
  return out;
}

/** 'near' at the limit (amber), 'over' above it (red). Never blocks a move. */
export function wipState(count: number, limit: number | undefined): WipState {
  if (!limit) return 'none';
  if (count > limit) return 'over';
  if (count === limit) return 'near';
  return 'ok';
}

export type Swimlane = 'none' | 'assignee' | 'epic' | 'priority';

export interface LaneTicket {
  priority: string;
  epic_id: number | null;
  epic_title: string | null;
  assignees: { id: number | string; name: string }[];
}

const PRIORITY_ORDER = ['urgent', 'high', 'normal', 'low'];

/**
 * Split tickets into lanes. A ticket with several assignees appears in each of
 * their lanes (like Jira); unassigned / no-epic tickets get their own lane last.
 */
export function laneGroups<T extends LaneTicket>(tickets: T[], by: Swimlane): { key: string; label: string; tickets: T[] }[] {
  if (by === 'none') return [{ key: 'all', label: '', tickets }];
  const lanes = new Map<string, { key: string; label: string; tickets: T[]; order: number | string }>();
  const put = (key: string, label: string, order: number | string, t: T) => {
    if (!lanes.has(key)) lanes.set(key, { key, label, tickets: [], order });
    lanes.get(key)!.tickets.push(t);
  };
  for (const t of tickets) {
    if (by === 'priority') put(t.priority, t.priority[0].toUpperCase() + t.priority.slice(1), PRIORITY_ORDER.indexOf(t.priority), t);
    else if (by === 'epic') {
      if (t.epic_id) put(`e${t.epic_id}`, t.epic_title || 'Epic', `0${t.epic_title || ''}`, t);
      else put('none', 'No epic', '1', t);
    } else if (!t.assignees.length) put('none', 'Unassigned', '~', t);
    else for (const a of t.assignees) put(`u${a.id}`, a.name, a.name.toLowerCase(), t);
  }
  return Array.from(lanes.values())
    .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
    .map(({ key, label, tickets: ts }) => ({ key, label, tickets: ts }));
}

/**
 * Neighbours for a drop: `ids` is the target list in display order (it may still
 * contain the dragged ticket), `index` the insertion point counted in that list
 * WITHOUT the dragged ticket. Returns the ids to place it between (null = end).
 */
export function dropNeighbours(ids: number[], dragged: number, index: number): { after_id: number | null; before_id: number | null } {
  const list = ids.filter((id) => id !== dragged);
  const i = Math.max(0, Math.min(index, list.length));
  return { after_id: list[i - 1] ?? null, before_id: list[i] ?? null };
}

/** Insertion index from the pointer: above a card's middle → before it, below → after it. */
export function dropIndex(cardIndex: number, pointerY: number, rect: { top: number; height: number }): number {
  return pointerY < rect.top + rect.height / 2 ? cardIndex : cardIndex + 1;
}
