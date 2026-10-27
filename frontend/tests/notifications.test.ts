import { describe, expect, it } from 'vitest';
import { projectIdFromLink, recipients } from '@/lib/notifications';
import { splitIds } from '@/lib/inbox';
import { pktDate, pktHour } from '@/lib/notifications-daily';

describe('notification helpers', () => {
  it('never notifies the actor, de-dupes, drops junk ids', () => {
    expect(recipients([3, 4, 3, 5], 4)).toEqual([3, 5]);
    expect(recipients([NaN, 0, -1, 7], null)).toEqual([7]);
  });
  it('finds the project in a link', () => {
    expect(projectIdFromLink('/projects/12/tickets/PRJ-0012-T5')).toBe(12);
    expect(projectIdFromLink('/projects/12?tab=env')).toBe(12);
    expect(projectIdFromLink('/projects/calendar')).toBeNull();
    expect(projectIdFromLink(null)).toBeNull();
  });
  it('splits inbox and training ids, ignoring anything else', () => {
    expect(splitIds(['n12', 't7', 'x1', 'n', 5, 'n3; DROP'])).toEqual({ inbox: [12], training: [7] });
    expect(splitIds('n1')).toEqual({ inbox: [], training: [] });
  });
  it('works in Pakistan time', () => {
    const at = new Date('2026-10-28T20:30:00Z'); // 01:30 PKT on the 29th
    expect(pktDate(at)).toBe('2026-10-29');
    expect(pktDate(at, 1)).toBe('2026-10-30');
    expect(pktHour(at)).toBe(1);
    expect(pktHour(new Date('2026-10-28T04:00:00Z'))).toBe(9);
  });
});
