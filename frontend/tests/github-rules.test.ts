import { describe, expect, it } from 'vitest';
import {
  computeHealth, isProductionEnv, isStagingEnv, pktDate, projectAutoMove, repoName, signBody, ticketAutoMove, ticketKeysFor, verifySignature,
} from '@/lib/github/rules';

describe('webhook signatures', () => {
  const body = JSON.stringify({ hello: 'world' });
  it('accepts the right HMAC and rejects anything else', () => {
    const sig = signBody('s3cret', body);
    expect(verifySignature('s3cret', body, sig)).toBe(true);
    expect(verifySignature('other', body, sig)).toBe(false);
    expect(verifySignature('s3cret', body + ' ', sig)).toBe(false);
    expect(verifySignature('s3cret', body, sig.replace('sha256=', 'sha1='))).toBe(false);
    expect(verifySignature('s3cret', body, null)).toBe(false);
    expect(verifySignature('', body, sig)).toBe(false);
    expect(verifySignature('s3cret', body, 'sha256=short')).toBe(false);
  });
});

describe('ticket keys', () => {
  it('finds keys of this project only, in branches, commits and titles', () => {
    expect(ticketKeysFor('PRJ-0012', 'feature/PRJ-0012-T5-login')).toEqual(['PRJ-0012-T5']);
    expect(ticketKeysFor('PRJ-0012', 'fix prj-0012-t7 and PRJ-0012-T8; also PRJ-0013-T1')).toEqual(['PRJ-0012-T7', 'PRJ-0012-T8']);
    expect(ticketKeysFor('PRJ-0012', 'PRJ-00123-T1')).toEqual([]); // a different project with a longer number
    expect(ticketKeysFor('PRJ-0012', 'PRJ-0012-T5x', 'PRJ-0012-T50')).toEqual(['PRJ-0012-T50']);
    expect(ticketKeysFor('PRJ-0012', null, undefined, '')).toEqual([]);
  });
});

describe('automatic ticket moves are forward only', () => {
  it('branch/commit → In progress only from Open', () => {
    expect(ticketAutoMove('open', 'branch')).toBe('in_progress');
    expect(ticketAutoMove('open', 'commit')).toBe('in_progress');
    expect(ticketAutoMove('in_review', 'branch')).toBeNull();
    expect(ticketAutoMove('done', 'commit')).toBeNull();
  });
  it('PR opened → In review from Open / In progress, never back from later states', () => {
    expect(ticketAutoMove('open', 'pr_opened')).toBe('in_review');
    expect(ticketAutoMove('in_progress', 'pr_opened')).toBe('in_review');
    expect(ticketAutoMove('in_qa', 'pr_opened')).toBeNull();
    expect(ticketAutoMove('done', 'pr_opened')).toBeNull(); // a late "opened" after merge doesn't reopen
  });
  it('PR merged → Done from any working state', () => {
    for (const s of ['open', 'in_progress', 'in_review', 'in_qa']) expect(ticketAutoMove(s, 'pr_merged')).toBe('done');
    expect(ticketAutoMove('done', 'pr_merged')).toBeNull();
  });
  it('never touches Triage, Declined or Closed tickets', () => {
    for (const s of ['triage', 'declined', 'closed']) {
      for (const sig of ['branch', 'commit', 'pr_opened', 'pr_merged'] as const) expect(ticketAutoMove(s, sig)).toBeNull();
    }
  });
  it('an unapproved change request does not move', () => {
    expect(ticketAutoMove('open', 'pr_merged', { crBlocked: true })).toBeNull();
    expect(ticketAutoMove('open', 'pr_merged', { crBlocked: false })).toBe('done');
  });
});

describe('automatic project moves', () => {
  it('first push → In progress, PR → In review; never Delivered/Closed; frozen statuses untouched', () => {
    expect(projectAutoMove('new', 'push')).toBe('in_progress');
    expect(projectAutoMove('in_progress', 'push')).toBeNull();
    expect(projectAutoMove('in_progress', 'pr_opened')).toBe('review');
    expect(projectAutoMove('new', 'pr_opened')).toBeNull();
    for (const s of ['on_hold', 'cancelled', 'delivered', 'closed']) {
      expect(projectAutoMove(s, 'push')).toBeNull();
      expect(projectAutoMove(s, 'pr_opened')).toBeNull();
    }
  });
});

describe('environments and repo names', () => {
  it('matches the production environment by name, case-insensitively', () => {
    expect(isProductionEnv('production', 'Production')).toBe(true);
    expect(isProductionEnv(' Live ', 'live')).toBe(true);
    expect(isProductionEnv('staging', 'Production')).toBe(false);
    expect(isProductionEnv(null, 'Production')).toBe(false);
  });
  it('recognises staging-like environments', () => {
    for (const e of ['staging', 'Preview', 'uat', 'qa', 'dev']) expect(isStagingEnv(e)).toBe(true);
    expect(isStagingEnv('production')).toBe(false);
  });
  it('builds GitHub-safe repo names', () => {
    expect(repoName('PRJ-0012', 'Acme Dental, Inc.')).toBe('PRJ-0012-acme-dental-inc');
    expect(repoName('PRJ-0012', '')).toBe('PRJ-0012');
    expect(repoName('PRJ-0012', 'Café Zürich')).toBe('PRJ-0012-cafe-zurich');
  });
});

describe('project health', () => {
  const now = new Date('2026-10-28T12:00:00Z');
  const base = { status: 'in_progress', created_at: '2026-10-01T00:00:00Z', deadline: null as string | null };
  const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
  it('green under 3 days, yellow 3–6 days, red 7+ days', () => {
    expect(computeHealth({ ...base, last_activity_at: ago(2.9) }, now)).toBe('green');
    expect(computeHealth({ ...base, last_activity_at: ago(3) }, now)).toBe('yellow');
    expect(computeHealth({ ...base, last_activity_at: ago(6.9) }, now)).toBe('yellow');
    expect(computeHealth({ ...base, last_activity_at: ago(7) }, now)).toBe('red');
  });
  it('red when past the deadline, whatever the activity', () => {
    expect(computeHealth({ ...base, last_activity_at: ago(0), deadline: '2026-10-27' }, now)).toBe('red');
    expect(computeHealth({ ...base, last_activity_at: ago(0), deadline: '2026-10-28' }, now)).toBe('green');
  });
  it('no activity yet counts from creation; finished projects are green', () => {
    expect(computeHealth({ ...base, last_activity_at: null }, now)).toBe('red');
    expect(computeHealth({ ...base, status: 'delivered', last_activity_at: null, deadline: '2026-01-01' }, now)).toBe('green');
  });
  it('uses the PKT calendar day', () => {
    expect(pktDate(new Date('2026-10-28T20:00:00Z'))).toBe('2026-10-29');
  });
});
