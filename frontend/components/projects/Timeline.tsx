'use client';

import { useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, AlertTriangle, CalendarClock, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Btn, inputCls } from '@/components/training/ui';
import { Modal, Field, selectCls, useConfirm, useToast } from './ui';
import {
  papi, ProjectDetail, Milestone, today, fmtDay, daysBetween, addDays, workingDaysUntil, ymd, fmtPkt, MEMBER_ROLE_LABELS,
} from './lib';

const MS_STATUS: { v: Milestone['status']; label: string }[] = [
  { v: 'pending', label: 'To do' },
  { v: 'in_progress', label: 'Doing' },
  { v: 'done', label: 'Done' },
];
const CLOSED = ['delivered', 'closed', 'cancelled'];

function msTone(m: Milestone, t: string) {
  if (m.status === 'done') return { bar: 'bg-emerald-500', text: 'text-emerald-700', label: 'Done' };
  if (m.due_date < t) return { bar: 'bg-red-500', text: 'text-red-700', label: 'Overdue' };
  if (m.status === 'in_progress') return { bar: 'bg-primary-500', text: 'text-primary-700', label: 'In progress' };
  return { bar: 'bg-gray-400', text: 'text-gray-600', label: 'To do' };
}

/** Deadline / delivery headline used by the summary and the full timeline. */
export function DeadlineNote({ d }: { d: ProjectDetail }) {
  const p = d.project;
  const t = today();
  if (CLOSED.includes(p.status)) {
    return <p className="text-sm text-gray-600">{p.status === 'delivered' ? 'Delivered' : p.status === 'closed' ? 'Closed' : 'Cancelled'}{p.delivered_at ? ` · delivered ${fmtDay(p.delivered_at)}` : ''}.</p>;
  }
  if (!p.deadline) return <p className="text-sm text-gray-500">No internal deadline yet{d.permissions.edit_dates ? ' — set one under Details.' : ' — HR will set it.'}</p>;
  const late = daysBetween(p.deadline, t);
  const lines: JSX.Element[] = [];
  if (late > 0) {
    lines.push(<p key="l" className="flex items-start gap-1.5 text-sm font-semibold text-red-700"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />{late} day{late === 1 ? '' : 's'} past the deadline ({fmtDay(p.deadline)}).</p>);
  } else if (late === 0) {
    lines.push(<p key="t" className="flex items-start gap-1.5 text-sm font-semibold text-amber-700"><CalendarClock className="h-4 w-4 mt-0.5 shrink-0" />Deadline is today.</p>);
  } else {
    const wd = workingDaysUntil(p.deadline, t);
    lines.push(<p key="w" className={cn('flex items-start gap-1.5 text-sm font-semibold', wd <= 5 ? 'text-amber-700' : 'text-gray-900')}><CalendarClock className="h-4 w-4 mt-0.5 shrink-0" />{wd} working day{wd === 1 ? '' : 's'} left until the deadline ({fmtDay(p.deadline)}).</p>);
  }
  if (p.expected_delivery && p.expected_delivery < p.deadline) {
    lines.push(<p key="x" className="text-xs text-amber-700">Heads-up: the client was promised {fmtDay(p.expected_delivery)}, which is before the internal deadline.</p>);
  }
  if (p.expected_delivery && p.expected_delivery < t) {
    lines.push(<p key="e" className="text-xs font-medium text-red-700">The promised delivery date ({fmtDay(p.expected_delivery)}) has passed.</p>);
  }
  const lateMs = d.milestones.filter((m) => m.status !== 'done' && m.due_date < t).length;
  if (lateMs) lines.push(<p key="m" className="text-xs font-medium text-red-700">{lateMs} milestone{lateMs === 1 ? ' is' : 's are'} overdue.</p>);
  return <div className="space-y-1">{lines}</div>;
}

