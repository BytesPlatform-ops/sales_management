'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Video } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Btn, Spinner } from '@/components/training/ui';
import { usePapi, ymd, parseDay, addDays, today, fmtPkt, ProjectDetail, utcToZoned, PKT } from '@/components/projects/lib';
import { TicketCard, ticketHref } from './lib';
import { TypeIcon } from './bits';
import { useTicketPatch } from './actions';
import { canEditCard, TicketPerms } from './perms';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Month (or week) of tickets by due date plus the project's meetings. Drag a
 * ticket to another day to change its due date.
 */
export function TicketCalendar({ d, filterQs, perms, onChange }: { d: ProjectDetail; filterQs: string; perms: TicketPerms; onChange: () => void }) {
  const [mode, setMode] = useState<'month' | 'week'>('month');
  const [anchor, setAnchor] = useState(() => today());
  const [dragId, setDragId] = useState<number | null>(null);
  const [overDay, setOverDay] = useState<string | null>(null);
  const t0 = today();

  const grid = useMemo(() => {
    const a = parseDay(anchor);
    if (mode === 'week') {
      const start = addDays(anchor, -((a.getDay() + 6) % 7));
      return { days: Array.from({ length: 7 }, (_, i) => addDays(start, i)), first: start, last: addDays(start, 6) };
    }
    const first = new Date(a.getFullYear(), a.getMonth(), 1);
    const last = new Date(a.getFullYear(), a.getMonth() + 1, 0);
    const start = addDays(ymd(first), -((first.getDay() + 6) % 7));
    const end = addDays(ymd(last), 6 - ((last.getDay() + 6) % 7));
    const days: string[] = [];
    for (let x = start; x <= end; x = addDays(x, 1)) days.push(x);
    return { days, first: ymd(first), last: ymd(last) };
  }, [anchor, mode]);

  const qs = new URLSearchParams(filterQs);
  qs.set('view', 'work'); qs.set('due_from', grid.days[0]); qs.set('due_to', grid.days[grid.days.length - 1]);
  const { data: tickets, isLoading, mutate } = usePapi<TicketCard[]>(`/api/projects/${d.project.id}/tickets?${qs}`, { keepPreviousData: true, refreshInterval: 30_000 });
  const patch = useTicketPatch(() => { mutate(); onChange(); });

  const byDay = useMemo(() => {
    const m = new Map<string, { tickets: TicketCard[]; meetings: ProjectDetail['meetings'] }>();
    const at = (k: string) => { if (!m.has(k)) m.set(k, { tickets: [], meetings: [] }); return m.get(k)!; };
    for (const t of tickets || []) if (t.due_date) at(t.due_date).tickets.push(t);
    for (const mt of d.meetings) if (mt.status !== 'cancelled') at(utcToZoned(mt.starts_at, PKT).date).meetings.push(mt);
    return m;
  }, [tickets, d.meetings]);

  const shift = (n: number) => {
    if (mode === 'week') setAnchor((x) => addDays(x, 7 * n));
    else setAnchor((x) => { const a = parseDay(x); return ymd(new Date(a.getFullYear(), a.getMonth() + n, 1)); });
  };
  const label = mode === 'week'
    ? `${parseDay(grid.days[0]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${parseDay(grid.days[6]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
    : parseDay(grid.first).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  async function dropOn(day: string) {
    const id = dragId;
    setDragId(null); setOverDay(null);
    const t = tickets?.find((x) => x.id === id);
    if (!t || t.due_date === day) return;
    await patch(t.id, { due_date: day });
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Btn variant="secondary" size="sm" onClick={() => shift(-1)}><ChevronLeft className="h-4 w-4" /><span className="sr-only">Previous</span></Btn>
        <Btn variant="secondary" size="sm" onClick={() => setAnchor(today())}>Today</Btn>
        <Btn variant="secondary" size="sm" onClick={() => shift(1)}><ChevronRight className="h-4 w-4" /><span className="sr-only">Next</span></Btn>
        <h3 className="min-w-[10rem] text-sm font-semibold text-gray-900" aria-live="polite">{label}</h3>
        <div className="ml-auto inline-flex gap-1 rounded-lg bg-gray-100 p-0.5" role="tablist" aria-label="Calendar range">
          {(['month', 'week'] as const).map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
              className={cn('rounded-md px-2.5 py-1 text-xs font-medium', mode === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600')}>{m === 'month' ? 'Month' : 'Week'}</button>
          ))}
        </div>
      </div>
      {isLoading && !tickets ? <Spinner label="Loading…" /> : (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <div className="min-w-[640px]">
            <div className="grid grid-cols-7 border-b border-gray-100 bg-gray-50 text-center text-xs font-semibold uppercase tracking-wide text-gray-500">
              {WEEKDAYS.map((w) => <div key={w} className="py-1.5">{w}</div>)}
            </div>
            <div className="grid grid-cols-7">
              {grid.days.map((day) => {
                const cell = byDay.get(day);
                const inMonth = mode === 'week' || (day >= grid.first && day <= grid.last);
                return (
                  <div key={day}
                    onDragOver={dragId != null ? (e) => { e.preventDefault(); setOverDay(day); } : undefined}
                    onDragLeave={() => setOverDay((o) => (o === day ? null : o))}
                    onDrop={(e) => { e.preventDefault(); dropOn(day); }}
                    className={cn('min-w-0 border-b border-r border-gray-100 p-1', mode === 'week' ? 'min-h-[220px]' : 'min-h-[104px]',
                      !inMonth && 'bg-gray-50/70', overDay === day && 'bg-primary-50 ring-2 ring-inset ring-primary-300')}>
                    <div className={cn('mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium',
                      day === t0 ? 'bg-primary-600 text-white' : inMonth ? 'text-gray-700' : 'text-gray-400')}>{parseDay(day).getDate()}</div>
                    <ul className="space-y-0.5">
                      {cell?.meetings.map((mt) => (
                        <li key={`m${mt.id}`} title={`${mt.title} · ${fmtPkt(mt.starts_at)}`}
                          className="flex items-center gap-1 truncate rounded border border-amber-200 bg-amber-50 px-1 py-0.5 text-[11px] text-amber-800">
                          <Video className="h-3 w-3 shrink-0" />{fmtPkt(mt.starts_at, { date: false })} {mt.title}
                        </li>
                      ))}
                      {cell?.tickets.map((t) => {
                        const movable = canEditCard(perms, t);
                        const overdue = day < t0 && !['done', 'closed'].includes(t.status);
                        return (
                          <li key={t.id}>
                            <Link href={ticketHref(t.project_id, t.key)} draggable={movable} data-nav-item
                              onDragStart={(e) => { e.dataTransfer.setData('text/ticket-id', String(t.id)); setDragId(t.id); }}
                              onDragEnd={() => { setDragId(null); setOverDay(null); }}
                              title={`${t.key} ${t.title}${movable ? ' — drag to another day to change the due date' : ''}`}
                              className={cn('flex items-center gap-1 truncate rounded border px-1 py-0.5 text-[11px] hover:brightness-95',
                                t.status === 'done' ? 'border-emerald-200 bg-emerald-50 text-emerald-700 line-through' : overdue ? 'border-red-200 bg-red-50 text-red-700' : 'border-gray-200 bg-white text-gray-800',
                                movable && 'cursor-grab', dragId === t.id && 'opacity-40')}>
                              <TypeIcon type={t.type} className="h-3 w-3" /><span className="font-semibold">T{t.number}</span> <span className="truncate">{t.title}</span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
      <p className="mt-2 text-xs text-gray-500">Tickets show on their due date; meetings in Pakistan time. Drag a ticket to another day to move its due date.</p>
    </div>
  );
}
