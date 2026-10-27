'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { FolderX } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';
import { Spinner, ErrorNote, Empty } from '@/components/training/ui';
import { ProjectsPage, StatusPill, PriorityPill, TypePill, SectionCard } from '@/components/projects/ui';
import { usePapi, sameId, ProjectDetail, SERVICE_LABELS, fmtMoney, fmtDay } from '@/components/projects/lib';
import { Thread } from '@/components/projects/Thread';
import { Gantt, Milestones, DeadlineNote } from '@/components/projects/Timeline';
import { Meetings } from '@/components/projects/Meetings';
import { ClientCard, StatusControl, People, DatesEditor, DetailsEditor, Cycles } from '@/components/projects/Panels';
import { BriefTab } from '@/components/brief/BriefTab';
import { EnvVault } from '@/components/projects/EnvVault';
import { TriageRotationCard } from '@/components/collab/TriageRotationCard';
import { ReminderSettingsCard } from '@/components/reminders/Reminders';
import { TicketsTab } from '@/components/tickets/TicketsTab';
import { ProjectFiles } from '@/components/tickets/ProjectFiles';
import { ActivityTab, HealthPill } from '@/components/projects/ActivityTab';

type Tab = 'thread' | 'brief' | 'tickets' | 'activity' | 'files' | 'timeline' | 'details' | 'env' | 'meetings' | 'people';
const LEFT_TABS: Tab[] = ['thread', 'brief', 'tickets', 'activity', 'files', 'timeline', 'details', 'env'];
// Wide views take the whole page width (the side column is hidden).
const WIDE_TABS: Tab[] = ['tickets', 'files'];
const TAB_LABELS: Record<Tab, string> = { thread: 'Thread', brief: 'Brief', tickets: 'Tickets', activity: 'Activity', files: 'Files', timeline: 'Timeline', details: 'Details', env: 'Env', meetings: 'Meetings', people: 'People' };

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { data: d, error, isLoading, mutate } = usePapi<ProjectDetail>(id ? `/api/projects/${id}` : null, { refreshInterval: 60_000 });
  const search = useSearchParams();
  const [tab, setTab] = useState<Tab>('thread');
  // ?tab=tickets etc. (links back from a ticket page)
  useEffect(() => {
    const t = search.get('tab') as Tab | null;
    if (t && t in TAB_LABELS) setTab(t);
  }, [search]);
  const [threadKick, setThreadKick] = useState(0);

  // Anything that writes a system entry: refresh the project and pull the thread now.
  const changed = () => { mutate(); setThreadKick((k) => k + 1); };

  if (isLoading && !d) return <ProjectsPage><Spinner label="Loading project…" /></ProjectsPage>;
  if (error && !d) {
    const notFound = /not found/i.test((error as Error).message);
    return (
      <ProjectsPage>
        <Link href="/projects" className="inline-block mb-3 text-sm text-gray-500 hover:text-gray-700">← Projects</Link>
        {notFound ? (
          <div className="bg-white rounded-2xl border border-gray-200">
            <Empty icon={<FolderX className="h-6 w-6" />} title="Project not found" body="It may have been removed, or you’re not on this project." />
          </div>
        ) : <ErrorNote error={error} />}
      </ProjectsPage>
    );
  }
  if (!d) return null;
  const p = d.project;
  const leftView: Tab = LEFT_TABS.includes(tab) ? tab : 'thread';
  const rightMobile = tab === 'meetings' || tab === 'people';
  const wide = WIDE_TABS.includes(tab);
  const myMember = d.members.find((m) => sameId(m.id, user?.id));
  const canCreateTicket = d.permissions.role === 'hr'
    || (d.permissions.role === 'agent' && sameId(p.created_by, user?.id))
    || (d.permissions.role === 'developer' && (myMember?.member_role === 'developer' || myMember?.member_role === 'lead_developer'));
  const currentCycle = d.cycles.find((c) => c.status === 'open') || d.cycles[d.cycles.length - 1];
  // Env is only for HR and the project's developers; agents never see the tab.
  const hasEnv = !!d.permissions.env && Object.values(d.permissions.env).some(Boolean);

  return (
    <ProjectsPage>
      <Link href="/projects" className="inline-block mb-2 text-sm text-gray-500 hover:text-gray-700">← Projects</Link>

      {/* Header */}
      <div className="mb-4 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5 shadow-sm min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-gray-500">{p.ticket_no}</span>
            <StatusPill status={p.status} />
            <HealthPill health={p.health} />
            <PriorityPill priority={p.priority} />
            <TypePill type={p.project_type} recurrence={p.recurrence} cycleNo={p.project_type === 'recurring' ? currentCycle?.cycle_no : null} />
          </div>
          <h1 className="mt-2 text-xl sm:text-2xl font-bold text-gray-900 tracking-tight break-words">{p.title}</h1>
          <dl className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-sm">
            <div className="min-w-0"><dt className="text-xs text-gray-500">Service</dt><dd className="text-gray-900 truncate">{SERVICE_LABELS[p.service_type] || p.service_type}</dd></div>
            <div className="min-w-0"><dt className="text-xs text-gray-500">Deal value</dt><dd className="text-gray-900">{fmtMoney(p.deal_value)}</dd></div>
            <div className="min-w-0"><dt className="text-xs text-gray-500">Supervisor</dt><dd className="text-gray-900 truncate">{p.supervisor_name || '—'}</dd></div>
            <div className="min-w-0"><dt className="text-xs text-gray-500">Opened by</dt><dd className="text-gray-900 truncate" title={fmtDay(p.created_at)}>{p.created_by_name || '—'}</dd></div>
          </dl>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-3">
            <DeadlineNote d={d} />
            <StatusControl d={d} onChange={changed} />
          </div>
        </div>
        <ClientCard d={d} />
      </div>

      {/* Tabs: left-column views on desktop; every section on mobile */}
      <div role="tablist" aria-label="Project sections" className="mb-4 flex gap-1 overflow-x-auto rounded-xl bg-gray-100 p-1 lg:inline-flex">
        {(Object.keys(TAB_LABELS) as Tab[]).filter((t) => t !== 'env' || hasEnv).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={cn('whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
              !LEFT_TABS.includes(t) && 'lg:hidden',
              tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900',
              // On desktop a mobile-only tab may be selected: highlight the visible left view instead.
              rightMobile && t === 'thread' && 'lg:bg-white lg:text-gray-900 lg:shadow-sm')}>
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      <div className={cn('grid grid-cols-1 gap-4 items-start', !wide && 'lg:grid-cols-[minmax(0,1fr)_360px]')}>
        {/* Left: thread / timeline / details (kept mounted so polling continues) */}
        <div className={cn('min-w-0', rightMobile && 'hidden lg:block')}>
          <Thread projectId={p.id} meId={user?.id} role={d.permissions.role} canBrief={!!d.permissions.brief_add} canCreateTicket={canCreateTicket}
            active={leftView === 'thread'} onSystemMessage={() => mutate()} refreshKey={threadKick} className={cn(leftView !== 'thread' && 'hidden')} />

          {leftView === 'brief' && <BriefTab d={d} meId={user?.id} />}

          <div className={cn('space-y-4', leftView !== 'timeline' && 'hidden')}>
            <SectionCard title="Timeline / calendar path">
              <Gantt d={d} />
              <div className="mt-5"><Milestones d={d} onChange={changed} /></div>
            </SectionCard>
            {p.project_type === 'recurring' && <SectionCard title="Recurring cycles"><Cycles d={d} onChange={changed} /></SectionCard>}
          </div>

          <div className={cn('space-y-4', leftView !== 'details' && 'hidden')}>
            <SectionCard title="Dates"><DatesEditor d={d} onChange={changed} /></SectionCard>
            <SectionCard title="Project & client details"><DetailsEditor d={d} onChange={changed} meId={user?.id} /></SectionCard>
            <ReminderSettingsCard projectId={p.id} />
            {d.permissions.role !== 'agent' && <TriageRotationCard projectId={p.id} canEdit={d.permissions.role === 'hr' || d.members.some((m) => String(m.id) === String(user?.id) && m.member_role === 'lead_developer')} />}
          </div>

          {hasEnv && leftView === 'env' && <EnvVault d={d} />}

          {leftView === 'tickets' && <TicketsTab d={d} meId={user?.id} />}
          {leftView === 'activity' && <ActivityTab d={d} meId={user?.id} />}
          {leftView === 'files' && <ProjectFiles projectId={p.id} meId={user?.id} isHr={d.permissions.role === 'hr'} />}
        </div>

        {/* Right: summary, people, meetings */}
        <div className={cn('space-y-4 min-w-0', rightMobile ? '' : wide ? 'hidden' : 'hidden lg:block')}>
          <SectionCard title="Timeline" className="hidden lg:block"
            action={<button onClick={() => setTab('timeline')} className="text-xs font-medium text-primary-600 hover:underline">Open</button>}>
            <SummaryDates d={d} />
          </SectionCard>
          <People d={d} onChange={changed} className={cn(tab === 'meetings' && 'hidden lg:block')} />
          <Meetings d={d} onChange={changed} className={cn(tab === 'people' && 'hidden lg:block')} />
        </div>
      </div>
    </ProjectsPage>
  );
}

