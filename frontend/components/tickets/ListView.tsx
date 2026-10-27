'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpDown, Columns3, List as ListIcon, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Btn, Empty, inputCls } from '@/components/training/ui';
import { selectCls, useConfirm, useToast } from '@/components/projects/ui';
import { papi, relTime, today, fmtDay } from '@/components/projects/lib';
import {
  TicketCard, Epic, LabelRef, TicketStatus, Priority, WORK_STATUSES, PRIORITIES, TICKET_STATUS_LABELS, TICKET_PRIORITY_LABELS, ticketHref,
} from './lib';
import { TypeIcon, TicketStatusPill, TicketPriority, BlockedBadge, KeyChip, Assignees } from './bits';
import { putAssignees, useTicketPatch } from './actions';
import { canEditCard, TicketPerms } from './perms';

export type SortKey = 'key' | 'title' | 'status' | 'priority' | 'due_date' | 'estimate_hours' | 'updated_at';
export const LIST_COLUMNS = [
  { id: 'status', label: 'Status' }, { id: 'priority', label: 'Priority' }, { id: 'assignees', label: 'Assignees' },
  { id: 'due', label: 'Due' }, { id: 'estimate', label: 'Est. h' }, { id: 'epic', label: 'Epic' }, { id: 'labels', label: 'Labels' },
  { id: 'created_by', label: 'Opened by' }, { id: 'updated', label: 'Updated' },
] as const;
export type ColumnId = (typeof LIST_COLUMNS)[number]['id'];
export const DEFAULT_COLUMNS: ColumnId[] = ['status', 'priority', 'assignees', 'due', 'estimate', 'epic', 'updated'];
const COLS_KEY = 'tickets.list.columns';

const PRI_ORDER: Record<Priority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const STATUS_ORDER = Object.fromEntries((['triage', ...WORK_STATUSES, 'closed', 'declined'] as TicketStatus[]).map((s, i) => [s, i]));

export function loadColumns(): ColumnId[] {
  try {
    const v = JSON.parse(localStorage.getItem(COLS_KEY) || 'null');
    if (Array.isArray(v)) return v.filter((c) => LIST_COLUMNS.some((x) => x.id === c));
  } catch { /* private mode etc. */ }
  return DEFAULT_COLUMNS;
}

