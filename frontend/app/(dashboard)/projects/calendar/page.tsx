'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarDays, List } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader, Spinner, ErrorNote, Btn } from '@/components/training/ui';
import { ProjectsPage, selectCls } from '@/components/projects/ui';
import { usePapi, ListProject, ymd, parseDay, addDays, today, fmtDay, fmtPkt } from '@/components/projects/lib';

interface CalEvent {
  type: 'start' | 'deadline' | 'delivery' | 'milestone' | 'meeting' | 'cycle';
  project_id: number; ticket_no: string; project_title: string; status: string; title: string; date: string; at: string | null; extra: string | null;
}

const TYPE_STYLE: Record<CalEvent['type'], { chip: string; dot: string; label: string }> = {
  deadline: { chip: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-500', label: 'Deadline' },
  delivery: { chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500', label: 'Delivery to client' },
  start: { chip: 'bg-sky-50 text-sky-700 border-sky-200', dot: 'bg-sky-500', label: 'Work starts' },
  milestone: { chip: 'bg-violet-50 text-violet-700 border-violet-200', dot: 'bg-violet-500', label: 'Milestone' },
  meeting: { chip: 'bg-amber-50 text-amber-800 border-amber-200', dot: 'bg-amber-500', label: 'Meeting' },
  cycle: { chip: 'bg-rose-50 text-rose-700 border-rose-200', dot: 'bg-rose-500', label: 'Cycle deadline' },
};
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function evLabel(e: CalEvent) {
  if (e.type === 'meeting' && e.at) return `${fmtPkt(e.at, { date: false })} · ${e.title}`;
  if (e.type === 'milestone') return e.title;
  return e.title;
}
const struck = (e: CalEvent) => (e.type === 'milestone' && e.status === 'done') || (e.type === 'meeting' && e.status === 'done') || (e.type === 'cycle' && e.status !== 'open');

export default function ProjectsCalendarPage() {
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [projectId, setProjectId] = useState('');
  const t = today();

  // Grid: Monday before the 1st through the Sunday after the last day.
  const grid = useMemo(() => {
    const first = new Date(month);
    const offset = (first.getDay() + 6) % 7;
    const start = addDays(ymd(first), -offset);
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    const end = addDays(ymd(last), 6 - ((last.getDay() + 6) % 7));
    const days: string[] = [];
    for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
    return { start, end, days, firstYmd: ymd(first), lastYmd: ymd(last) };
  }, [month]);

  const pq = projectId ? `&project_id=${projectId}` : '';
  const { data: events, error, isLoading } = usePapi<CalEvent[]>(`/api/projects/calendar?from=${grid.start}&to=${grid.end}${pq}`, { keepPreviousData: true });
  const { data: upcoming, isLoading: upLoading } = usePapi<CalEvent[]>(`/api/projects/calendar?from=${t}&to=${addDays(t, 14)}${pq}`);
  const { data: list } = usePapi<{ projects: ListProject[] }>('/api/projects?view=all');

  const byDay = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    for (const e of events || []) {
      const k = e.date.slice(0, 10);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(e);
    }
    return m;
  }, [events]);

  const monthLabel = month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const shift = (n: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));
  const monthEvents = (events || []).filter((e) => e.date >= grid.firstYmd && e.date <= grid.lastYmd);

  return (
    <ProjectsPage>
      <PageHeader title="Project calendar" subtitle="Work starts, milestones, meetings, internal deadlines and delivery dates for your projects. Meeting times are in Pakistan time (PKT)."
        back={{ href: '/projects', label: 'Projects' }} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Btn variant="secondary" size="sm" onClick={() => shift(-1)}><ChevronLeft className="h-4 w-4" /><span className="sr-only">Previous month</span></Btn>
          <Btn variant="secondary" size="sm" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); }}>Today</Btn>
          <Btn variant="secondary" size="sm" onClick={() => shift(1)}><ChevronRight className="h-4 w-4" /><span className="sr-only">Next month</span></Btn>
        </div>
        <h2 className="text-lg font-semibold text-gray-900 min-w-[150px]" aria-live="polite">{monthLabel}</h2>
        <div className="w-full sm:w-72 sm:ml-auto">
          <label htmlFor="cal-project" className="sr-only">Filter by project</label>
          <select id="cal-project" className={selectCls} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">All projects</option>
            {(list?.projects || []).map((p) => <option key={p.id} value={p.id}>{p.ticket_no} · {p.title}</option>)}
          </select>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600" aria-label="Legend">
        {(Object.keys(TYPE_STYLE) as CalEvent['type'][]).map((k) => (
          <span key={k} className="flex items-center gap-1.5"><span className={cn('h-2 w-2 rounded-full', TYPE_STYLE[k].dot)} />{TYPE_STYLE[k].label}</span>
        ))}
      </div>

      <ErrorNote error={error} />
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-4 items-start">
        <div className="min-w-0">
          {isLoading && !events ? <Spinner label="Loading calendar…" /> : (
            <>
              {/* Month grid (tablet/desktop) */}
              <div className="hidden md:block rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                <div className="grid grid-cols-7 border-b border-gray-100 bg-gray-50 text-center text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {WEEKDAYS.map((w) => <div key={w} className="py-2">{w}</div>)}
                </div>
                <div className="grid grid-cols-7">
                  {grid.days.map((day) => {
                    const evs = byDay.get(day) || [];
                    const inMonth = day >= grid.firstYmd && day <= grid.lastYmd;
                    const d = parseDay(day);
                    return (
                      <div key={day} className={cn('min-h-[112px] border-b border-r border-gray-100 p-1.5 min-w-0', !inMonth && 'bg-gray-50/70', (d.getDay() === 0 || d.getDay() === 6) && inMonth && 'bg-gray-50/30')}>
                        <div className={cn('mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium',
                          day === t ? 'bg-primary-600 text-white' : inMonth ? 'text-gray-700' : 'text-gray-400')}>{d.getDate()}</div>
                        <ul className="space-y-0.5">
                          {evs.slice(0, 4).map((e, i) => (
                            <li key={i}>
                              <Link href={`/projects/${e.project_id}`} title={`${e.ticket_no} · ${e.project_title} — ${TYPE_STYLE[e.type].label}: ${e.title}${e.at ? ` (${fmtPkt(e.at)})` : ''}`}
                                className={cn('block truncate rounded border px-1 py-0.5 text-[11px] leading-tight hover:brightness-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500', TYPE_STYLE[e.type].chip, struck(e) && 'line-through opacity-70')}>
                                <span className="font-semibold">{e.ticket_no.replace('PRJ-', '#')}</span> {evLabel(e)}
                              </Link>
                            </li>
                          ))}
                          {evs.length > 4 && <li className="px-1 text-[11px] text-gray-500">+{evs.length - 4} more</li>}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Agenda (phones) */}
              <div className="md:hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-700"><List className="h-4 w-4" />{monthLabel}</div>
                {monthEvents.length === 0 ? <p className="px-4 py-8 text-center text-sm text-gray-500">Nothing scheduled this month.</p> : <Agenda events={monthEvents} />}
              </div>
            </>
          )}
        </div>

        <section className="rounded-2xl border border-gray-200 bg-white shadow-sm min-w-0">
          <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
            <CalendarDays className="h-4 w-4 text-gray-400" />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Upcoming (next 14 days)</h2>
          </div>
          {upLoading && !upcoming ? <Spinner /> : !upcoming?.length ? <p className="px-4 py-8 text-center text-sm text-gray-500">Nothing due in the next two weeks.</p> : <Agenda events={upcoming} />}
        </section>
      </div>
    </ProjectsPage>
  );
}

function Agenda({ events }: { events: CalEvent[] }) {
  const t = today();
  const groups: [string, CalEvent[]][] = [];
  for (const e of events) {
    const k = e.date.slice(0, 10);
    const last = groups[groups.length - 1];
    if (last && last[0] === k) last[1].push(e); else groups.push([k, [e]]);
  }
  return (
    <ol className="divide-y divide-gray-100">
      {groups.map(([day, evs]) => (
        <li key={day} className="px-4 py-3">
          <div className={cn('mb-1.5 text-xs font-semibold uppercase tracking-wide', day === t ? 'text-primary-600' : 'text-gray-500')}>
            {day === t ? 'Today · ' : day === addDays(t, 1) ? 'Tomorrow · ' : ''}{fmtDay(day, { weekday: true })}
          </div>
          <ul className="space-y-1.5">
            {evs.map((e, i) => (
              <li key={i}>
                <Link href={`/projects/${e.project_id}`} className="flex items-start gap-2 rounded-lg p-1 -m-1 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
                  <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', TYPE_STYLE[e.type].dot)} aria-hidden />
                  <span className="min-w-0">
                    <span className={cn('block text-sm text-gray-900', struck(e) && 'line-through text-gray-400')}>
                      {e.type === 'meeting' && e.at ? <><strong>{fmtPkt(e.at, { date: false })}</strong> · </> : null}{e.title}
                      {e.type === 'meeting' && e.extra && <span className="text-gray-500"> ({e.extra === 'client' ? 'client' : 'internal'})</span>}
                    </span>
                    <span className="block truncate text-xs text-gray-500">{TYPE_STYLE[e.type].label} · {e.ticket_no} {e.project_title}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
