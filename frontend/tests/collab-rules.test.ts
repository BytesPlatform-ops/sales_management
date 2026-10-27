import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ query: vi.fn(), queryOne: vi.fn(), pool: {} }));

import { grantVaultEnvs, levelAtLeast, nextInRotation } from '@/lib/access/grants';
import { ACTIVE_GRANT } from '@/lib/access/grant-sql';
import { handoffNeeded } from '@/lib/tickets/update';
import { cleanSkills, helpDays } from '@/lib/collab/help';
import { canCommentTicket, canEditTicket, canWorkTicket, TicketActor } from '@/lib/tickets/rules';
import { rotationWeek } from '@/lib/tickets/core';

const helper = (grantLevel: TicketActor['grantLevel']): TicketActor =>
  ({ role: 'developer', userId: 9, memberRole: null, projectCreatedBy: 1, grantLevel });

describe('grant levels', () => {
  it('rank view < comment < edit', () => {
    expect(levelAtLeast('edit', 'comment')).toBe(true);
    expect(levelAtLeast('comment', 'comment')).toBe(true);
    expect(levelAtLeast('view', 'comment')).toBe(false);
    expect(levelAtLeast(null, 'view')).toBe(false);
  });
  it('limit what a grant holder can do on a ticket', () => {
    expect([canCommentTicket(helper('view')), canEditTicket(helper('view'), { created_by: 1, status: 'open' }), canWorkTicket(helper('view'))]).toEqual([false, false, false]);
    expect([canCommentTicket(helper('comment')), canEditTicket(helper('comment'), { created_by: 1, status: 'open' }), canWorkTicket(helper('comment'))]).toEqual([true, false, false]);
    expect([canCommentTicket(helper('edit')), canEditTicket(helper('edit'), { created_by: 1, status: 'open' }), canWorkTicket(helper('edit'))]).toEqual([true, true, true]);
    // people with their own access are unaffected
    expect(canCommentTicket({ role: 'agent', userId: 1, memberRole: null, projectCreatedBy: 1 })).toBe(true);
  });
  it('only count while not revoked, started, unexpired and not awaiting approval', () => {
    const sql = ACTIVE_GRANT('g');
    for (const part of ['g.revoked_at IS NULL', 'g.starts_at <= NOW()', 'g.expires_at > NOW()', "pending_approval"]) expect(sql).toContain(part);
  });
});

describe('vault envs from a help grant', () => {
  const g = (scope: any) => ({ scope } as any);
  it('are Development only unless HR approved more', () => {
    expect(grantVaultEnvs(g({ vault_envs: ['development', 'staging', 'production'] }))).toEqual(['development']);
    expect(grantVaultEnvs(g({ vault_envs: ['development', 'staging'], hr_approved: true }))).toEqual(['development', 'staging']);
    expect(grantVaultEnvs(g({}))).toEqual([]);
    expect(grantVaultEnvs(null)).toEqual([]);
  });
});

describe('round-robin', () => {
  it('goes to the next id after the last pick and wraps', () => {
    expect(nextInRotation([5, 3, 9], null)).toBe(3);
    expect(nextInRotation([5, 3, 9], 3)).toBe(5);
    expect(nextInRotation([5, 3, 9], 9)).toBe(3);
    expect(nextInRotation([5, 3, 9], 4)).toBe(5); // last pick no longer eligible
    expect(nextInRotation([], 1)).toBeNull();
  });
  it('triage weeks change on Monday 00:00 PKT', () => {
    const sunNight = new Date('2026-11-01T18:59:00Z'); // Sun 23:59 PKT
    const monMorning = new Date('2026-11-01T19:01:00Z'); // Mon 00:01 PKT
    expect(rotationWeek(monMorning)).toBe(rotationWeek(sunNight) + 1);
  });
});

describe('handoff rule', () => {
  it('is needed only when someone comes off an In-progress ticket', () => {
    expect(handoffNeeded('in_progress', [1, 2], [2])).toBe(true);
    expect(handoffNeeded('in_progress', [1], [1, 2])).toBe(false); // adding only
    expect(handoffNeeded('open', [1], [2])).toBe(false);
    expect(handoffNeeded('in_progress', [], [2])).toBe(false);
  });
});

describe('help request inputs', () => {
  it('normalise skills', () => {
    expect(cleanSkills([' React', 'react', 'Node ', '', 5])).toEqual(['react', 'node', '5']);
    expect(cleanSkills('x')).toEqual([]);
  });
  it('default to 3 days, at most 14', () => {
    expect(helpDays(undefined)).toBe(3);
    expect(helpDays(7)).toBe(7);
    expect(() => helpDays(0)).toThrow();
    expect(() => helpDays(15)).toThrow();
  });
});