export function ListView({ pid, tickets, perms, epics, labels, sort, onSort, columns, onColumns, onChange }: {
  pid: number; tickets: TicketCard[]; perms: TicketPerms; epics: Epic[]; labels: LabelRef[];
  sort: { key: SortKey; dir: 1 | -1 }; onSort: (s: { key: SortKey; dir: 1 | -1 }) => void;
  columns: ColumnId[]; onColumns: (c: ColumnId[]) => void; onChange: () => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [colsOpen, setColsOpen] = useState(false);
  const [failed, setFailed] = useState<BulkResult['results']>([]);
  const patch = useTicketPatch(onChange);
  const toast = useToast();

  useEffect(() => { // drop selections that left the list
    setSelected((s) => new Set(Array.from(s).filter((id) => tickets.some((t) => t.id === id))));
  }, [tickets]);

  const rows = useMemo(() => {
    const val = (t: TicketCard): string | number => {
      switch (sort.key) {
        case 'key': return t.number;
        case 'priority': return PRI_ORDER[t.priority];
        case 'status': return STATUS_ORDER[t.status];
        case 'estimate_hours': return Number(t.estimate_hours ?? -1);
        case 'due_date': return t.due_date || '9999';
        default: return String((t as any)[sort.key] ?? '').toLowerCase();
      }
    };
    return [...tickets].sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * sort.dir);
  }, [tickets, sort]);

  if (!tickets.length) return <Empty icon={<ListIcon className="h-6 w-6" />} title="No tickets match" />;
  const show = (c: ColumnId) => columns.includes(c);
  const totalEst = tickets.reduce((s, t) => s + Number(t.estimate_hours || 0), 0);
  const selEst = tickets.filter((t) => selected.has(t.id)).reduce((s, t) => s + Number(t.estimate_hours || 0), 0);
  const allOn = rows.length > 0 && rows.every((t) => selected.has(t.id));

  const Th = ({ k, children, className }: { k?: SortKey; children: React.ReactNode; className?: string }) => (
    <th scope="col" className={cn('px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 whitespace-nowrap', className)}>
      {k ? (
        <button type="button" className="inline-flex items-center gap-1 hover:text-gray-800" onClick={() => onSort({ key: k, dir: sort.key === k ? (-sort.dir as 1 | -1) : 1 })}>
          {children}<ArrowUpDown className={cn('h-3 w-3', sort.key === k ? 'text-gray-800' : 'text-gray-300')} />
        </button>
      ) : children}
    </th>
  );

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        {selected.size > 0 ? (
          <BulkBar pid={pid} ids={Array.from(selected)} perms={perms} epics={epics} labels={labels} selEst={selEst}
            onDone={(bad) => { setFailed(bad); setSelected(new Set(bad.map((b) => b.id))); onChange(); }} onClear={() => setSelected(new Set())} />
        ) : <span className="text-xs text-gray-500">Select tickets to change several at once.</span>}
        <div className="relative">
          <Btn size="sm" variant="ghost" onClick={() => setColsOpen((o) => !o)}><Columns3 className="h-4 w-4" />Columns</Btn>
          {colsOpen && (
            <div className="absolute right-0 z-20 mt-1 w-48 rounded-xl border border-gray-200 bg-white p-2 shadow-lg" role="dialog" aria-label="Columns">
              {LIST_COLUMNS.map((c) => (
                <label key={c.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-gray-50">
                  <input type="checkbox" checked={show(c.id)} onChange={() => {
                    const next = show(c.id) ? columns.filter((x) => x !== c.id) : [...columns, c.id];
                    onColumns(next);
                    try { localStorage.setItem(COLS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
                  }} />{c.label}
                </label>
              ))}
              <button type="button" className="mt-1 w-full text-right text-xs text-primary-600 hover:underline" onClick={() => setColsOpen(false)}>Done</button>
            </div>
          )}
        </div>
      </div>
      {failed.length > 0 && (
        <div className="mb-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">
          <div className="mb-1 flex items-center justify-between font-semibold">
            Not changed (still selected)
            <button type="button" onClick={() => setFailed([])} aria-label="Dismiss" className="rounded p-0.5 hover:bg-amber-100"><X className="h-3.5 w-3.5" /></button>
          </div>
          <ul className="space-y-0.5">{failed.map((f) => <li key={f.id}><span className="font-mono font-semibold">{f.key || `#${f.id}`}</span> — {f.error}</li>)}</ul>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="border-b border-gray-200">
            <tr>
              <th scope="col" className="w-8 px-2 py-2">
                <input type="checkbox" aria-label="Select all" checked={allOn}
                  onChange={() => setSelected(allOn ? new Set() : new Set(rows.map((t) => t.id)))} />
              </th>
              <Th k="key">Key</Th><Th k="title">Title</Th>
              {show('status') && <Th k="status">Status</Th>}
              {show('priority') && <Th k="priority">Priority</Th>}
              {show('assignees') && <Th>Assignees</Th>}
              {show('due') && <Th k="due_date">Due</Th>}
              {show('estimate') && <Th k="estimate_hours" className="text-right">Est. h</Th>}
              {show('epic') && <Th>Epic</Th>}
              {show('labels') && <Th>Labels</Th>}
              {show('created_by') && <Th>Opened by</Th>}
              {show('updated') && <Th k="updated_at">Updated</Th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((t) => {
              const edit = canEditCard(perms, t);
              return (
                <tr key={t.id} className={cn('hover:bg-gray-50', selected.has(t.id) && 'bg-primary-50/40')}>
                  <td className="px-2 py-1.5">
                    <input type="checkbox" aria-label={`Select ${t.key}`} checked={selected.has(t.id)}
                      onChange={() => setSelected((s) => { const n = new Set(s); n.has(t.id) ? n.delete(t.id) : n.add(t.id); return n; })} />
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5"><span className="inline-flex items-center gap-1"><TypeIcon type={t.type} /><KeyChip value={t.key} /></span></td>
                  <td className="min-w-[14rem] max-w-[28rem] px-2 py-1.5">
                    <Link href={ticketHref(t.project_id, t.key)} data-nav-item className="font-medium text-gray-900 hover:text-primary-700 hover:underline">
                      {t.parent_id ? <span className="text-gray-400">↳ </span> : null}{t.title}
                    </Link>
                    {t.blocked && <span className="ml-2 align-middle"><BlockedBadge /></span>}
                  </td>
                  {show('status') && (
                    <td className="px-2 py-1.5">
                      {perms.work && t.status !== 'triage' && t.status !== 'declined' ? (
                        <select aria-label={`Status of ${t.key}`} className={cn(selectCls, 'w-auto py-1 text-xs')} value={t.status}
                          onChange={(e) => patch(t.id, { status: e.target.value })}>
                          {[...WORK_STATUSES, 'closed' as TicketStatus].map((s) => <option key={s} value={s}>{TICKET_STATUS_LABELS[s]}</option>)}
                        </select>
                      ) : <TicketStatusPill status={t.status} />}
                    </td>
                  )}
                  {show('priority') && (
                    <td className="px-2 py-1.5">
                      {edit ? (
                        <select aria-label={`Priority of ${t.key}`} className={cn(selectCls, 'w-auto py-1 text-xs')} value={t.priority}
                          onChange={(e) => patch(t.id, { priority: e.target.value })}>
                          {PRIORITIES.map((p) => <option key={p} value={p}>{TICKET_PRIORITY_LABELS[p]}</option>)}
                        </select>
                      ) : <TicketPriority priority={t.priority} />}
                    </td>
                  )}
                  {show('assignees') && (
                    <td className="px-2 py-1.5">
                      {perms.work ? (
                        <PickMany label={`Assignees of ${t.key}`} options={perms.devs.map((m) => ({ id: Number(m.id), name: m.name }))}
                          value={t.assignees.map((a) => Number(a.id))} display={<Assignees people={t.assignees} />}
                          onSave={async (ids) => { try { await putAssignees(t.id, ids); onChange(); } catch (e) { toast((e as Error).message, 'error'); } }} />
                      ) : <Assignees people={t.assignees} />}
                    </td>
                  )}
                  {show('due') && (
                    <td className="px-2 py-1.5">
                      {edit ? (
                        <input type="date" aria-label={`Due date of ${t.key}`} defaultValue={t.due_date || ''} key={t.due_date || 'none'}
                          className={cn(inputCls, 'w-[9.5rem] py-1 text-xs', t.due_date && t.due_date < today() && !['done', 'closed'].includes(t.status) && 'text-red-600 font-semibold')}
                          onBlur={(e) => { if ((e.target.value || null) !== t.due_date) patch(t.id, { due_date: e.target.value || null }); }} />
                      ) : <span className="whitespace-nowrap text-gray-600">{t.due_date ? fmtDay(t.due_date, { noYear: true }) : '—'}</span>}
                    </td>
                  )}
                  {show('estimate') && (
                    <td className="px-2 py-1.5 text-right">
                      {perms.work ? (
                        <input type="number" min={0} step={0.5} aria-label={`Estimate of ${t.key}`} defaultValue={t.estimate_hours ? Number(t.estimate_hours) : ''}
                          key={t.estimate_hours || 'none'} className={cn(inputCls, 'w-20 py-1 text-right text-xs tabular-nums')}
                          onBlur={(e) => { const v = e.target.value === '' ? null : Number(e.target.value); if (v !== (t.estimate_hours == null ? null : Number(t.estimate_hours))) patch(t.id, { estimate_hours: v }); }} />
                      ) : <span className="tabular-nums text-gray-600">{t.estimate_hours ? Number(t.estimate_hours) : '—'}</span>}
                    </td>
                  )}
                  {show('epic') && (
                    <td className="px-2 py-1.5">
                      {edit ? (
                        <select aria-label={`Epic of ${t.key}`} className={cn(selectCls, 'w-auto max-w-[10rem] py-1 text-xs')} value={t.epic_id ?? ''}
                          onChange={(e) => patch(t.id, { epic_id: e.target.value ? Number(e.target.value) : null })}>
                          <option value="">—</option>
                          {epics.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
                        </select>
                      ) : <span className="text-xs text-gray-600">{t.epic_title || '—'}</span>}
                    </td>
                  )}
                  {show('labels') && (
                    <td className="px-2 py-1.5">
                      {edit ? (
                        <PickMany label={`Labels of ${t.key}`} options={labels.map((l) => ({ id: l.id, name: l.name }))} value={t.labels.map((l) => l.id)}
                          display={<LabelChips labels={t.labels} />} onSave={(ids) => patch(t.id, { label_ids: ids })} />
                      ) : <LabelChips labels={t.labels} />}
                    </td>
                  )}
                  {show('created_by') && <td className="whitespace-nowrap px-2 py-1.5 text-xs text-gray-600">{t.created_by_name || '—'}</td>}
                  {show('updated') && <td className="whitespace-nowrap px-2 py-1.5 text-gray-500">{relTime(t.updated_at)}</td>}
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t border-gray-200 text-xs text-gray-500">
            <tr>
              <td />
              <td className="px-2 py-2" colSpan={2 + (show('status') ? 1 : 0) + (show('priority') ? 1 : 0) + (show('assignees') ? 1 : 0) + (show('due') ? 1 : 0)}>
                {tickets.length} ticket{tickets.length === 1 ? '' : 's'}{selected.size ? ` · ${selected.size} selected` : ''}
              </td>
              {show('estimate') && <td className="px-2 py-2 text-right font-semibold tabular-nums">{totalEst || '—'}</td>}
              <td colSpan={(show('epic') ? 1 : 0) + (show('labels') ? 1 : 0) + (show('created_by') ? 1 : 0) + (show('updated') ? 1 : 0)} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function LabelChips({ labels }: { labels: LabelRef[] }) {
  if (!labels.length) return <span className="text-xs text-gray-400">—</span>;
  return <span className="flex flex-wrap gap-1">{labels.map((l) => <span key={l.id} className="rounded px-1.5 py-0.5 text-[11px] font-medium text-white" style={{ background: l.color }}>{l.name}</span>)}</span>;
}

/** Click to open a checkbox list; saves when closed if anything changed. */
function PickMany({ label, options, value, display, onSave }: {
  label: string; options: { id: number; name: string }[]; value: number[]; display: React.ReactNode; onSave: (ids: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<number[]>(value);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) setDraft(value); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const close = () => {
      setOpen(false);
      if ([...draft].sort().join() !== [...value].sort().join()) onSave(draft);
    };
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open, draft, value, onSave]);
  return (
    <div ref={box} className="relative">
      <button type="button" aria-label={label} aria-expanded={open} onClick={() => setOpen((o) => !o)} className="rounded px-1 py-0.5 hover:bg-gray-100">{display}</button>
      {open && (
        <div className="absolute left-0 z-20 mt-1 max-h-60 w-52 overflow-y-auto rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg">
          {options.length === 0 && <p className="px-1.5 py-1 text-xs text-gray-500">Nothing to pick.</p>}
          {options.map((o) => (
            <label key={o.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-gray-50">
              <input type="checkbox" checked={draft.includes(o.id)} onChange={() => setDraft((d) => (d.includes(o.id) ? d.filter((x) => x !== o.id) : [...d, o.id]))} />
              <span className="truncate">{o.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

interface BulkResult { results: { id: number; key?: string; ok: boolean; error?: string }[]; ok_count: number; failed_count: number }

function BulkBar({ pid, ids, perms, epics, labels, onDone, onClear, selEst }: {
  pid: number; ids: number[]; perms: TicketPerms; epics: Epic[]; labels: LabelRef[];
  onDone: (failed: BulkResult['results']) => void; onClear: () => void; selEst: number;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [assignee, setAssignee] = useState('');
  const [assignMode, setAssignMode] = useState<'add' | 'replace' | 'remove'>('add');

  async function run(changes: Record<string, unknown>, what: string) {
    setBusy(true);
    try {
      const r = await papi<BulkResult>(`/api/projects/${pid}/tickets/bulk`, { method: 'PATCH', body: { ids, changes } });
      const bad = r.results.filter((x) => !x.ok);
      toast(bad.length ? `${what}: ${r.ok_count} updated, ${bad.length} skipped` : `${what}: ${r.ok_count} updated`, bad.length ? 'info' : 'success');
      onDone(bad);
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }

  const sel = (label: string, onPick: (v: string) => void, options: { value: string; label: string }[]) => (
    <select aria-label={label} disabled={busy} className={cn(selectCls, 'w-auto py-1 text-xs')} value="" onChange={(e) => { if (e.target.value) onPick(e.target.value); }}>
      <option value="">{label}…</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary-200 bg-primary-50/60 px-3 py-2">
        <span className="text-sm font-semibold text-primary-800">{ids.length} selected{selEst ? ` · ${selEst} h` : ''}</span>
        {perms.work && sel('Status', (v) => run({ status: v }, 'Status'), [...WORK_STATUSES, 'closed' as TicketStatus].map((s) => ({ value: s, label: TICKET_STATUS_LABELS[s] })))}
        {sel('Priority', (v) => run({ priority: v }, 'Priority'), PRIORITIES.map((p) => ({ value: p, label: TICKET_PRIORITY_LABELS[p] })))}
        {sel('Epic', (v) => run({ epic_id: v === 'none' ? null : Number(v) }, 'Epic'), [{ value: 'none', label: 'No epic' }, ...epics.map((e) => ({ value: String(e.id), label: e.title }))])}
        {labels.length > 0 && sel('Add label', (v) => run({ label_add: [Number(v)] }, 'Labels'), labels.map((l) => ({ value: String(l.id), label: l.name })))}
        {labels.length > 0 && sel('Remove label', (v) => run({ label_remove: [Number(v)] }, 'Labels'), labels.map((l) => ({ value: String(l.id), label: l.name })))}
        <label className="inline-flex items-center gap-1 text-xs text-gray-600">
          Due
          <input type="date" disabled={busy} aria-label="Set due date" className={cn(inputCls, 'w-[9.5rem] py-1 text-xs')}
            onChange={(e) => { if (e.target.value) run({ due_date: e.target.value }, 'Due date'); }} />
        </label>
        {perms.work && perms.devs.length > 0 && (
          <span className="inline-flex items-center gap-1">
            <select aria-label="Assign mode" className={cn(selectCls, 'w-auto py-1 text-xs')} value={assignMode} onChange={(e) => setAssignMode(e.target.value as any)}>
              <option value="add">Add assignee</option><option value="replace">Assign only</option><option value="remove">Unassign</option>
            </select>
            <select aria-label="Developer" className={cn(selectCls, 'w-auto py-1 text-xs')} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">Developer…</option>
              {perms.devs.map((m) => <option key={m.id} value={String(m.id)}>{m.name}</option>)}
            </select>
            <Btn size="sm" variant="secondary" disabled={busy || !assignee} onClick={() => run({ assignees: { mode: assignMode, user_ids: [Number(assignee)] } }, 'Assignees')}>Apply</Btn>
          </span>
        )}
        {perms.hr && (
          <Btn size="sm" variant="danger" disabled={busy} onClick={async () => {
            if (await confirm({ title: `Delete ${ids.length} ticket${ids.length > 1 ? 's' : ''}?`, body: 'They disappear from the board and lists.', confirmLabel: 'Delete', danger: true })) run({ delete: true }, 'Delete');
          }}>Delete</Btn>
        )}
        <button type="button" onClick={onClear} className="ml-auto rounded p-1 text-gray-500 hover:bg-white" aria-label="Clear selection"><X className="h-4 w-4" /></button>
      </div>
    </div>
  );
}
