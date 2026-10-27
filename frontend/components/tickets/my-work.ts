import type { TicketCard } from './lib';

/** My Tasks filters. Applied in the browser: it's at most a few hundred open tickets. */
export interface WorkFilters { project_id: string; type: string; priority: string; blocked: string; no_estimate: string }
export const NO_WORK_FILTERS: WorkFilters = { project_id: '', type: '', priority: '', blocked: '', no_estimate: '' };

export function filterTasks<T extends Pick<TicketCard, 'project_id' | 'type' | 'priority' | 'blocked' | 'estimate_hours'>>(rows: T[], f: WorkFilters): T[] {
  return rows.filter((t) =>
    (!f.project_id || String(t.project_id) === f.project_id)
    && (!f.type || t.type === f.type)
    && (!f.priority || t.priority === f.priority)
    && (!f.blocked || t.blocked)
    && (!f.no_estimate || t.estimate_hours == null));
}
