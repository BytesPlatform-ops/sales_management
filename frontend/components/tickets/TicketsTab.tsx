'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, Search, LayoutGrid, List as ListIcon, Inbox, Layers, ListOrdered, CalendarDays } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Btn, Pill, Empty, ErrorNote, Spinner, inputCls } from '@/components/training/ui';
import { Modal, Field, selectCls, useToast } from '@/components/projects/ui';
import { papi, usePapi, ProjectDetail, fmtDay, relTime } from '@/components/projects/lib';
import { Swimlane } from '@/lib/tickets/board';
import {
  TicketCard, Epic, LabelRef, TicketStatus, TicketType, Priority, TICKET_TYPES, PRIORITIES, TYPE_LABELS, TICKET_PRIORITY_LABELS, ticketHref,
} from './lib';
import { TypeIcon, TicketPriority, SlaTimer, KeyChip } from './bits';
import { MarkdownEditor } from './MarkdownEditor';
import { usePerms } from './perms';
import { BoardView } from './BoardView';
import { ListView, SortKey, ColumnId, DEFAULT_COLUMNS, loadColumns } from './ListView';
import { BacklogView } from './BacklogView';
import { TicketCalendar } from './TicketCalendar';
import { SavedViews, SavedView } from './SavedViews';

type View = 'board' | 'list' | 'backlog' | 'calendar' | 'triage' | 'epics';
const SAVABLE: View[] = ['board', 'list', 'backlog', 'calendar'];

interface Template { id: number; name: string; type: TicketType; title_prefix: string; description: string; checklist: string[] }

interface Filters { q: string; assignee: string; type: string; priority: string; epic: string; created_by: string; blocked: string; no_estimate: string }
const NO_FILTERS: Filters = { q: '', assignee: '', type: '', priority: '', epic: '', created_by: '', blocked: '', no_estimate: '' };

