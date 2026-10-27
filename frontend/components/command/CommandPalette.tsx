'use client';

/**
 * Ctrl/Cmd+K command palette + global keyboard shortcuts. Mounted once in the
 * dashboard layout. Search hits come from /api/search (already permission-filtered).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Search, Ticket, FolderKanban, MessageSquare, File as FileIcon, MessagesSquare, Plus, ListTodo, Inbox, KeyRound, CornerDownLeft, Keyboard } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePapi, papi } from '@/components/projects/lib';
import { isTypingTarget, projectIdFromPath, shortcutFor, SHORTCUT_HELP } from '@/lib/shortcuts';

interface Hit { kind: string; id: string; title: string; subtitle?: string; snippet?: string; href: string }
interface SearchResult { groups: { kind: string; label: string; hits: Hit[] }[]; jump: string | null }
interface Row { id: string; label: string; sub?: string; snippet?: string; icon: typeof Search; run: () => void; group: string }

const KIND_ICON: Record<string, typeof Search> = { ticket: Ticket, project: FolderKanban, comment: MessageSquare, file: FileIcon, message: MessagesSquare };

export function CommandPalette() {
  const router = useRouter();
  const pathname = usePathname() || '';
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [q, setQ] = useState('');
  const [res, setRes] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const projectId = projectIdFromPath(pathname);
  // Same SWR key as the project page, so this is usually already cached.
  const { data: project } = usePapi<{ permissions: { env?: Record<string, boolean>; role: string } }>(open && projectId ? `/api/projects/${projectId}` : null);

  const close = useCallback(() => { setOpen(false); setQ(''); setRes(null); setActive(0); }, []);
  const go = useCallback((href: string) => { close(); router.push(href); }, [close, router]);

  // Global keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = shortcutFor({ key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, typing: isTypingTarget(e.target as HTMLElement), pathname });
      if (!a) return;
      if (a.kind !== 'palette' && (open || help || document.querySelector('[role="dialog"][aria-modal="true"]'))) return;
      e.preventDefault();
      if (a.kind === 'palette') { setHelp(false); setOpen((o) => !o); return; }
      if (a.kind === 'help') { setHelp(true); return; }
      if (a.kind === 'new-ticket') {
        const btn = document.querySelector<HTMLElement>('[data-shortcut="new-ticket"] button, [data-shortcut="new-ticket"]');
        if (btn) btn.click(); else router.push(`/projects/${a.projectId}?tab=tickets&new=1`);
        return;
      }
      if (a.kind === 'click' || a.kind === 'focus') {
        const el = document.querySelector<HTMLElement>(`[data-shortcut="${a.target}"]`);
        if (a.kind === 'focus') el?.focus(); else el?.click();
        return;
      }
      if (a.kind === 'nav') {
        const items = Array.from(document.querySelectorAll<HTMLElement>('[data-nav-item]')).filter((x) => x.offsetParent !== null);
        if (!items.length) return;
        const i = items.indexOf(document.activeElement as HTMLElement);
        const next = items[i < 0 ? (a.dir > 0 ? 0 : items.length - 1) : Math.min(items.length - 1, Math.max(0, i + a.dir))];
        next.focus();
        next.scrollIntoView({ block: 'nearest' });
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pathname, open, help, router]);

  useEffect(() => { if (open) setTimeout(() => input.current?.focus(), 10); }, [open]);

  // Debounced search.
  useEffect(() => {
    if (!open) return;
    const text = q.trim();
    if (!text) { setRes(null); return; }
    setLoading(true);
    const t = setTimeout(() => {
      papi<SearchResult>(`/api/search?q=${encodeURIComponent(text)}&limit=6`)
        .then((r) => { setRes(r); setActive(0); })
        .catch(() => setRes({ groups: [], jump: null }))
        .finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(t);
  }, [q, open]);

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    if (res?.jump) out.push({ id: 'jump', label: `Open ${q.trim().toUpperCase()}`, icon: CornerDownLeft, group: 'Go to', run: () => go(res.jump!) });
    for (const g of res?.groups || []) {
      for (const h of g.hits) {
        out.push({ id: `${g.kind}:${h.id}`, label: h.title, sub: h.subtitle, snippet: h.snippet, icon: KIND_ICON[g.kind] || Search, group: g.label, run: () => go(h.href) });
      }
    }
    const actions: Row[] = [
      projectId
        ? { id: 'new', label: 'Create ticket in this project', icon: Plus, group: 'Actions', run: () => { close(); const b = document.querySelector<HTMLElement>('[data-shortcut="new-ticket"] button'); if (b) b.click(); else router.push(`/projects/${projectId}?tab=tickets&new=1`); } }
        : { id: 'new', label: 'Create ticket… (pick a project)', icon: Plus, group: 'Actions', run: () => go('/projects') },
      { id: 'tasks', label: 'Go to My Tasks', icon: ListTodo, group: 'Actions', run: () => go('/my-tasks') },
      { id: 'inbox', label: 'Go to Inbox', icon: Inbox, group: 'Actions', run: () => go('/inbox') },
    ];
    if (projectId && project?.permissions.env && Object.values(project.permissions.env).some(Boolean)) {
      actions.push({ id: 'env', label: 'Open Env of this project', icon: KeyRound, group: 'Actions', run: () => go(`/projects/${projectId}?tab=env`) });
    }
    const text = q.trim().toLowerCase();
    out.push(...actions.filter((a) => !text || a.label.toLowerCase().includes(text) || out.length === 0));
    return out;
  }, [res, q, projectId, project, go, close, router]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-row="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(rows.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); rows[active]?.run(); }
  }

  let lastGroup = '';
  return (
    <>
      {open && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/40 p-3 pt-[10vh]" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div role="dialog" aria-modal="true" aria-label="Search and commands" className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center gap-2 border-b border-gray-100 px-4">
              <Search className="h-5 w-5 shrink-0 text-gray-400" />
              <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onInputKey}
                placeholder='Search tickets, projects, files… or try  status:"In progress" assignee:me'
                className="w-full py-3.5 text-sm outline-none" aria-label="Search" role="combobox" aria-expanded="true" aria-controls="palette-list"
                aria-activedescendant={rows[active] ? `palette-row-${active}` : undefined} />
              {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-primary-600" aria-label="Searching" />}
            </div>
            <ul id="palette-list" ref={listRef} role="listbox" className="max-h-[60vh] overflow-y-auto py-1">
              {q.trim() && !loading && res && !res.groups.length && !res.jump && (
                <li className="px-4 py-3 text-sm text-gray-500">No matches you can see.</li>
              )}
              {rows.map((r, i) => {
                const header = r.group !== lastGroup ? r.group : null;
                lastGroup = r.group;
                const Icon = r.icon;
                return (
                  <li key={r.id} role="presentation">
                    {header && <div className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{header}</div>}
                    <button type="button" id={`palette-row-${i}`} data-row={i} role="option" aria-selected={i === active}
                      onMouseEnter={() => setActive(i)} onClick={r.run}
                      className={cn('flex w-full items-start gap-3 px-4 py-2 text-left', i === active ? 'bg-primary-50' : 'hover:bg-gray-50')}>
                      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-gray-900">{r.label}</span>
                        {r.sub && <span className="block truncate text-xs text-gray-500">{r.sub}</span>}
                        {r.snippet && <span className="block truncate text-xs text-gray-400">{r.snippet}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="flex items-center justify-between border-t border-gray-100 px-4 py-2 text-[11px] text-gray-400">
              <span>↑↓ to move · Enter to open · Esc to close</span>
              <button type="button" className="inline-flex items-center gap-1 hover:text-gray-600" onClick={() => { close(); setHelp(true); }}><Keyboard className="h-3.5 w-3.5" />Shortcuts</button>
            </div>
          </div>
        </div>
      )}
      {help && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-3" onMouseDown={(e) => { if (e.target === e.currentTarget) setHelp(false); }}
          onKeyDown={(e) => { if (e.key === 'Escape') setHelp(false); }}>
          <div role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
            <h2 className="mb-3 text-base font-semibold text-gray-900">Keyboard shortcuts</h2>
            <dl className="space-y-2 text-sm">
              {SHORTCUT_HELP.map((s) => (
                <div key={s.keys} className="flex items-center justify-between gap-3">
                  <dt className="text-gray-600">{s.what}</dt>
                  <dd><kbd className="rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 font-mono text-xs text-gray-700">{s.keys}</kbd></dd>
                </div>
              ))}
            </dl>
            <button type="button" autoFocus onClick={() => setHelp(false)} className="mt-4 w-full rounded-lg bg-gray-100 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200">Close</button>
          </div>
        </div>
      )}
    </>
  );
}
