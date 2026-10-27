import { describe, expect, it } from 'vitest';
import {
  branchName, canCreateTicket, canEditTicket, canTriage, canWorkTicket, initialStatus, rankBetween, statusMoveError, TicketActor, triageDueAt,
} from '@/lib/tickets/rules';

const AGENT = 2, OTHER_AGENT = 9, DEV = 3, LEAD = 4, HR = 1;
const actor = (role: TicketActor['role'], userId: number, memberRole: string | null = null, triageOwnerId: number | null = null): TicketActor =>
  ({ role, userId, memberRole, projectCreatedBy: AGENT, triageOwnerId });

const hr = actor('hr', HR);
const agent = actor('agent', AGENT);
const otherAgent = actor('agent', OTHER_AGENT);
const dev = actor('developer', DEV, 'developer');
const lead = actor('developer', LEAD, 'lead_developer');
const outsider = actor('developer', 77, null);
const watcherDev = actor('developer', 78, 'watcher');

describe('who may create and triage', () => {
  it('HR, project developers and the client’s agent can create; others cannot', () => {
    expect([hr, agent, dev, lead].map(canCreateTicket)).toEqual([true, true, true, true]);
    expect([otherAgent, outsider, watcherDev].map(canCreateTicket)).toEqual([false, false, false]);
  });
  it('agent tickets (and brief/meeting/client-link ones) start in Triage', () => {
    expect(initialStatus(agent)).toBe('triage');
    expect(initialStatus(dev)).toBe('open');
    expect(initialStatus(hr, 'brief')).toBe('triage');
    expect(initialStatus(dev, 'meeting')).toBe('triage');
  });
  it('only HR, the lead developer or the triage owner can triage', () => {
    expect(canTriage(hr)).toBe(true);
    expect(canTriage(lead)).toBe(true);
    expect(canTriage(dev)).toBe(false);
    expect(canTriage(actor('developer', DEV, 'developer', DEV))).toBe(true);
    expect(canTriage(agent)).toBe(false);
  });
});

describe('editing and working tickets', () => {
  it('agents edit only their own ticket while it is in Triage or Open', () => {
    expect(canEditTicket(agent, { created_by: AGENT, status: 'triage' })).toBe(true);
    expect(canEditTicket(agent, { created_by: AGENT, status: 'open' })).toBe(true);
    expect(canEditTicket(agent, { created_by: AGENT, status: 'in_progress' })).toBe(false);
    expect(canEditTicket(agent, { created_by: DEV, status: 'open' })).toBe(false);
    expect(canEditTicket(dev, { created_by: AGENT, status: 'in_progress' })).toBe(true);
  });
  it('agents and outsiders cannot change status or assign', () => {
    expect([hr, dev, lead].map(canWorkTicket)).toEqual([true, true, true]);
    expect([agent, outsider, watcherDev].map(canWorkTicket)).toEqual([false, false, false]);
  });
});

describe('status moves', () => {
  const t = (over = {}) => ({ status: 'open' as const, type: 'task', cr_status: null, ...over });
  it('allows normal work moves for developers', () => {
    expect(statusMoveError(dev, t(), 'in_progress')).toBeNull();
    expect(statusMoveError(dev, t({ status: 'in_progress' }), 'done')).toBeNull();
  });
  it('requires triage actions to leave or enter Triage', () => {
    expect(statusMoveError(hr, t({ status: 'triage' }), 'open')).toMatch(/Triage first/);
    expect(statusMoveError(hr, t(), 'declined')).toMatch(/triage actions/);
  });
  it('only HR or the lead developer close tickets', () => {
    expect(statusMoveError(dev, t({ status: 'done' }), 'closed')).toMatch(/HR or the lead/);
    expect(statusMoveError(lead, t({ status: 'done' }), 'closed')).toBeNull();
  });
  it('a change request cannot start until HR approves it', () => {
    expect(statusMoveError(dev, t({ type: 'change_request', cr_status: 'pending' }), 'in_progress')).toMatch(/HR approval/);
    expect(statusMoveError(hr, t({ type: 'change_request', cr_status: 'rejected' }), 'done')).toMatch(/HR approval/);
    expect(statusMoveError(dev, t({ type: 'change_request', cr_status: 'approved' }), 'in_progress')).toBeNull();
  });
  it('agents cannot move status', () => {
    expect(statusMoveError(agent, t(), 'in_progress')).toMatch(/developers or HR/);
  });
});

describe('triage SLA', () => {
  it('urgent 4h, high 24h, normal 3 days, low 7 days; overridable', () => {
    const at = new Date('2026-10-28T10:00:00Z');
    expect(triageDueAt(at, 'urgent').toISOString()).toBe('2026-10-28T14:00:00.000Z');
    expect(triageDueAt(at, 'high').toISOString()).toBe('2026-10-29T10:00:00.000Z');
    expect(triageDueAt(at, 'normal').toISOString()).toBe('2026-10-31T10:00:00.000Z');
    expect(triageDueAt(at, 'low').toISOString()).toBe('2026-11-04T10:00:00.000Z');
    expect(triageDueAt(at, 'urgent', { urgent: 1 }).toISOString()).toBe('2026-10-28T11:00:00.000Z');
  });
});

describe('branch names', () => {
  it('carry the ticket key so GitHub tracking can link them', () => {
    expect(branchName('PRJ-0012-T5', 'Login page: fix Safari!', 'bug')).toBe('fix/PRJ-0012-T5-login-page-fix-safari');
    expect(branchName('PRJ-0012-T6', 'Add booking', 'feature')).toBe('feature/PRJ-0012-T6-add-booking');
    expect(branchName('PRJ-0012-T7', '!!!', 'task')).toBe('feature/PRJ-0012-T7');
  });
});

describe('backlog ranks', () => {
  it('always produce a rank strictly between neighbours, however often you insert', () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const list: string[] = [rankBetween(null, null)];
    for (let i = 0; i < 2000; i++) {
      const pos = Math.floor(rnd() * (list.length + 1));
      const r = rankBetween(list[pos - 1] ?? null, list[pos] ?? null);
      if (pos > 0) expect(r > list[pos - 1]).toBe(true);
      if (pos < list.length) expect(r < list[pos]).toBe(true);
      expect(r.endsWith('a')).toBe(false);
      list.splice(pos, 0, r);
    }
    expect(new Set(list).size).toBe(list.length);
  });
  it('keeps appending at the end short', () => {
    let r = rankBetween(null, null);
    for (let i = 0; i < 100; i++) r = rankBetween(r, null);
    expect(r.length).toBeLessThan(12);
  });
  it('rejects neighbours out of order', () => {
    expect(() => rankBetween('n', 'c')).toThrow();
  });
});
