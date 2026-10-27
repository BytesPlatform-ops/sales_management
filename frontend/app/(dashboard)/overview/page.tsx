'use client';

import Link from 'next/link';
import { CalendarClock, FolderKanban, GitPullRequestArrow, Rocket, Users, ListTodo } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Empty, ErrorNote, PageHeader, Pill, Spinner } from '@/components/training/ui';
import { ProjectsPage, ProjectsProvider, SectionCard, StatusPill } from '@/components/projects/ui';
import { usePapi, fmtDay, relTime, fmtPkt, Status } from '@/components/projects/lib';
import { HealthPill } from '@/components/projects/ActivityTab';
import { TicketCard, ticketHref } from '@/components/tickets/lib';
import { BlockedBadge, KeyChip, TicketPriority, TicketStatusPill, TypeIcon } from '@/components/tickets/bits';

interface ProjectRow {
  id: number; ticket_no: string; title: string; client_name: string; client_company: string | null; status: Status;
  health: 'green' | 'yellow' | 'red'; last_activity_at: string | null; deadline: string | null; tracking_source: string;
  staging_url: string | null; ready_to_deliver_at: string | null; open_tickets: number; overdue_tickets: number;
  latest: { summary: string; occurred_at: string; url: string | null } | null;
}
interface MeetingRow { id: number; project_id: number; ticket_no: string; client_name: string; title: string; kind: string; starts_at: string; duration_min: number; location: string | null }
type Task = TicketCard & { project_ticket_no: string; client_name: string };

type Overview =
  | { role: 'developer'; tasks: Task[]; projects: ProjectRow[]; meetings: MeetingRow[] }
  | { role: 'agent'; projects: ProjectRow[]; tickets: Task[]; meetings: MeetingRow[] }
  | { role: 'hr'; projects: ProjectRow[]; change_requests: { id: number; key: string; title: string; project_id: number; ticket_no: string; client_name: string; created_at: string; created_by_name: string | null }[];
      ready_to_deliver: ProjectRow[]; workload: { id: number; name: string; open_tickets: number; overdue: number; estimate_hours: number; weekly_capacity_hours: number | null; out_of_office: boolean }[] };

const today = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);

function OverviewPage() {
  const { data, error } = usePapi<Overview>('/api/overview', { refreshInterval: 30_000 });
  if (error) return <ProjectsPage><ErrorNote error={error} /></ProjectsPage>;
  if (!data) return <ProjectsPage><Spinner label="Loading overview…" /></ProjectsPage>;
  return (
    <ProjectsPage>
      <PageHeader title="Projects overview"
        subtitle={data.role === 'developer' ? 'Your tasks, projects and today’s meetings' : data.role === 'agent' ? 'Your clients’ projects, the tickets you opened, upcoming meetings' : 'Every project by health, approvals waiting and team workload'} />
      {data.role === 'developer' && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-4">
            <SectionCard title={<span className="inline-flex items-center gap-1.5"><ListTodo className="h-4 w-4" />My tasks</span>}
              action={<Link href="/my-tasks" className="text-xs font-medium text-primary-600 hover:underline">All</Link>}>
              <TaskList tasks={data.tasks} empty="Nothing assigned to you right now." />
            </SectionCard>
            <SectionCard title={<span className="inline-flex items-center gap-1.5"><FolderKanban className="h-4 w-4" />My projects</span>}>
              <ProjectList rows={data.projects} />
            </SectionCard>
          </div>
          <Meetings rows={data.meetings} title="Today’s meetings" />
        </div>
      )}
      {data.role === 'agent' && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-4">
            <SectionCard title={<span className="inline-flex items-center gap-1.5"><FolderKanban className="h-4 w-4" />My clients’ projects</span>}>
              <ProjectList rows={data.projects} />
            </SectionCard>
            <SectionCard title={<span className="inline-flex items-center gap-1.5"><ListTodo className="h-4 w-4" />Tickets I opened</span>}>
              <TaskList tasks={data.tickets} empty="No open tickets from you." />
            </SectionCard>
          </div>
          <Meetings rows={data.meetings} title="Upcoming meetings (7 days)" />
        </div>
      )}
      {data.role === 'hr' && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            {(['red', 'yellow', 'green'] as const).map((h) => (
              <div key={h} className="rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
                <HealthPill health={h} />
                <p className="mt-1 text-2xl font-bold text-gray-900">{data.projects.filter((p) => p.health === h).length}</p>
                <p className="text-xs text-gray-500">open projects</p>
              </div>
            ))}
          </div>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
            <SectionCard title={<span className="inline-flex items-center gap-1.5"><FolderKanban className="h-4 w-4" />All projects by health</span>}>
              <ProjectList rows={data.projects} showClient />
            </SectionCard>
            <div className="space-y-4">
              <SectionCard title={<span className="inline-flex items-center gap-1.5"><Rocket className="h-4 w-4" />Ready to deliver</span>}>
                {data.ready_to_deliver.length ? (
                  <ul className="space-y-2 text-sm">
                    {data.ready_to_deliver.map((p) => (
                      <li key={p.id}><Link href={`/projects/${p.id}?tab=activity`} className="font-medium text-gray-900 hover:underline">{p.ticket_no} · {p.title}</Link>
                        <span className="block text-xs text-gray-500">Deployed {p.ready_to_deliver_at ? relTime(p.ready_to_deliver_at) : ''}</span></li>
                    ))}
                  </ul>
                ) : <p className="text-sm text-gray-500">Nothing waiting.</p>}
              </SectionCard>
              <SectionCard title={<span className="inline-flex items-center gap-1.5"><GitPullRequestArrow className="h-4 w-4" />Change requests waiting</span>}>
                {data.change_requests.length ? (
                  <ul className="space-y-2 text-sm">
                    {data.change_requests.map((c) => (
                      <li key={c.id}><Link href={ticketHref(c.project_id, c.key)} className="font-medium text-gray-900 hover:underline">{c.key} · {c.title}</Link>
                        <span className="block text-xs text-gray-500">{c.client_name} · from {c.created_by_name || 'someone'} · {relTime(c.created_at)}</span></li>
                    ))}
                  </ul>
                ) : <p className="text-sm text-gray-500">No change requests waiting.</p>}
              </SectionCard>
              <SectionCard title={<span className="inline-flex items-center gap-1.5"><Users className="h-4 w-4" />Developer workload</span>}>
                {data.workload.length ? (
                  <ul className="space-y-2 text-sm">
                    {data.workload.map((w) => {
                      const max = Math.max(...data.workload.map((x) => x.open_tickets), 1);
                      return (
                        <li key={w.id}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate">{w.name}{w.out_of_office && <Pill tone="amber" className="ml-1">Out</Pill>}</span>
                            <span className="text-xs text-gray-500">{w.open_tickets} open{w.overdue ? <span className="text-red-600"> · {w.overdue} overdue</span> : ''}{w.estimate_hours ? ` · ${w.estimate_hours}h est.` : ''}</span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100"><div className="h-full rounded-full bg-primary-500" style={{ width: `${(w.open_tickets / max) * 100}%` }} /></div>
                        </li>
                      );
                    })}
                  </ul>
                ) : <p className="text-sm text-gray-500">No developers yet.</p>}
              </SectionCard>
            </div>
          </div>
        </div>
      )}
    </ProjectsPage>
  );
}

