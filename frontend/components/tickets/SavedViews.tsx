'use client';

import { useEffect, useRef, useState } from 'react';
import { Bookmark, ChevronDown, Pin, PinOff, Trash2, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Btn, inputCls } from '@/components/training/ui';
import { Modal, Field, useConfirm, useToast } from '@/components/projects/ui';
import { papi, usePapi } from '@/components/projects/lib';

export interface SavedView {
  id: number; owner_id: number; owner_name: string | null; scope: 'personal' | 'shared'; project_id: number | null;
  name: string; view_type: string; config: any; pinned: boolean; href: string; mine: boolean;
}

/** Tell the sidebar (and other lists) to reload pinned views. */
export const savedViewsChanged = () => window.dispatchEvent(new Event('saved-views-changed'));

/**
 * "Views ▾" menu + "Save view". `current()` returns what to save for the screen
 * as it is now; `onApply` receives a view to load.
 */
export function SavedViews({ projectId, viewType, current, onApply, activeId, canEditAll }: {
  projectId: number | null; viewType: string; current: () => { view_type: string; config: unknown };
  onApply: (v: SavedView) => void; activeId?: number | null; canEditAll: boolean;
}) {
  const key = projectId ? `/api/saved-views?project_id=${projectId}` : '/api/saved-views?view_type=my_work';
  const { data, mutate } = usePapi<SavedView[]>(key);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState<{ name: string; shared: boolean; pinned: boolean } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const confirm = useConfirm();
  const views = (data || []).filter((v) => projectId || v.view_type === 'my_work');
  const active = views.find((v) => v.id === activeId);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  async function save() {
    if (!saving?.name.trim()) return;
    try {
      const cur = current();
      await papi('/api/saved-views', { method: 'POST', body: {
        name: saving.name.trim(), scope: saving.shared ? 'shared' : 'personal', pinned: saving.pinned,
        project_id: projectId, view_type: cur.view_type, config: cur.config,
      } });
      setSaving(null); mutate(); savedViewsChanged(); toast('View saved');
    } catch (e) { toast((e as Error).message, 'error'); }
  }

  async function update(v: SavedView, body: Record<string, unknown>) {
    try { await papi(`/api/saved-views/${v.id}`, { method: 'PATCH', body }); mutate(); savedViewsChanged(); }
    catch (e) { toast((e as Error).message, 'error'); }
  }

  return (
    <div ref={box} className="relative flex items-center gap-1">
      <Btn size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>
        <Bookmark className="h-4 w-4" />{active ? active.name : 'Views'}<ChevronDown className="h-3.5 w-3.5" />
      </Btn>
      <Btn size="sm" variant="ghost" onClick={() => setSaving({ name: '', shared: false, pinned: false })}>Save view</Btn>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-72 rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg" role="menu">
          {!views.length && <p className="px-2 py-3 text-center text-xs text-gray-500">No saved views yet. Set filters, then “Save view”.</p>}
          {views.map((v) => {
            const editable = v.mine || canEditAll;
            return (
              <div key={v.id} className={cn('group flex items-center gap-1 rounded-lg px-2 py-1.5 hover:bg-gray-50', v.id === activeId && 'bg-primary-50')}>
                <button type="button" role="menuitem" className="min-w-0 flex-1 text-left" onClick={() => { setOpen(false); onApply(v); }}>
                  <span className="block truncate text-sm font-medium text-gray-900">{v.name}</span>
                  <span className="flex items-center gap-1 text-[11px] text-gray-500">
                    {v.view_type.replace('_', ' ')}{v.scope === 'shared' && <><Users className="h-3 w-3" />shared{!v.mine && v.owner_name ? ` by ${v.owner_name}` : ''}</>}
                  </span>
                </button>
                {editable && (
                  <>
                    <button type="button" title={v.pinned ? 'Unpin from sidebar' : 'Pin to sidebar'} aria-label={v.pinned ? `Unpin ${v.name}` : `Pin ${v.name}`}
                      onClick={() => update(v, { pinned: !v.pinned })} className="rounded p-1 text-gray-400 hover:bg-white hover:text-gray-700">
                      {v.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                    </button>
                    <button type="button" title="Delete" aria-label={`Delete ${v.name}`} className="rounded p-1 text-gray-400 hover:bg-white hover:text-red-600"
                      onClick={async () => {
                        if (!(await confirm({ title: `Delete “${v.name}”?`, confirmLabel: 'Delete', danger: true }))) return;
                        try { await papi(`/api/saved-views/${v.id}`, { method: 'DELETE' }); mutate(); savedViewsChanged(); } catch (e) { toast((e as Error).message, 'error'); }
                      }}><Trash2 className="h-3.5 w-3.5" /></button>
                  </>
                )}
              </div>
            );
          })}
          {active && (active.mine || canEditAll) && (
            <button type="button" className="mt-1 w-full rounded-lg px-2 py-1.5 text-left text-xs font-medium text-primary-600 hover:bg-primary-50"
              onClick={() => { const cur = current(); update(active, { config: cur.config }); setOpen(false); toast(`Updated “${active.name}”`); }}>
              Update “{active.name}” with the current filters
            </button>
          )}
        </div>
      )}
      <Modal open={!!saving} onClose={() => setSaving(null)} title="Save view" size="sm"
        footer={<><Btn variant="secondary" onClick={() => setSaving(null)}>Cancel</Btn><Btn disabled={!saving?.name.trim()} onClick={save}>Save</Btn></>}>
        {saving && (
          <div className="space-y-3">
            <Field label="Name" htmlFor="sv-name">
              <input id="sv-name" className={inputCls} value={saving.name} maxLength={100} autoFocus placeholder="e.g. My open bugs"
                onChange={(e) => setSaving({ ...saving, name: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') save(); }} />
            </Field>
            <label className="flex items-start gap-2 text-sm text-gray-700">
              <input type="checkbox" className="mt-0.5" checked={saving.shared} onChange={(e) => setSaving({ ...saving, shared: e.target.checked })} />
              <span>Share with the team<span className="block text-xs text-gray-500">{projectId ? 'Everyone who can see this project can use it.' : 'Developers and HR can use it.'}</span></span>
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={saving.pinned} onChange={(e) => setSaving({ ...saving, pinned: e.target.checked })} />Pin to sidebar
            </label>
            <p className="text-xs text-gray-500">Saves the {viewType} view with its filters, grouping, sorting and columns.</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