/** Horizontal calendar path: start → milestones → deadline → expected delivery, with meetings. */
export function Gantt({ d }: { d: ProjectDetail }) {
  const p = d.project;
  const t = today();
  const range = useMemo(() => {
    const start = p.start_date || p.created_at.slice(0, 10);
    const dates = [start, p.deadline, p.expected_delivery, ...d.milestones.flatMap((m) => [m.start_date, m.due_date])]
      .concat(d.meetings.filter((m) => m.status !== 'cancelled').map((m) => ymd(new Date(m.starts_at))))
      .filter(Boolean) as string[];
    if (!CLOSED.includes(p.status)) dates.push(t);
    let from = dates.reduce((a, b) => (b < a ? b : a), start);
    let to = dates.reduce((a, b) => (b > a ? b : a), start);
    if (daysBetween(from, to) < 7) to = addDays(from, 7);
    const pad = Math.max(1, Math.round(daysBetween(from, to) * 0.03));
    from = addDays(from, -pad);
    to = addDays(to, pad);
    return { from, to, span: daysBetween(from, to) };
  }, [p, d.milestones, d.meetings, t]);

  const pos = (s: string) => `${Math.max(0, Math.min(100, (daysBetween(range.from, s) / range.span) * 100))}%`;
  const width = (a: string, b: string) => `${Math.max(0.8, ((daysBetween(a, b) + 1) / range.span) * 100)}%`;

  const ticks = useMemo(() => {
    const n = 5;
    return Array.from({ length: n + 1 }, (_, i) => addDays(range.from, Math.round((range.span * i) / n)));
  }, [range]);

  const projStart = p.start_date || p.created_at.slice(0, 10);
  const projEnd = p.deadline || p.expected_delivery;
  const markers = [
    { date: t, cls: 'bg-primary-600', label: 'Today', show: t >= range.from && t <= range.to },
    { date: p.deadline, cls: 'bg-red-500', label: 'Deadline', show: !!p.deadline },
    { date: p.expected_delivery, cls: 'bg-emerald-500', label: 'Delivery to client', show: !!p.expected_delivery },
  ].filter((m) => m.show && m.date) as { date: string; cls: string; label: string }[];
  const meetings = d.meetings.filter((m) => m.status !== 'cancelled');

  return (
    <div className="min-w-0">
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500" aria-hidden>
        <span className="flex items-center gap-1"><span className="h-3 w-0.5 bg-primary-600" />Today</span>
        <span className="flex items-center gap-1"><span className="h-3 w-0.5 bg-red-500" />Deadline</span>
        <span className="flex items-center gap-1"><span className="h-3 w-0.5 bg-emerald-500" />Delivery to client</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" />Meeting</span>
        <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-emerald-500" />Done</span>
        <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-primary-500" />In progress</span>
        <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-gray-400" />To do</span>
        <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-red-500" />Overdue</span>
      </div>
      <div className="relative rounded-xl border border-gray-100 bg-gray-50/60 px-2 pb-2 pt-7" role="img"
        aria-label={`Timeline from ${fmtDay(range.from)} to ${fmtDay(range.to)}: ${d.milestones.length} milestones${p.deadline ? `, deadline ${fmtDay(p.deadline)}` : ''}${p.expected_delivery ? `, delivery ${fmtDay(p.expected_delivery)}` : ''}.`}>
        {/* axis */}
        <div className="absolute inset-x-2 top-1.5 h-4">
          {ticks.map((tk, i) => (
            <span key={i} className={cn('absolute text-[10px] text-gray-400 whitespace-nowrap', i === 0 ? '' : i === ticks.length - 1 ? '-translate-x-full' : '-translate-x-1/2')} style={{ left: pos(tk) }}>
              {fmtDay(tk, { noYear: true })}
            </span>
          ))}
        </div>
        <div className="relative">
          {/* weekly grid lines are noise at small widths; just the markers */}
          {markers.map((m) => (
            <div key={m.label} className={cn('absolute -top-1 bottom-0 w-0.5 z-10', m.cls)} style={{ left: pos(m.date) }} title={`${m.label}: ${fmtDay(m.date)}`} />
          ))}

          {/* project bar */}
          <div className="relative h-7">
            <div className="absolute top-1 h-5 rounded-md bg-gray-800/80 text-[10px] font-semibold leading-5 text-white px-1.5 overflow-hidden whitespace-nowrap"
              style={{ left: pos(projStart), width: projEnd ? width(projStart, projEnd) : '2%' }}
              title={`Work ${fmtDay(projStart)} → ${projEnd ? fmtDay(projEnd) : 'no deadline'}`}>
              {p.start_date ? 'Work' : 'Opened'}
            </div>
          </div>

          {d.milestones.map((m) => {
            const tone = msTone(m, t);
            const a = m.start_date || m.due_date;
            return (
              <div key={m.id} className="relative h-9">
                <div className="absolute top-0 text-[10px] leading-3 text-gray-600 whitespace-nowrap truncate max-w-[70%]"
                  style={{ left: pos(a), transform: daysBetween(range.from, a) / range.span > 0.7 ? 'translateX(-100%)' : undefined }}>
                  <span className={cn(m.status === 'done' && 'line-through text-gray-400')}>{m.title}</span>
                </div>
                <div className={cn('absolute top-4 h-3.5 rounded', tone.bar)} style={{ left: pos(a), width: width(a, m.due_date) }}
                  title={`${m.title}: ${m.start_date ? `${fmtDay(m.start_date)} → ` : 'due '}${fmtDay(m.due_date)} · ${tone.label}`} />
              </div>
            );
          })}

          {meetings.length > 0 && (
            <div className="relative h-6">
              {meetings.map((m) => (
                <span key={m.id} className={cn('absolute top-1.5 h-3 w-3 -translate-x-1/2 rounded-full ring-2 ring-white', m.status === 'done' ? 'bg-amber-300' : 'bg-amber-500')}
                  style={{ left: pos(ymd(new Date(m.starts_at))) }} title={`${m.kind === 'client' ? 'Client' : 'Internal'} meeting: ${m.title} · ${fmtPkt(m.starts_at)}`} />
              ))}
            </div>
          )}
        </div>
      </div>
      {d.milestones.length === 0 && <p className="mt-2 text-xs text-gray-500">No milestones yet. Break the work into a few steps so everyone can see progress.</p>}
    </div>
  );
}