function SummaryDates({ d }: { d: ProjectDetail }) {
  const p = d.project;
  const done = d.milestones.filter((m) => m.status === 'done').length;
  const rows: [string, string | null, string][] = [
    ['Work start', p.start_date, 'bg-sky-500'],
    ['Internal deadline', p.deadline, 'bg-red-500'],
    ['Delivery to client', p.expected_delivery, 'bg-emerald-500'],
  ];
  return (
    <div className="space-y-3">
      <ul className="space-y-1.5 text-sm">
        {rows.map(([l, v, c]) => (
          <li key={l} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-gray-600"><span className={cn('h-2 w-2 rounded-full', c)} aria-hidden />{l}</span>
            <span className={cn('font-medium', v ? 'text-gray-900' : 'text-gray-400')}>{v ? fmtDay(v) : 'Not set'}</span>
          </li>
        ))}
        <li className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-gray-600"><span className="h-2 w-2 rounded-full bg-violet-500" aria-hidden />Milestones</span>
          <span className="font-medium text-gray-900">{d.milestones.length ? `${done}/${d.milestones.length} done` : 'None yet'}</span>
        </li>
      </ul>
      {d.milestones.length > 0 && (
        <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-valuenow={Math.round((done / d.milestones.length) * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Milestones done">
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(done / d.milestones.length) * 100}%` }} />
        </div>
      )}
    </div>
  );
}
