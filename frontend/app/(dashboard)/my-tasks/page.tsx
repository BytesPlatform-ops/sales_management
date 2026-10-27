'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ListTodo } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import { PageHeader, Spinner, ErrorNote, Empty } from '@/components/training/ui';
import { ProjectsPage, ProjectsProvider, SectionCard, selectCls, useToast } from '@/components/projects/ui';
import { MyReminders } from '@/components/reminders/Reminders';
import { papi, usePapi, today, addDays, fmtDay } from '@/components/projects/lib';
import { TicketCard, ticketHref, TICKET_TYPES, TYPE_LABELS, PRIORITIES, TICKET_PRIORITY_LABELS } from '@/components/tickets/lib';
import { SavedViews, SavedView } from '@/components/tickets/SavedViews';
import { filterTasks, NO_WORK_FILTERS as NO_FILTERS, WorkFilters } from '@/components/tickets/my-work';
import { KeyChip, TypeIcon, TicketStatusPill, TicketPriority, BlockedBadge } from '@/components/tickets/bits';

type Group = 'overdue' | 'today' | 'week' | 'later' | 'none' | 'review';
const GROUPS: { key: Group; title: string }[] = [
  { key: 'overdue', title: 'Overdue' },
  { key: 'today', title: 'Today' },
  { key: 'week', title: 'This week' },
  { key: 'later', title: 'Later' },
  { key: 'none', title: 'No due date' },
  { key: 'review', title: 'Waiting review' },
];

function groupOf(t: TicketCard, t0: string, week: string): Group {
  if (t.status === 'in_review' || t.status === 'in_qa') return 'review';
  if (!t.due_date) return 'none';
  if (t.due_date < t0) return 'overdue';
  if (t.due_date === t0) return 'today';
  if (t.due_date <= week) return 'week';
  return 'later';
}

function MyTasks() {
  const { user } = useAuth();
  const toast = useToast();
  const { data: all, error, isLoading } = usePapi<TicketCard[]>('/api/my/tasks', { refreshInterval: 30_000 });
  const [f, setF] = useState<WorkFilters>(NO_FILTERS);
  const [activeView, setActiveView] = useState<number | null>(null);
  const data = useMemo(() => (all ? filterTasks(all, f) : all), [all, f]);
  const projects = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of all || []) m.set(String(t.project_id), `${t.project_ticket_no || ''}${t.client_name ? ` · ${t.client_name}` : ''}`);
    return Array.from(m, ([id, label]) => ({ id, label }));
  }, [all]);

  const applyView = useCallback((v: SavedView) => { setF({ ...NO_FILTERS, ...(v.config?.filters || {}) }); setActiveView(v.id); }, []);
  const search = useSearchParams();
  const viewParam = search.get('view');
  useEffect(() => {
    if (!viewParam) return;
    papi<SavedView>(`/api/saved-views/${Number(viewParam)}`).then(applyView).catch((e) => toast((e as Error).message, 'error'));
  }, [viewParam, applyView, toast]);

  const grouped = useMemo(() => {
    const t0 = today();
    const week = addDays(t0, 7);
    const out: Record<Group, TicketCard[]> = { overdue: [], today: [], week: [], later: [], none: [], review: [] };
    for (const t of data || []) out[groupOf(t, t0, week)].push(t);
    return out;
  }, [data]);

  const subtitle = user?.role === 'agent'
    ? 'Open tickets you created, across all your clients.'
    : 'Everything assigned to you, across all projects.';

  return (
    <ProjectsPage>
      <PageHeader title="My Tasks" subtitle={subtitle}
        actions={<SavedViews projectId={null} viewType="my work" activeId={activeView} canEditAll={user?.role === 'hr'} onApply={applyView}
          current={() => ({ view_type: 'my_work', config: { filters: f } })} />} />
      <MyReminders className="mb-4" />
      {all && all.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <select className={cn(selectCls, 'w-auto py-1.5')} value={f.project_id} onChange={(e) => setF({ ...f, project_id: e.target.value })} aria-label="Project">
            <option value="">All projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <select className={cn(selectCls, 'w-auto py-1.5')} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} aria-label="Type">
            <option value="">All types</option>
            {TICKET_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
          </select>
          <select className={cn(selectCls, 'w-auto py-1.5')} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} aria-label="Priority">
            <option value="">Any priority</option>
            {PRIORITIES.map((p) => <option key={p} value={p}>{TICKET_PRIORITY_LABELS[p]}</option>)}
          </select>
          <label className="inline-flex items-center gap-1.5 text-sm text-gray-700"><input type="checkbox" checked={!!f.blocked} onChange={(e) => setF({ ...f, blocked: e.target.checked ? '1' : '' })} />Blocked</label>
          <label className="inline-flex items-center gap-1.5 text-sm text-gray-700"><input type="checkbox" checked={!!f.no_estimate} onChange={(e) => setF({ ...f, no_estimate: e.target.checked ? '1' : '' })} />No estimate</label>
          {Object.values(f).some(Boolean) && <button type="button" className="text-xs font-medium text-gray-500 hover:text-gray-800" onClick={() => { setF(NO_FILTERS); setActiveView(null); }}>Clear</button>}
        </div>
      )}
      {error && <ErrorNote error={error} />}
      {isLoading && !data && <Spinner label="Loading your tasks…" />}
      {data && !data.length && all && all.length > 0 && <p className="rounded-2xl border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-500">No tasks match these filters.</p>}
      {data && !data.length && !all?.length && (
        <div className="rounded-2xl border border-gray-200 bg-white">
          <Empty icon={<ListTodo className="h-6 w-6" />} title="Nothing on your plate"
            body={user?.role === 'agent' ? 'Tickets you open for your clients show up here until they’re done.' : 'Tickets assigned to you show up here.'} />
        </div>
      )}
      {data && data.length > 0 && (
        <div className="space-y-4">
          {GROUPS.filter((g) => grouped[g.key].length).map((g) => (
            <SectionCard key={g.key} title={<span className={cn(g.key === 'overdue' && 'text-red-600')}>{g.title} · {grouped[g.key].length}</span>}>
              <ul className="-my-2 divide-y divide-gray-100">
                {grouped[g.key].map((t) => <TaskRow key={t.id} t={t} overdue={g.key === 'overdue'} />)}
              </ul>
            </SectionCard>
          ))}
        </div>
      )}
    </ProjectsPage>
  );
}

function TaskRow({ t, overdue }: { t: TicketCard; overdue: boolean }) {
  return (
    <li className="flex flex-col gap-1.5 py-2.5 sm:flex-row sm:items-center sm:gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <TypeIcon type={t.type} />
        <KeyChip value={t.key} className="shrink-0" />
        <Link href={ticketHref(t.project_id, t.key)} data-nav-item className="min-w-0 truncate text-sm font-medium text-gray-900 hover:text-primary-700 hover:underline">
          {t.title}
        </Link>
        {t.blocked && <BlockedBadge />}
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-6 sm:pl-0">
        <span className="max-w-[220px] truncate text-xs text-gray-500" title={t.project_title}>
          {t.project_ticket_no}{t.client_name ? ` · ${t.client_name}` : ''}
        </span>
        <TicketPriority priority={t.priority} compact />
        <TicketStatusPill status={t.status} />
        {t.due_date && <span className={cn('whitespace-nowrap text-xs', overdue ? 'font-semibold text-red-600' : 'text-gray-500')}>Due {fmtDay(t.due_date, { noYear: true })}</span>}
      </div>
    </li>
  );
}

export default function MyTasksPage() {
  return <ProjectsProvider><MyTasks /></ProjectsProvider>;
}
