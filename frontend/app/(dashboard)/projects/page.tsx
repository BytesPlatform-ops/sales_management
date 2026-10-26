'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Plus, Search, FolderKanban, CalendarDays, MessageSquare, Video, AlertTriangle, Flag, Truck, RefreshCw } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';
import { PageHeader, Spinner, ErrorNote, Empty, Btn, inputCls } from '@/components/training/ui';
import { ProjectsPage, StatusPill, PriorityPill, TypePill, AvatarStack } from '@/components/projects/ui';
import { usePapi, ListProject, SERVICE_LABELS, fmtDay, fmtPkt, daysBetween, today } from '@/components/projects/lib';

type View = 'active' | 'recurring' | 'closed' | 'all';
interface ListResp { projects: ListProject[]; counts: { active: number; recurring: number; closed: number; overdue: number }; role: string }

const TABS: { key: View; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'recurring', label: 'Recurring' },
  { key: 'closed', label: 'Closed' },
  { key: 'all', label: 'All' },
];

function deadlineTone(p: ListProject) {
  if (!p.deadline) return 'text-gray-400';
  if (p.overdue) return 'text-red-600 font-semibold';
  if (['delivered', 'closed', 'cancelled'].includes(p.status)) return 'text-gray-600';
  const d = daysBetween(today(), p.deadline);
  return d <= 7 ? 'text-amber-600 font-semibold' : 'text-gray-700';
}

export default function ProjectsListPage() {
  const { user } = useAuth();
  const role = user?.role;
  const [view, setView] = useState<View>('active');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const { data, error, isLoading, mutate, isValidating } = usePapi<ListResp>(
    `/api/projects?view=${view}${debounced ? `&q=${encodeURIComponent(debounced)}` : ''}`,
    { refreshInterval: 30_000, keepPreviousData: true }
  );
  const counts = data?.counts;
  const countFor = (k: View) => (counts ? (k === 'all' ? counts.active + counts.closed : counts[k]) : undefined);
  const canCreate = role === 'agent' || role === 'hr';
  const projects = data?.projects || [];

  const subtitle = role === 'developer'
    ? 'Projects you’re assigned to. Open one to chat with the team and update progress.'
    : role === 'agent'
      ? 'Tickets you opened for clients you converted. Follow progress and talk to the team here.'
      : 'Every client project: who’s on it, what’s due and what the client was promised.';

  return (
    <ProjectsPage>
      <PageHeader
        title="Projects"
        subtitle={subtitle}
        actions={<>
          <Link href="/projects/calendar" className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
            <CalendarDays className="h-4 w-4" /> Calendar
          </Link>
          {canCreate && (
            <Link href="/projects/new" className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1">
              <Plus className="h-4 w-4" /> New ticket
            </Link>
          )}
        </>}
      />

      {counts && counts.overdue > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {counts.overdue} project{counts.overdue === 1 ? ' is' : 's are'} past the internal deadline.
        </div>
      )}

      <div className="mb-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <div role="tablist" aria-label="Project views" className="flex gap-1 overflow-x-auto rounded-xl bg-gray-100 p-1">
          {TABS.map((t) => (
            <button key={t.key} role="tab" aria-selected={view === t.key} onClick={() => setView(t.key)}
              className={cn('flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                view === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900')}>
              {t.label}
              {countFor(t.key) !== undefined && <span className={cn('rounded-full px-1.5 text-xs tabular-nums', view === t.key ? 'bg-gray-100 text-gray-700' : 'bg-gray-200 text-gray-600')}>{countFor(t.key)}</span>}
            </button>
          ))}
        </div>
        <div className="relative flex-1 sm:max-w-sm sm:ml-auto">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
          <label htmlFor="project-search" className="sr-only">Search projects</label>
          <input id="project-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ticket, title or client…" className={cn(inputCls, 'pl-9 bg-white')} />
        </div>
        <Btn variant="ghost" size="sm" onClick={() => mutate()} disabled={isValidating} className="hidden sm:inline-flex">
          <RefreshCw className={cn('h-4 w-4', isValidating && 'animate-spin')} /><span className="sr-only">Refresh</span>
        </Btn>
      </div>

      <ErrorNote error={error} />
      {isLoading && !data ? <Spinner label="Loading projects…" /> : projects.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200">
          {debounced ? (
            <Empty icon={<Search className="h-6 w-6" />} title="No matches" body={`Nothing matches “${debounced}” in this view.`} />
          ) : role === 'developer' ? (
            <Empty icon={<FolderKanban className="h-6 w-6" />} title={view === 'closed' ? 'No closed projects yet' : 'Nothing here yet'} body="Tickets assigned to you will appear here. Your supervisor assigns developers to projects." />
          ) : role === 'agent' ? (
            <Empty icon={<FolderKanban className="h-6 w-6" />} title={view === 'closed' ? 'No closed projects yet' : 'No tickets yet'}
              body="Converted a client? Open a ticket so the development team can start. You can pick the client from your Pipeline or Sales."
              action={view !== 'closed' && <Link href="/projects/new" className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"><Plus className="h-4 w-4" /> Open a ticket</Link>} />
          ) : (
            <Empty icon={<FolderKanban className="h-6 w-6" />} title={view === 'closed' ? 'No closed projects yet' : 'No projects in this view'}
              body="When agents convert clients, their tickets show up here for you to assign and schedule." />
          )}
        </div>
      ) : (
        <ul className="space-y-2.5">
          {projects.map((p) => <ProjectRow key={p.id} p={p} />)}
        </ul>
      )}
    </ProjectsPage>
  );
}

