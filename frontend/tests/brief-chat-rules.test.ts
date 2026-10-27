import { describe, expect, it } from 'vitest';
import { briefEditMode, canAddBrief, canEditBrief, canMarkBrief, cleanTags, BriefActor } from '@/lib/brief/rules';
import { canDeleteMessage, canEditMessage, canForwardMessage, cleanVoiceMeta, linksIn, peaksFrom, readStatus, seenBy } from '@/lib/chat/rules';

const A = (role: BriefActor['role'], userId: number, memberRole: string | null = null): BriefActor => ({ role, userId, memberRole, projectCreatedBy: 2 });

describe('brief permissions', () => {
  it('only HR and the client’s agent add; developers mark; others nothing', () => {
    expect(canAddBrief(A('hr', 1))).toBe(true);
    expect(canAddBrief(A('agent', 2))).toBe(true);
    expect(canAddBrief(A('agent', 9))).toBe(false);
    expect(canAddBrief(A('developer', 3, 'developer'))).toBe(false);
    expect(canMarkBrief(A('developer', 3, 'developer'))).toBe(true);
    expect(canMarkBrief(A('developer', 4, 'lead_developer'))).toBe(true);
    expect(canMarkBrief(A('developer', 5, 'watcher'))).toBe(false);
    expect(canMarkBrief(A('agent', 2))).toBe(false);
  });
  it('the author (still allowed to add) or HR edits', () => {
    expect(canEditBrief(A('agent', 2), { created_by: 2 })).toBe(true);
    expect(canEditBrief(A('agent', 2), { created_by: 1 })).toBe(false);
    expect(canEditBrief(A('hr', 1), { created_by: 2 })).toBe(true);
    expect(canEditBrief(A('developer', 3, 'developer'), { created_by: 3 })).toBe(false);
  });
  it('edits within 24h replace in place, later ones are new versions', () => {
    const now = Date.parse('2026-10-28T12:00:00Z');
    expect(briefEditMode('2026-10-28T00:00:00Z', now)).toBe('in_place');
    expect(briefEditMode('2026-10-27T12:00:00Z', now)).toBe('in_place');
    expect(briefEditMode('2026-10-27T11:59:00Z', now)).toBe('new_version');
  });
  it('keeps only known tags', () => {
    expect(cleanTags(['waiting_on_client', 'x', 'waiting_on_client'])).toEqual(['waiting_on_client']);
    expect(cleanTags('nope')).toEqual([]);
  });
});

describe('chat edit/delete windows', () => {
  const now = Date.parse('2026-10-28T12:00:00Z');
  const msg = (over = {}) => ({ user_id: 3, created_at: '2026-10-28T11:50:00Z', kind: 'message' as const, deleted_at: null, ...over });
  const dev = { userId: 3, role: 'developer' as const };
  const other = { userId: 4, role: 'developer' as const };
  const hr = { userId: 1, role: 'hr' as const };

  it('your own message can be edited and deleted for 15 minutes', () => {
    expect(canEditMessage(msg(), dev, now)).toBe(true);
    expect(canDeleteMessage(msg(), dev, now)).toBe(true);
    const old = msg({ created_at: '2026-10-28T11:44:00Z' });
    expect(canEditMessage(old, dev, now)).toBe(false);
    expect(canDeleteMessage(old, dev, now)).toBe(false);
  });
  it('nobody edits someone else’s message; HR may delete any time', () => {
    expect(canEditMessage(msg(), other, now)).toBe(false);
    expect(canDeleteMessage(msg(), other, now)).toBe(false);
    expect(canEditMessage(msg(), hr, now)).toBe(false);
    expect(canDeleteMessage(msg({ created_at: '2026-01-01T00:00:00Z' }), hr, now)).toBe(true);
  });
  it('system messages and deleted ones are untouchable; voice notes have no text to edit', () => {
    expect(canDeleteMessage(msg({ kind: 'system' }), hr, now)).toBe(false);
    expect(canDeleteMessage(msg({ deleted_at: '2026-10-28T11:55:00Z' }), hr, now)).toBe(false);
    expect(canEditMessage(msg({ kind: 'voice' }), dev, now)).toBe(false);
  });
  it('only HR forwards', () => {
    expect(canForwardMessage(hr)).toBe(true);
    expect(canForwardMessage(dev)).toBe(false);
  });
});

describe('read receipts', () => {
  const reads = new Map([[1, 10], [2, 7], [3, 12]]);
  it('✓✓ only when every other participant has read it', () => {
    expect(readStatus(7, 3, [1, 2, 3], reads)).toBe('read');
    expect(readStatus(8, 3, [1, 2, 3], reads)).toBe('sent');
    expect(readStatus(9, 2, [1, 2, 3], reads)).toBe('read');
  });
  it('lists who has seen a message, excluding its author', () => {
    expect(seenBy(9, 3, [1, 2, 3], reads)).toEqual([1]);
    expect(seenBy(7, 1, [1, 2, 3], reads)).toEqual([2, 3]);
  });
});

describe('links, voice notes', () => {
  it('finds links without fetching them', () => {
    expect(linksIn('see https://www.example.com/a/b?x=1 and http://foo.test')).toEqual([
      { href: 'https://www.example.com/a/b?x=1', host: 'example.com', path: '/a/b?x=1' },
      { href: 'http://foo.test/', host: 'foo.test', path: '/' },
    ]);
    expect(linksIn('javascript:alert(1) ftp://x')).toEqual([]);
  });
  it('downsamples audio into normalised peaks', () => {
    expect(peaksFrom([0, 0.5, -1, 0.25, 0, 0, 0.1, -0.2], 4)).toEqual([0.5, 1, 0, 0.2]);
    expect(peaksFrom([], 3)).toEqual([0, 0, 0]);
  });
  it('accepts voice notes up to 5 minutes and clamps peaks', () => {
    expect(cleanVoiceMeta({ duration: 12.34, peaks: [2, -1, 0.5] })).toEqual({ duration: 12.3, peaks: [1, 0, 0.5] });
    expect(cleanVoiceMeta({ duration: 302 })).toBeNull();
    expect(cleanVoiceMeta({ duration: 0 })).toBeNull();
    expect(cleanVoiceMeta(null)).toBeNull();
  });
});
