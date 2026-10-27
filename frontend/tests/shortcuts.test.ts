import { describe, expect, it } from 'vitest';
import { isTypingTarget, shortcutFor } from '@/lib/shortcuts';

const k = (key: string, pathname = '/projects', o: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; typing: boolean }> = {}) =>
  shortcutFor({ key, pathname, typing: false, ...o });

describe('keyboard shortcuts', () => {
  it('Ctrl/Cmd+K opens the palette even while typing', () => {
    expect(k('k', '/', { metaKey: true, typing: true })).toEqual({ kind: 'palette' });
    expect(k('K', '/', { ctrlKey: true })).toEqual({ kind: 'palette' });
  });
  it('single keys never fire while typing or with modifiers', () => {
    expect(k('/', '/', { typing: true })).toBeNull();
    expect(k('e', '/projects/1/tickets/PRJ-0001-T1', { typing: true })).toBeNull();
    expect(k('c', '/projects/1', { metaKey: true })).toBeNull();
  });
  it('/ and ? anywhere', () => {
    expect(k('/')).toEqual({ kind: 'palette' });
    expect(k('?')).toEqual({ kind: 'help' });
  });
  it('ticket page: E S A', () => {
    const p = '/projects/3/tickets/PRJ-0003-T9';
    expect(k('e', p)).toEqual({ kind: 'click', target: 'edit-description' });
    expect(k('s', p)).toEqual({ kind: 'focus', target: 'status' });
    expect(k('a', p)).toEqual({ kind: 'click', target: 'assignees' });
    expect(k('c', p)).toBeNull();
  });
  it('project page: C creates a ticket there; elsewhere it does nothing', () => {
    expect(k('c', '/projects/7')).toEqual({ kind: 'new-ticket', projectId: 7 });
    expect(k('c', '/my-tasks')).toBeNull();
    expect(k('e', '/projects/7')).toBeNull();
  });
  it('J/K move through lists', () => {
    expect(k('j', '/my-tasks')).toEqual({ kind: 'nav', dir: 1 });
    expect(k('k', '/my-tasks')).toEqual({ kind: 'nav', dir: -1 });
  });
  it('knows what counts as typing', () => {
    expect(isTypingTarget({ tagName: 'input' })).toBe(true);
    expect(isTypingTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isTypingTarget({ tagName: 'BUTTON' })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
