import { describe, expect, it } from 'vitest';
import { canAssignOthers, dueBucket, nextMondayPkt, nextOccurrence, nextOccurrenceAfter, pktAt, resolveWhen } from '@/lib/reminders/rules';

// 2026-10-28 15:30 PKT (Wednesday) = 10:30 UTC
const NOW = new Date('2026-10-28T10:30:00Z');

describe('when presets (PKT)', () => {
  it('in 1 hour', () => {
    expect(resolveWhen('1h', undefined, NOW).toISOString()).toBe('2026-10-28T11:30:00.000Z');
  });
  it('tomorrow 10:00 PKT = 05:00 UTC', () => {
    expect(resolveWhen('tomorrow', undefined, NOW).toISOString()).toBe('2026-10-29T05:00:00.000Z');
  });
  it('tomorrow is the PKT calendar day even late at night UTC', () => {
    // 2026-10-28 23:30 PKT = 18:30 UTC → tomorrow (PKT) is the 29th
    expect(resolveWhen('tomorrow', undefined, new Date('2026-10-28T18:30:00Z')).toISOString()).toBe('2026-10-29T05:00:00.000Z');
    // 2026-10-29 00:30 PKT = 2026-10-28 19:30 UTC → tomorrow (PKT) is the 30th
    expect(resolveWhen('tomorrow', undefined, new Date('2026-10-28T19:30:00Z')).toISOString()).toBe('2026-10-30T05:00:00.000Z');
  });
  it('next Monday 10:00 PKT (a full week ahead on a Monday)', () => {
    expect(nextMondayPkt(NOW).toISOString()).toBe('2026-11-02T05:00:00.000Z');
    expect(nextMondayPkt(new Date('2026-11-02T06:00:00Z')).toISOString()).toBe('2026-11-09T05:00:00.000Z');
  });
  it('pick needs a valid time', () => {
    expect(resolveWhen('pick', '2026-11-01T09:00:00Z', NOW).toISOString()).toBe('2026-11-01T09:00:00.000Z');
    expect(() => resolveWhen('pick', 'nope', NOW)).toThrow(/Pick a date/);
    expect(() => resolveWhen('yesterday', undefined, NOW)).toThrow(/Unknown/);
  });
  it('pktAt builds wall-clock PKT times', () => {
    expect(pktAt(NOW, 0, 0).toISOString()).toBe('2026-10-27T19:00:00.000Z');
  });
});

describe('repeats', () => {
  const at = (s: string) => new Date(s);
  it('daily and weekly keep the time of day', () => {
    expect(nextOccurrence(at('2026-10-28T05:00:00Z'), 'daily')!.toISOString()).toBe('2026-10-29T05:00:00.000Z');
    expect(nextOccurrence(at('2026-10-28T05:00:00Z'), 'weekly')!.toISOString()).toBe('2026-11-04T05:00:00.000Z');
    expect(nextOccurrence(at('2026-10-28T05:00:00Z'), 'none')).toBeNull();
  });
  it('monthly keeps the day of month and clamps short months', () => {
    // Jan 31 10:00 PKT → Feb 28 → (repeat day 31) Mar 31
    const jan31 = at('2027-01-31T05:00:00Z');
    const feb = nextOccurrence(jan31, 'monthly', 31)!;
    expect(feb.toISOString()).toBe('2027-02-28T05:00:00.000Z');
    expect(nextOccurrence(feb, 'monthly', 31)!.toISOString()).toBe('2027-03-31T05:00:00.000Z');
    // leap year
    expect(nextOccurrence(at('2028-01-31T05:00:00Z'), 'monthly', 31)!.toISOString()).toBe('2028-02-29T05:00:00.000Z');
    // December → January next year
    expect(nextOccurrence(at('2026-12-15T05:00:00Z'), 'monthly')!.toISOString()).toBe('2027-01-15T05:00:00.000Z');
  });
  it('monthly uses the PKT day, not the UTC day', () => {
    // 2026-10-31 02:00 PKT is still Oct 30 in UTC
    const d = at('2026-10-30T21:00:00Z');
    expect(nextOccurrence(d, 'monthly')!.toISOString()).toBe('2026-11-29T21:00:00.000Z'); // Nov 30 02:00 PKT (clamped from 31)
  });
  it('skips occurrences missed while the app was down', () => {
    const next = nextOccurrenceAfter(at('2026-10-20T05:00:00Z'), 'daily', NOW)!;
    expect(next.toISOString()).toBe('2026-10-29T05:00:00.000Z');
  });
});

describe('who may remind whom', () => {
  it('developers only themselves; agents and HR others on items; standalone is personal except HR', () => {
    expect(canAssignOthers('developer', 'ticket')).toBe(false);
    expect(canAssignOthers('agent', 'ticket')).toBe(true);
    expect(canAssignOthers('hr', 'brief_entry')).toBe(true);
    expect(canAssignOthers('agent', 'none')).toBe(false);
    expect(canAssignOthers('hr', 'none')).toBe(true);
  });
});

describe('My reminders grouping', () => {
  it('overdue / today (PKT) / upcoming', () => {
    expect(dueBucket(new Date('2026-10-28T10:00:00Z'), NOW)).toBe('overdue');
    expect(dueBucket(new Date('2026-10-28T18:00:00Z'), NOW)).toBe('today');      // 23:00 PKT
    expect(dueBucket(new Date('2026-10-28T19:30:00Z'), NOW)).toBe('upcoming');   // 00:30 PKT next day
  });
});
