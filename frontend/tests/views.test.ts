import { describe, expect, it } from 'vitest';
import { MAX_BULK, nextLabels, parseBulk } from '@/lib/tickets/bulk';
import { dropIndex, dropNeighbours, laneGroups, sanitizeWipLimits, wipState } from '@/lib/tickets/board';
import { canEditView, canSeeView, sanitizeViewConfig, viewHref } from '@/lib/saved-views';
import { filterTasks, NO_WORK_FILTERS } from '@/components/tickets/my-work';

describe('bulk edit parsing', () => {
  it('needs tickets and at least one change, within the limit', () => {
    expect(() => parseBulk({ ids: [], changes: { status: 'done' } })).toThrow(/at least one/);
    expect(() => parseBulk({ ids: [1], changes: {} })).toThrow(/Nothing to change/);
    expect(() => parseBulk({ ids: Array.from({ length: MAX_BULK + 1 }, (_, i) => i + 1), changes: { status: 'done' } })).toThrow(/At most/);
  });
  it('rejects contradictory or malformed changes', () => {
    expect(() => parseBulk({ ids: [1], changes: { delete: true, status: 'done' } })).toThrow(/Delete/);
    expect(() => parseBulk({ ids: [1], changes: { label_add: [2], label_remove: [2] } })).toThrow(/added and removed/);
    expect(() => parseBulk({ ids: [1], changes: { assignees: { mode: 'swap', user_ids: [1] } } })).toThrow(/mode/);
  });
  it('builds one plan applied per ticket; ids are de-duplicated', () => {
    const { ids, plan } = parseBulk({ ids: [3, 3, '4', -1, 'x'], changes: { status: 'in_progress', priority: 'high', label_add: [7], assignees: { mode: 'add', user_ids: [9] } } });
    expect(ids).toEqual([3, 4]);
    expect(plan.patch).toEqual({ status: 'in_progress', priority: 'high' });
    expect(plan.labels).toEqual({ add: [7], remove: [] });
    expect(plan.assignees).toEqual({ mode: 'add', user_ids: [9] });
    expect(plan.delete).toBe(false);
  });
  it('merges label changes into each ticket’s current labels', () => {
    expect(nextLabels([1, 2, 3], { add: [4, 1], remove: [2] }).sort()).toEqual([1, 3, 4]);
  });
});

describe('board', () => {
  it('keeps only sensible WIP limits for work columns', () => {
    expect(sanitizeWipLimits({ in_progress: 3, in_review: '2', done: 0, triage: 5, closed: 4, in_qa: 1.5, open: 1000 })).toEqual({ in_progress: 3, in_review: 2 });
    expect(sanitizeWipLimits(null)).toEqual({});
  });
  it('warns amber at the limit and red above it — never blocks', () => {
    expect(wipState(2, undefined)).toBe('none');
    expect(wipState(2, 3)).toBe('ok');
    expect(wipState(3, 3)).toBe('near');
    expect(wipState(4, 3)).toBe('over');
  });
  it('groups swimlanes; multi-assignee tickets appear in each lane, unassigned last', () => {
    const t = (id: number, priority: string, assignees: string[], epic: [number, string] | null = null) => ({
      id, priority, epic_id: epic?.[0] ?? null, epic_title: epic?.[1] ?? null, assignees: assignees.map((n) => ({ id: n, name: n })),
    });
    const tickets = [t(1, 'low', ['Zed', 'Ali']), t(2, 'urgent', []), t(3, 'normal', ['Ali'], [5, 'Build'])];
    expect(laneGroups(tickets, 'assignee').map((l) => [l.label, l.tickets.map((x) => x.id)])).toEqual([['Ali', [1, 3]], ['Zed', [1]], ['Unassigned', [2]]]);
    expect(laneGroups(tickets, 'priority').map((l) => l.label)).toEqual(['Urgent', 'Normal', 'Low']);
    expect(laneGroups(tickets, 'epic').map((l) => l.label)).toEqual(['Build', 'No epic']);
    expect(laneGroups(tickets, 'none')[0].tickets).toHaveLength(3);
  });
  it('computes neighbours for a drop, ignoring the dragged ticket', () => {
    expect(dropNeighbours([1, 2, 3, 4], 2, 0)).toEqual({ after_id: null, before_id: 1 });
    expect(dropNeighbours([1, 2, 3, 4], 2, 2)).toEqual({ after_id: 3, before_id: 4 });
    expect(dropNeighbours([1, 2, 3, 4], 2, 3)).toEqual({ after_id: 4, before_id: null });
    expect(dropNeighbours([1, 3], 9, 1)).toEqual({ after_id: 1, before_id: 3 });
    expect(dropNeighbours([], 9, 0)).toEqual({ after_id: null, before_id: null });
  });
  it('drops above a card’s middle before it, below after it', () => {
    expect(dropIndex(2, 105, { top: 100, height: 40 })).toBe(2);
    expect(dropIndex(2, 130, { top: 100, height: 40 })).toBe(3);
  });
});