interface MsForm { id?: number; title: string; description: string; start_date: string; due_date: string; assignee_id: string }

export function Milestones({ d, onChange }: { d: ProjectDetail; onChange: () => void }) {
  const can = d.permissions.manage_milestones;
  const confirm = useConfirm();
  const toast = useToast();
  const [form, setForm] = useState<MsForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);
  const t = today();
  const assignable = d.members.filter((m) => m.member_role !== 'watcher');

  const save = async () => {
    if (!form) return;
    if (!form.title.trim()) return setFormErr('Give the milestone a title');
    if (!form.due_date) return setFormErr('Pick a due date');
    if (form.start_date && form.start_date > form.due_date) return setFormErr('The start date is after the due date');
    setSaving(true);
    setFormErr(null);
    try {
      const body = { title: form.title.trim(), description: form.description, start_date: form.start_date || null, due_date: form.due_date, assignee_id: form.assignee_id ? Number(form.assignee_id) : null };
      if (form.id) await papi(`/api/projects/${d.project.id}/milestones`, { method: 'PATCH', body: { id: form.id, ...body } });
      else await papi(`/api/projects/${d.project.id}/milestones`, { body });
      toast(form.id ? 'Milestone updated' : 'Milestone added');
      setForm(null);
      onChange();
    } catch (e) {
      setFormErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const patch = async (m: Milestone, body: Record<string, unknown>) => {
    setBusyId(m.id);
    try {
      await papi(`/api/projects/${d.project.id}/milestones`, { method: 'PATCH', body: { id: m.id, ...body } });
      onChange();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (m: Milestone) => {
    if (!(await confirm({ title: 'Delete milestone?', body: <>“{m.title}” will be removed from the timeline. This can’t be undone.</>, confirmLabel: 'Delete', danger: true }))) return;
    setBusyId(m.id);
    try {
      await papi(`/api/projects/${d.project.id}/milestones?milestone_id=${m.id}`, { method: 'DELETE' });
      toast('Milestone deleted');
      onChange();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const doneCount = d.milestones.filter((m) => m.status === 'done').length;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">Milestones <span className="font-normal text-gray-500">· {doneCount}/{d.milestones.length} done</span></h3>
        {can && (
          <Btn size="sm" variant="secondary" onClick={() => { setFormErr(null); setForm({ title: '', description: '', start_date: t > (d.project.start_date || '') ? t : d.project.start_date || t, due_date: '', assignee_id: '' }); }}>
            <Plus className="h-4 w-4" /> Add milestone
          </Btn>
        )}
      </div>
      {d.milestones.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500">
          {can ? 'Add the main steps (e.g. “Design mockups”, “Build pages”, “Client review”) with due dates.' : 'The team hasn’t added milestones yet.'}
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
          {d.milestones.map((m) => {
            const tone = msTone(m, t);
            return (
              <li key={m.id} className={cn('flex flex-col sm:flex-row sm:items-center gap-2 px-3 py-2.5', busyId === m.id && 'opacity-60')}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', tone.bar)} aria-hidden />
                    <span className={cn('font-medium text-sm text-gray-900 truncate', m.status === 'done' && 'line-through text-gray-400')}>{m.title}</span>
                    {tone.label === 'Overdue' && <span className="text-[11px] font-semibold text-red-600">Overdue</span>}
                  </div>
                  <div className="ml-[18px] text-xs text-gray-500">
                    {m.start_date ? `${fmtDay(m.start_date, { noYear: true })} → ` : 'Due '}{fmtDay(m.due_date)}
                    {m.assignee_name && <> · {m.assignee_name}</>}
                    {m.description && <span className="block text-gray-400 truncate">{m.description}</span>}
                  </div>
                </div>
                {can ? (
                  <div className="flex flex-wrap items-center gap-1.5 sm:shrink-0">
                    <div role="radiogroup" aria-label={`Status of ${m.title}`} className="inline-flex rounded-lg border border-gray-200 p-0.5">
                      {MS_STATUS.map((s) => (
                        <button key={s.v} role="radio" aria-checked={m.status === s.v} disabled={busyId === m.id} onClick={() => m.status !== s.v && patch(m, { status: s.v })}
                          className={cn('rounded-md px-2 py-1 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                            m.status === s.v ? (s.v === 'done' ? 'bg-emerald-600 text-white' : s.v === 'in_progress' ? 'bg-primary-600 text-white' : 'bg-gray-700 text-white') : 'text-gray-600 hover:bg-gray-100')}>
                          {s.label}
                        </button>
                      ))}
                    </div>
                    <label className="sr-only" htmlFor={`as-${m.id}`}>Assignee for {m.title}</label>
                    <select id={`as-${m.id}`} value={m.assignee_id ? String(m.assignee_id) : ''} disabled={busyId === m.id}
                      onChange={(e) => patch(m, { assignee_id: e.target.value ? Number(e.target.value) : null })}
                      className="max-w-[140px] rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs">
                      <option value="">Unassigned</option>
                      {assignable.map((p) => <option key={String(p.id)} value={String(p.id)}>{p.name}</option>)}
                    </select>
                    <button onClick={() => { setFormErr(null); setForm({ id: m.id, title: m.title, description: m.description || '', start_date: m.start_date || '', due_date: m.due_date, assignee_id: m.assignee_id ? String(m.assignee_id) : '' }); }}
                      className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500" aria-label={`Edit ${m.title}`}><Pencil className="h-4 w-4" /></button>
                    <button onClick={() => remove(m)} className="rounded-lg p-1.5 text-gray-500 hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500" aria-label={`Delete ${m.title}`}><Trash2 className="h-4 w-4" /></button>
                  </div>
                ) : (
                  <span className={cn('text-xs font-medium', tone.text)}>{m.status === 'done' && <CheckCircle2 className="inline h-3.5 w-3.5 mr-0.5" />}{tone.label}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Edit milestone' : 'Add milestone'}
        footer={<><Btn variant="secondary" onClick={() => setForm(null)}>Cancel</Btn><Btn onClick={save} disabled={saving}>{saving ? 'Saving…' : form?.id ? 'Save' : 'Add milestone'}</Btn></>}>
        {form && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Title *" htmlFor="ms-title" className="sm:col-span-2">
              <input id="ms-title" className={inputCls} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={200} onKeyDown={(e) => e.key === 'Enter' && save()} />
            </Field>
            <Field label="Start date" htmlFor="ms-start"><input id="ms-start" type="date" className={inputCls} value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></Field>
            <Field label="Due date *" htmlFor="ms-due"><input id="ms-due" type="date" className={inputCls} value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></Field>
            <Field label="Assignee" htmlFor="ms-assignee" className="sm:col-span-2">
              <select id="ms-assignee" className={selectCls} value={form.assignee_id} onChange={(e) => setForm({ ...form, assignee_id: e.target.value })}>
                <option value="">Unassigned</option>
                {assignable.map((p) => <option key={String(p.id)} value={String(p.id)}>{p.name} ({MEMBER_ROLE_LABELS[p.member_role] || p.member_role})</option>)}
              </select>
            </Field>
            <Field label="Notes" htmlFor="ms-desc" className="sm:col-span-2">
              <textarea id="ms-desc" rows={2} className={inputCls} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
            {d.project.deadline && form.due_date > d.project.deadline && (
              <p className="sm:col-span-2 text-xs text-amber-700">This is after the project deadline ({fmtDay(d.project.deadline)}).</p>
            )}
            {formErr && <p className="sm:col-span-2 text-sm text-red-600" role="alert">{formErr}</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}