function ProjectList({ rows, showClient = true }: { rows: ProjectRow[]; showClient?: boolean }) {
  if (!rows.length) return <Empty icon={<FolderKanban className="h-6 w-6" />} title="No open projects" />;
  return (
    <ul className="divide-y divide-gray-100">
      {rows.map((p) => (
        <li key={p.id} className="py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/projects/${p.id}`} className="font-medium text-gray-900 hover:underline">{p.ticket_no} · {p.title}</Link>
            <StatusPill status={p.status} /><HealthPill health={p.health} />
            {p.overdue_tickets > 0 && <Pill tone="red">{p.overdue_tickets} overdue</Pill>}
          </div>
          <p className="mt-0.5 text-xs text-gray-500">
            {showClient && <>{p.client_company || p.client_name} · </>}
            {p.open_tickets} open ticket{p.open_tickets === 1 ? '' : 's'}
            {p.deadline && <> · due {fmtDay(p.deadline)}</>}
            {' · '}{p.last_activity_at ? `active ${relTime(p.last_activity_at)}` : 'no activity yet'}
            {p.tracking_source === 'manual' && ' · manual tracking'}
          </p>
          {p.latest && <p className="mt-0.5 text-sm text-gray-700">Latest: {p.latest.summary}</p>}
          {p.staging_url && <a href={p.staging_url} target="_blank" rel="noreferrer" className="text-xs text-primary-700 hover:underline">Staging preview</a>}
        </li>
      ))}
    </ul>
  );
}

function TaskList({ tasks, empty }: { tasks: Task[]; empty: string }) {
  if (!tasks.length) return <p className="text-sm text-gray-500">{empty}</p>;
  return (
    <ul className="divide-y divide-gray-100">
      {tasks.map((t) => {
        const overdue = t.due_date && t.due_date < today();
        return (
          <li key={t.id} className="flex flex-wrap items-center gap-2 py-2">
            <TypeIcon type={t.type} /><KeyChip value={t.key} />
            <Link href={ticketHref(t.project_id, t.key)} className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900 hover:underline">{t.title}</Link>
            {t.blocked && <BlockedBadge />}<TicketPriority priority={t.priority} compact /><TicketStatusPill status={t.status} />
            <span className={cn('text-xs', overdue ? 'font-semibold text-red-600' : 'text-gray-500')}>{t.due_date ? fmtDay(t.due_date) : ''}</span>
            <span className="w-full text-xs text-gray-400 sm:w-auto">{t.project_ticket_no} · {t.client_name}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Meetings({ rows, title }: { rows: MeetingRow[]; title: string }) {
  return (
    <SectionCard title={<span className="inline-flex items-center gap-1.5"><CalendarClock className="h-4 w-4" />{title}</span>}>
      {rows.length ? (
        <ul className="space-y-2 text-sm">
          {rows.map((m) => (
            <li key={m.id}>
              <Link href={`/projects/${m.project_id}`} className="font-medium text-gray-900 hover:underline">{m.title}</Link>
              <span className="block text-xs text-gray-500">{fmtPkt(m.starts_at, { date: true })} · {m.duration_min} min · {m.ticket_no} {m.client_name}</span>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-gray-500">No meetings.</p>}
    </SectionCard>
  );
}

export default function Page() {
  return <ProjectsProvider><OverviewPage /></ProjectsProvider>;
}