export function TicketsTab({ d, meId }: { d: ProjectDetail; meId: number | string | undefined }) {
  const pid = d.project.id;
  const perms = usePerms(d, meId);
  const toast = useToast();
  const [view, setView] = useState<View>('board');
  const [f, setF] = useState<Filters>(NO_FILTERS);
  const [qDebounced, setQDebounced] = useState('');
  const [swimlane, setSwimlane] = useState<Swimlane>('none');
  const [byEpic, setByEpic] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'key', dir: 1 });
  const [columns, setColumns] = useState<ColumnId[]>(DEFAULT_COLUMNS);
  const [activeView, setActiveView] = useState<number | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const setFilter = (k: keyof Filters, v: string) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => { setColumns(loadColumns()); }, []);
  useEffect(() => { const t = setTimeout(() => setQDebounced(f.q.trim()), 300); return () => clearTimeout(t); }, [f.q]);

  const search = useSearchParams();
  // ?new=1 (from the command palette) opens the new-ticket form.
  useEffect(() => { if (search.get('new') === '1' && perms.create) setNewOpen(true); }, [search, perms.create]);

  const applyView = useCallback((v: SavedView) => {
    const c = v.config || {};
    setF({ ...NO_FILTERS, ...(c.filters || {}) });
    if (SAVABLE.includes(v.view_type as View)) setView(v.view_type as View);
    if (c.swimlane) setSwimlane(c.swimlane);
    setByEpic(c.group_by === 'epic');
    if (c.sort) setSort(c.sort);
    if (Array.isArray(c.columns) && c.columns.length) setColumns(c.columns);
    setActiveView(v.id);
  }, []);

  // ?view=<id> (pinned views in the sidebar) loads a saved view.
  const viewParam = search.get('view');
  useEffect(() => {
    if (!viewParam) return;
    papi<SavedView>(`/api/saved-views/${Number(viewParam)}`).then(applyView).catch((e) => toast((e as Error).message, 'error'));
  }, [viewParam, applyView, toast]);

  const params = new URLSearchParams();
  params.set('view', view === 'triage' ? 'triage' : view === 'backlog' ? 'backlog' : 'work');
  if (view === 'board') params.set('top', '1');
  if (qDebounced) params.set('q', qDebounced);
  for (const k of ['assignee', 'type', 'priority', 'epic', 'created_by', 'blocked', 'no_estimate'] as const) if (f[k]) params.set(k, f[k]);
  const filterQs = params.toString();
  const listKey = view === 'epics' || view === 'calendar' ? null : `/api/projects/${pid}/tickets?${filterQs}`;
  const { data: tickets, error, isLoading, mutate } = usePapi<TicketCard[]>(listKey, { refreshInterval: 30_000 });
  const { data: triage, mutate: mutateTriage } = usePapi<TicketCard[]>(`/api/projects/${pid}/tickets?view=triage`, { refreshInterval: 30_000 });
  const { data: epics, mutate: mutateEpics } = usePapi<Epic[]>(`/api/projects/${pid}/epics`, { refreshInterval: 60_000 });
  const { data: labels } = usePapi<LabelRef[]>(view === 'list' ? `/api/projects/${pid}/labels` : null);
  const refresh = useCallback(() => { mutate(); mutateTriage(); mutateEpics(); }, [mutate, mutateTriage, mutateEpics]);

  const triageCount = triage?.length ?? 0;
  const VIEWS: { id: View; label: string; icon: typeof LayoutGrid; badge?: number }[] = [
    { id: 'board', label: 'Board', icon: LayoutGrid },
    { id: 'list', label: 'List', icon: ListIcon },
    { id: 'backlog', label: 'Backlog', icon: ListOrdered },
    { id: 'calendar', label: 'Calendar', icon: CalendarDays },
    { id: 'triage', label: 'Triage', icon: Inbox, badge: triageCount },
    { id: 'epics', label: 'Epics', icon: Layers },
  ];
  const activeFilters = Object.entries(f).filter(([, v]) => v).length;

  return (
    <section className="rounded-2xl border border-gray-200 bg-white shadow-sm min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 sm:px-5">
        <div role="tablist" aria-label="Ticket views" className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-gray-100 p-1">
          {VIEWS.map((v) => (
            <button key={v.id} role="tab" aria-selected={view === v.id} onClick={() => setView(v.id)}
              className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                view === v.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900')}>
              <v.icon className="h-4 w-4" />{v.label}
              {!!v.badge && <span className="rounded-full bg-orange-500 px-1.5 text-[11px] font-semibold text-white">{v.badge}</span>}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          {SAVABLE.includes(view) && (
            <SavedViews projectId={pid} viewType={view} activeId={activeView} canEditAll={perms.hr} onApply={applyView}
              current={() => ({ view_type: view, config: { filters: f, swimlane, group_by: byEpic ? 'epic' : undefined, sort, columns } })} />
          )}
          {perms.create && <span data-shortcut="new-ticket"><Btn size="sm" onClick={() => setNewOpen(true)}><Plus className="h-4 w-4" />New ticket</Btn></span>}
        </div>
      </div>

      {view !== 'epics' && (
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-2.5 sm:px-5">
          <label className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input className={cn(inputCls, 'py-1.5 pl-8')} placeholder="Search or PRJ-0001-T5" value={f.q} onChange={(e) => setFilter('q', e.target.value)} aria-label="Search tickets" />
          </label>
          <select className={cn(selectCls, 'w-auto py-1.5')} value={f.assignee} onChange={(e) => setFilter('assignee', e.target.value)} aria-label="Assignee">
            <option value="">Anyone</option>
            {perms.role !== 'agent' && <option value="me">Assigned to me</option>}
            {perms.devs.map((m) => <option key={m.id} value={String(m.id)}>{m.name}</option>)}
          </select>
          <select className={cn(selectCls, 'w-auto py-1.5')} value={f.type} onChange={(e) => setFilter('type', e.target.value)} aria-label="Type">
            <option value="">All types</option>
            {TICKET_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
          </select>
          <select className={cn(selectCls, 'w-auto py-1.5')} value={f.priority} onChange={(e) => setFilter('priority', e.target.value)} aria-label="Priority">
            <option value="">Any priority</option>
            {PRIORITIES.map((p) => <option key={p} value={p}>{TICKET_PRIORITY_LABELS[p]}</option>)}
          </select>
          <select className={cn(selectCls, 'w-auto py-1.5')} value={f.epic} onChange={(e) => setFilter('epic', e.target.value)} aria-label="Epic">
            <option value="">All epics</option>
            <option value="none">No epic</option>
            {(epics || []).map((e) => <option key={e.id} value={String(e.id)}>{e.title}</option>)}
          </select>
          <select className={cn(selectCls, 'w-auto py-1.5')} value={[f.created_by && 'mine', f.blocked && 'blocked', f.no_estimate && 'no_estimate'].find(Boolean) || ''}
            onChange={(e) => setF((x) => ({ ...x, created_by: e.target.value === 'mine' ? 'me' : '', blocked: e.target.value === 'blocked' ? '1' : '', no_estimate: e.target.value === 'no_estimate' ? '1' : '' }))}
            aria-label="More filters">
            <option value="">More…</option>
            <option value="mine">Opened by me</option>
            <option value="blocked">Blocked</option>
            <option value="no_estimate">No estimate</option>
          </select>
          {view === 'board' && (
            <select className={cn(selectCls, 'w-auto py-1.5')} value={swimlane} onChange={(e) => setSwimlane(e.target.value as Swimlane)} aria-label="Swimlanes">
              <option value="none">No swimlanes</option>
              <option value="assignee">Lanes: assignee</option>
              <option value="epic">Lanes: epic</option>
              <option value="priority">Lanes: priority</option>
            </select>
          )}
          {view === 'backlog' && (
            <label className="inline-flex items-center gap-1.5 text-sm text-gray-700">
              <input type="checkbox" checked={byEpic} onChange={(e) => setByEpic(e.target.checked)} />Group by epic
            </label>
          )}
          {activeFilters > 0 && (
            <button type="button" className="text-xs font-medium text-gray-500 hover:text-gray-800" onClick={() => { setF(NO_FILTERS); setActiveView(null); }}>Clear</button>
          )}
        </div>
      )}

      <div className="p-3 sm:p-4">
        {error && <ErrorNote error={error} />}
        {view === 'epics' ? (
          <Epics pid={pid} epics={epics} canEdit={perms.work} onChange={refresh} onPick={(id) => { setFilter('epic', String(id)); setView('board'); }} />
        ) : view === 'calendar' ? (
          <TicketCalendar d={d} filterQs={filterQs} perms={perms} onChange={refresh} />
        ) : isLoading && !tickets ? <Spinner label="Loading tickets…" /> : view === 'board' ? (
          <BoardView pid={pid} tickets={tickets || []} perms={perms} swimlane={swimlane} onChange={refresh} />
        ) : view === 'list' ? (
          <ListView pid={pid} tickets={tickets || []} perms={perms} epics={epics || []} labels={labels || []}
            sort={sort} onSort={setSort} columns={columns} onColumns={setColumns} onChange={refresh} />
        ) : view === 'backlog' ? (
          <BacklogView tickets={tickets || []} perms={perms} byEpic={byEpic} onChange={refresh} />
        ) : (
          <TriageList tickets={tickets || []} canTriage={perms.triage} onChange={refresh} />
        )}
      </div>

      <NewTicketModal open={newOpen} onClose={() => setNewOpen(false)} d={d} perms={perms} epics={epics || []}
        onCreated={(key) => { setNewOpen(false); refresh(); return key; }} />
    </section>
  );
}

// ------------------------------------------------------------------ triage

function TriageList({ tickets, canTriage, onChange }: { tickets: TicketCard[]; canTriage: boolean; onChange: () => void }) {
  const toast = useToast();
  const [declining, setDeclining] = useState<TicketCard | null>(null);
  const [reason, setReason] = useState('');
  const sorted = [...tickets].sort((a, b) => String(a.triage_due_at).localeCompare(String(b.triage_due_at)));

  async function act(t: TicketCard, body: Record<string, unknown>) {
    try { await papi(`/api/tickets/${t.id}/triage`, { method: 'POST', body }); onChange(); toast(`${t.key} updated`); }
    catch (e) { toast((e as Error).message, 'error'); }
  }

  if (!tickets.length) return <Empty icon={<Inbox className="h-6 w-6" />} title="Triage is clear" body="New requests from agents, briefs and meetings show up here first." />;
  return (
    <>
      <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
        {sorted.map((t) => (
          <li key={t.id} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <TypeIcon type={t.type} /><KeyChip value={t.key} /><TicketPriority priority={t.priority} />
                {t.triage_state === 'need_info' && <Pill tone="blue">Waiting on agent</Pill>}
                {t.triage_state === 'snoozed' && t.snoozed_until && <Pill tone="gray">Snoozed until {fmtDay(t.snoozed_until.slice(0, 10), { noYear: true })}</Pill>}
                <SlaTimer due={t.triage_due_at} />
              </div>
              <Link href={ticketHref(t.project_id, t.key)} data-nav-item className="mt-0.5 block truncate text-sm font-medium text-gray-900 hover:underline">{t.title}</Link>
              <p className="text-xs text-gray-500">From {t.created_by_name || 'someone'} · {relTime(t.created_at)}</p>
            </div>
            {canTriage && (
              <div className="flex shrink-0 gap-1.5">
                <Btn size="sm" variant="success" onClick={() => act(t, { action: 'accept' })}>Accept</Btn>
                <Link href={ticketHref(t.project_id, t.key)} className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">Review…</Link>
                <Btn size="sm" variant="ghost" onClick={() => { setDeclining(t); setReason(''); }}>Decline</Btn>
              </div>
            )}
          </li>
        ))}
      </ul>
      <Modal open={!!declining} onClose={() => setDeclining(null)} title={`Decline ${declining?.key}`} size="sm"
        footer={<>
          <Btn variant="secondary" onClick={() => setDeclining(null)}>Cancel</Btn>
          <Btn variant="danger" disabled={!reason.trim()} onClick={async () => { const t = declining!; setDeclining(null); await act(t, { action: 'decline', reason }); }}>Decline</Btn>
        </>}>
        <Field label="Reason (the agent will see this)" htmlFor="decline-reason">
          <textarea id="decline-reason" rows={3} className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </Modal>
    </>
  );
}

// ------------------------------------------------------------------ epics

function Epics({ pid, epics, canEdit, onChange, onPick }: { pid: number; epics?: Epic[]; canEdit: boolean; onChange: () => void; onPick: (id: number) => void }) {
  const toast = useToast();
  const [form, setForm] = useState<{ title: string; color: string; target_date: string } | null>(null);
  if (!epics) return <Spinner label="Loading epics…" />;
  return (
    <div className="space-y-3">
      {canEdit && <div className="flex justify-end"><Btn size="sm" variant="secondary" onClick={() => setForm({ title: '', color: '#6366f1', target_date: '' })}><Plus className="h-4 w-4" />New epic</Btn></div>}
      {!epics.length ? <Empty icon={<Layers className="h-6 w-6" />} title="No epics yet" body="Group tickets into phases like Design, Build, Launch." /> : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {epics.map((e) => {
            const pct = e.total ? Math.round((e.done / e.total) * 100) : 0;
            return (
              <li key={e.id}>
                <button type="button" onClick={() => onPick(e.id)} className="w-full rounded-xl border border-gray-200 p-3 text-left hover:border-primary-300 hover:shadow-sm">
                  <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ background: e.color }} /><span className="font-semibold text-gray-900">{e.title}</span></div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${e.title} progress`}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: e.color }} />
                  </div>
                  <p className="mt-1.5 text-xs text-gray-500">{e.done}/{e.total} done · {pct}%{e.target_date ? ` · target ${fmtDay(e.target_date, { noYear: true })}` : ''}</p>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <Modal open={!!form} onClose={() => setForm(null)} title="New epic" size="sm"
        footer={<>
          <Btn variant="secondary" onClick={() => setForm(null)}>Cancel</Btn>
          <Btn disabled={!form?.title.trim()} onClick={async () => {
            try { await papi(`/api/projects/${pid}/epics`, { method: 'POST', body: { ...form, target_date: form!.target_date || null } }); setForm(null); onChange(); }
            catch (e) { toast((e as Error).message, 'error'); }
          }}>Create</Btn>
        </>}>
        {form && (
          <div className="space-y-3">
            <Field label="Title" htmlFor="epic-title"><input id="epic-title" className={inputCls} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Colour" htmlFor="epic-color"><input id="epic-color" type="color" className="h-10 w-full rounded-lg border border-gray-300" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} /></Field>
              <Field label="Target date" htmlFor="epic-date"><input id="epic-date" type="date" className={inputCls} value={form.target_date} onChange={(e) => setForm({ ...form, target_date: e.target.value })} /></Field>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ------------------------------------------------------------------ new ticket

function NewTicketModal({ open, onClose, d, perms, epics, onCreated }: {
  open: boolean; onClose: () => void; d: ProjectDetail; perms: ReturnType<typeof usePerms>; epics: Epic[]; onCreated: (key: string) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const { data: templates } = usePapi<Template[]>(open ? `/api/ticket-templates?project_id=${d.project.id}` : null);
  const blank = { template_id: '', title: '', type: 'task' as TicketType, priority: 'normal' as Priority, description: '', epic_id: '', due_date: '', assignee_ids: [] as string[] };
  const [f, setF] = useState(blank);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const agent = perms.role === 'agent';

  useEffect(() => { if (open) { setF(blank); setErr(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function pickTemplate(id: string) {
    const t = templates?.find((x) => String(x.id) === id);
    setF((cur) => ({ ...cur, template_id: id, type: t?.type || cur.type, description: t ? t.description : cur.description,
      title: t && !cur.title ? t.title_prefix : cur.title }));
  }

  async function save(openAfter: boolean) {
    setErr(null); setSaving(true);
    try {
      const body: Record<string, unknown> = {
        title: f.title, type: f.type, priority: f.priority, description: f.description,
        due_date: f.due_date || null, epic_id: f.epic_id ? Number(f.epic_id) : null,
      };
      if (f.template_id) body.template_id = Number(f.template_id);
      if (!agent) body.assignee_ids = f.assignee_ids.map(Number);
      const t = await papi<{ key: string; status: TicketStatus }>(`/api/projects/${d.project.id}/tickets`, { method: 'POST', body });
      toast(t.status === 'triage' ? `${t.key} sent to Triage` : `${t.key} created`);
      onCreated(t.key);
      if (openAfter) router.push(ticketHref(d.project.id, t.key));
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="New ticket" size="lg"
      footer={<>
        <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
        <Btn variant="secondary" disabled={saving || !f.title.trim()} onClick={() => save(true)}>Create & open</Btn>
        <Btn disabled={saving || !f.title.trim()} onClick={() => save(false)}>{saving ? 'Creating…' : 'Create'}</Btn>
      </>}>
      <div className="space-y-3">
        {agent && <p className="rounded-lg bg-orange-50 px-3 py-2 text-sm text-orange-800">Your ticket goes to <strong>Triage</strong> first — the lead developer accepts it and assigns someone.</p>}
        {!!templates?.length && (
          <Field label="Template" htmlFor="nt-template">
            <select id="nt-template" className={selectCls} value={f.template_id} onChange={(e) => pickTemplate(e.target.value)}>
              <option value="">Blank ticket</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Title" htmlFor="nt-title">
          <input id="nt-title" className={inputCls} value={f.title} maxLength={300} onChange={(e) => setF({ ...f, title: e.target.value })} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Type" htmlFor="nt-type">
            <select id="nt-type" className={selectCls} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as TicketType })}>
              {TICKET_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
            </select>
          </Field>
          <Field label="Priority" htmlFor="nt-priority">
            <select id="nt-priority" className={selectCls} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as Priority })}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{TICKET_PRIORITY_LABELS[p]}</option>)}
            </select>
          </Field>
          <Field label="Due" htmlFor="nt-due"><input id="nt-due" type="date" className={inputCls} value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
          <Field label="Epic" htmlFor="nt-epic">
            <select id="nt-epic" className={selectCls} value={f.epic_id} onChange={(e) => setF({ ...f, epic_id: e.target.value })}>
              <option value="">None</option>
              {epics.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
            </select>
          </Field>
        </div>
        {f.type === 'change_request' && <p className="text-xs text-amber-700">Change requests need HR approval before work starts.</p>}
        <Field label="Description" htmlFor="nt-desc">
          <MarkdownEditor id="nt-desc" value={f.description} onChange={(v) => setF({ ...f, description: v })} rows={7}
            placeholder="What does the client need? Links, steps, examples…" />
        </Field>
        {!agent && perms.devs.length > 0 && (
          <fieldset>
            <legend className="mb-1 text-sm font-medium text-gray-700">Assign to</legend>
            <div className="flex flex-wrap gap-2">
              {perms.devs.map((m) => {
                const on = f.assignee_ids.includes(String(m.id));
                return (
                  <button key={m.id} type="button" aria-pressed={on}
                    onClick={() => setF({ ...f, assignee_ids: on ? f.assignee_ids.filter((x) => x !== String(m.id)) : [...f.assignee_ids, String(m.id)] })}
                    className={cn('rounded-full border px-3 py-1 text-sm', on ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50')}>
                    {m.name}
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}
        <p className="text-xs text-gray-500">You can attach files after creating the ticket.</p>
        {err && <p className="text-sm text-red-600">{err}</p>}
      </div>
    </Modal>
  );
}