describe('saved views', () => {
  it('keeps only known config keys and short values', () => {
    const c = sanitizeViewConfig({ filters: { q: 'x'.repeat(500), assignee: 'me', evil: 'drop table', blocked: true }, swimlane: 'epic', sort: { key: 'due_date', dir: -1 },
      columns: ['status', 'bad column!', 'due'], extra: { a: 1 } });
    expect(c.filters).toEqual({ q: 'x'.repeat(200), assignee: 'me', blocked: 'true' });
    expect(c.swimlane).toBe('epic');
    expect(c.sort).toEqual({ key: 'due_date', dir: -1 });
    expect(c.columns).toEqual(['status', 'due']);
    expect((c as any).extra).toBeUndefined();
    expect(sanitizeViewConfig({ swimlane: 'bogus' }).swimlane).toBeUndefined();
  });
  it('personal views are the owner’s only; shared follow the project', () => {
    const dev = { userId: 2, role: 'developer' as const };
    const agent = { userId: 3, role: 'agent' as const };
    const hr = { userId: 4, role: 'hr' as const };
    const personal = { owner_id: 1, scope: 'personal' as const, project_id: 10 };
    const shared = { owner_id: 1, scope: 'shared' as const, project_id: 10 };
    const global = { owner_id: 1, scope: 'shared' as const, project_id: null };
    expect(canSeeView({ userId: 1, role: 'agent' }, personal, false)).toBe(true);
    expect(canSeeView(hr, personal, true)).toBe(false);
    expect(canSeeView(dev, shared, true)).toBe(true);
    expect(canSeeView(dev, shared, false)).toBe(false);
    expect(canSeeView(dev, global, false)).toBe(true);
    expect(canSeeView(agent, global, false)).toBe(false);
    expect(canEditView(dev, shared)).toBe(false);
    expect(canEditView(hr, shared)).toBe(true);
    expect(canEditView({ userId: 1, role: 'agent' }, shared)).toBe(true);
  });
  it('links project views to the Tickets tab and My Work views to My Tasks', () => {
    expect(viewHref({ id: 5, project_id: 3, view_type: 'board' })).toBe('/projects/3?tab=tickets&view=5');
    expect(viewHref({ id: 6, project_id: null, view_type: 'my_work' })).toBe('/my-tasks?view=6');
  });
});

describe('My Work filters', () => {
  const rows = [
    { id: 1, project_id: 1, type: 'bug', priority: 'high', blocked: true, estimate_hours: null },
    { id: 2, project_id: 2, type: 'task', priority: 'normal', blocked: false, estimate_hours: '3' },
  ] as any[];
  it('filters by project, type, priority, blocked and missing estimate', () => {
    expect(filterTasks(rows, NO_WORK_FILTERS)).toHaveLength(2);
    expect(filterTasks(rows, { ...NO_WORK_FILTERS, project_id: '2' }).map((r) => r.id)).toEqual([2]);
    expect(filterTasks(rows, { ...NO_WORK_FILTERS, blocked: '1' }).map((r) => r.id)).toEqual([1]);
    expect(filterTasks(rows, { ...NO_WORK_FILTERS, no_estimate: '1', type: 'bug', priority: 'high' }).map((r) => r.id)).toEqual([1]);
  });
});