function ProjectRow({ p }: { p: ListProject }) {
  const [done, total] = String(p.milestones_done || '0/0').split('/').map(Number);
  return (
    <li>
      <Link href={`/projects/${p.id}`}
        className={cn('block rounded-2xl border bg-white p-4 shadow-sm transition hover:border-primary-300 hover:shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
          p.overdue ? 'border-red-200' : 'border-gray-200')}>
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-mono text-xs font-semibold text-gray-500">{p.ticket_no}</span>
              <StatusPill status={p.status} />
              <PriorityPill priority={p.priority} />
              {p.project_type === 'recurring' && <TypePill type={p.project_type} recurrence={p.recurrence} cycleNo={p.current_cycle?.cycle_no} />}
              {p.unread > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary-600 px-2 py-0.5 text-xs font-semibold text-white">
                  <MessageSquare className="h-3 w-3" aria-hidden />{p.unread} new
                </span>
              )}
            </div>
            <div className="mt-1 font-semibold text-gray-900 truncate">{p.title}</div>
            <div className="text-sm text-gray-500 truncate">
              {p.client_company || p.client_name}{p.client_company && <span className="text-gray-400"> · {p.client_name}</span>}
              <span className="text-gray-400"> · {SERVICE_LABELS[p.service_type] || p.service_type}</span>
            </div>
          </div>

          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-xs lg:w-[560px] lg:shrink-0">
            <div className="min-w-0">
              <dt className="flex items-center gap-1 text-gray-400"><Flag className="h-3 w-3" aria-hidden /> Deadline</dt>
              <dd className={cn('mt-0.5 text-sm', deadlineTone(p))}>{p.deadline ? fmtDay(p.deadline) : 'Not set'}{p.overdue && ' · overdue'}</dd>
            </div>
            <div className="min-w-0">
              <dt className="flex items-center gap-1 text-gray-400"><Truck className="h-3 w-3" aria-hidden /> Delivery to client</dt>
              <dd className="mt-0.5 text-sm text-gray-700">{p.expected_delivery ? fmtDay(p.expected_delivery) : 'Not set'}</dd>
            </div>
            <div className="min-w-0">
              <dt className="flex items-center gap-1 text-gray-400"><Video className="h-3 w-3" aria-hidden /> Next meeting</dt>
              <dd className="mt-0.5 text-sm text-gray-700 truncate" title={p.next_meeting?.title}>{p.next_meeting ? fmtPkt(p.next_meeting.starts_at) : '—'}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-gray-400">Team · milestones</dt>
              <dd className="mt-0.5 flex items-center gap-2">
                <AvatarStack people={p.members} />
                {total > 0 && <span className={cn('text-sm tabular-nums', done === total ? 'text-emerald-600' : 'text-gray-700')}>{done}/{total}</span>}
              </dd>
            </div>
          </dl>
        </div>
      </Link>
    </li>
  );
}
