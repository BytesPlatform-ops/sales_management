/**
 * Keyboard shortcuts (pure, so it can be tested). The palette component turns the
 * returned action into a click/focus on an element with a matching data-shortcut,
 * so pages opt in just by tagging elements.
 *
 *   Ctrl/Cmd+K, /   command palette          ?   shortcut help
 *   ticket page:    E edit description  S status  A assignees
 *   project page:   C new ticket
 *   lists:          J / K next / previous item ([data-nav-item])
 */
export type ShortcutAction =
  | { kind: 'palette' } | { kind: 'help' } | { kind: 'new-ticket'; projectId: number }
  | { kind: 'click'; target: string } | { kind: 'focus'; target: string } | { kind: 'nav'; dir: 1 | -1 };

export interface KeyInput { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; typing: boolean; pathname: string }

export const SHORTCUT_HELP: { keys: string; what: string }[] = [
  { keys: 'Ctrl/⌘ K  or  /', what: 'Search and commands' },
  { keys: '?', what: 'This list' },
  { keys: 'C', what: 'New ticket (on a project)' },
  { keys: 'E', what: 'Edit description (on a ticket)' },
  { keys: 'S', what: 'Change status (on a ticket)' },
  { keys: 'A', what: 'Change assignees (on a ticket)' },
  { keys: 'J / K', what: 'Next / previous item in a list' },
];

/** Is the user typing in a field? Then single-key shortcuts must not fire. */
export function isTypingTarget(el: { tagName?: string; isContentEditable?: boolean } | null | undefined): boolean {
  if (!el) return false;
  const tag = (el.tagName || '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el.isContentEditable;
}

export function projectIdFromPath(pathname: string): number | null {
  const m = /^\/projects\/(\d+)(?:\/|$)/.exec(pathname);
  return m ? Number(m[1]) : null;
}

export function shortcutFor(e: KeyInput): ShortcutAction | null {
  if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') return { kind: 'palette' };
  if (e.typing || e.metaKey || e.ctrlKey || e.altKey) return null;
  if (e.key === '/') return { kind: 'palette' };
  if (e.key === '?') return { kind: 'help' };
  const k = e.key.toLowerCase();
  const onTicket = /^\/projects\/\d+\/tickets\/[^/]+$/.test(e.pathname);
  const pid = projectIdFromPath(e.pathname);
  if (onTicket) {
    if (k === 'e') return { kind: 'click', target: 'edit-description' };
    if (k === 's') return { kind: 'focus', target: 'status' };
    if (k === 'a') return { kind: 'click', target: 'assignees' };
  } else if (pid && k === 'c') {
    return { kind: 'new-ticket', projectId: pid };
  }
  if (k === 'j') return { kind: 'nav', dir: 1 };
  if (k === 'k') return { kind: 'nav', dir: -1 };
  return null;
}
