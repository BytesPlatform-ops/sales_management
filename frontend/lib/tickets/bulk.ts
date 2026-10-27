/**
 * Bulk edit: turn one "changes" object into the per-ticket patch that the normal
 * single-ticket rules (lib/tickets/update.ts) then apply ticket by ticket.
 * Pure — no database — so it is unit-tested.
 */
import { HttpError } from '@/lib/training/http';
import type { TicketPatch } from './update';

export const MAX_BULK = 200;

export interface BulkChanges {
  status?: string;
  priority?: string;
  epic_id?: number | null;
  due_date?: string | null;
  label_add?: number[];
  label_remove?: number[];
  assignees?: { mode: 'add' | 'replace' | 'remove'; user_ids: number[] };
  delete?: boolean;
}

export interface BulkPlan {
  /** Patch fields that don't depend on the ticket. */
  patch: TicketPatch;
  labels: { add: number[]; remove: number[] } | null;
  assignees: BulkChanges['assignees'] | null;
  delete: boolean;
}

const ids = (v: unknown, field: string): number[] => {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new HttpError(400, `${field} must be a list`);
  return Array.from(new Set(v.map(Number).filter((n) => Number.isInteger(n) && n > 0)));
};

export function parseBulk(body: { ids?: unknown; changes?: unknown }): { ids: number[]; plan: BulkPlan } {
  const ticketIds = ids(body.ids, 'ids');
  if (!ticketIds.length) throw new HttpError(400, 'Pick at least one ticket');
  if (ticketIds.length > MAX_BULK) throw new HttpError(400, `At most ${MAX_BULK} tickets at a time`);
  const c = (body.changes && typeof body.changes === 'object' ? body.changes : {}) as Record<string, unknown>;

  if (c.delete) {
    const others = Object.keys(c).filter((k) => k !== 'delete' && c[k] !== undefined);
    if (others.length) throw new HttpError(400, 'Delete can’t be combined with other changes');
    return { ids: ticketIds, plan: { patch: {}, labels: null, assignees: null, delete: true } };
  }

  const patch: TicketPatch = {};
  if (c.status !== undefined) patch.status = c.status;
  if (c.priority !== undefined) patch.priority = c.priority;
  if (c.epic_id !== undefined) patch.epic_id = c.epic_id;
  if (c.due_date !== undefined) patch.due_date = c.due_date;

  const add = ids(c.label_add, 'label_add');
  const remove = ids(c.label_remove, 'label_remove');
  if (add.some((x) => remove.includes(x))) throw new HttpError(400, 'A label can’t be added and removed at once');

  let assignees: BulkPlan['assignees'] = null;
  if (c.assignees !== undefined) {
    const a = c.assignees as { mode?: unknown; user_ids?: unknown };
    const mode = a?.mode === 'add' || a?.mode === 'remove' ? a.mode : a?.mode === 'replace' ? 'replace' : null;
    if (!mode) throw new HttpError(400, 'assignees.mode must be add, replace or remove');
    assignees = { mode, user_ids: ids(a.user_ids, 'assignees.user_ids') };
  }

  const labels = add.length || remove.length ? { add, remove } : null;
  if (!Object.keys(patch).length && !labels && !assignees) throw new HttpError(400, 'Nothing to change');
  return { ids: ticketIds, plan: { patch, labels, assignees, delete: false } };
}

/** The label set a ticket ends up with. */
export function nextLabels(current: number[], change: { add: number[]; remove: number[] }): number[] {
  return Array.from(new Set([...current.filter((x) => !change.remove.includes(x)), ...change.add]));
}
