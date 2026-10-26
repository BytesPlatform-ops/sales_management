'use client';

import { useMemo, useState } from 'react';
import { Plus, Video, MapPin, CheckCircle2, XCircle, Trash2, Pencil, Users, Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Btn, Pill, inputCls } from '@/components/training/ui';
import { Modal, Field, selectCls, useConfirm, useToast } from './ui';
import { papi, ProjectDetail, Meeting, fmtInTz, fmtPkt, zonedToUtcIso, utcToZoned, tzLabel, tzAbbr, today, addDays, fmtDay } from './lib';

interface MtForm { id?: number; title: string; kind: 'client' | 'internal'; date: string; time: string; duration_min: string; location: string; agenda: string }

const isUrl = (s: string) => /^https?:\/\//i.test(s.trim());

export function Meetings({ d, onChange, className }: { d: ProjectDetail; onChange: () => void; className?: string }) {
  const tz = d.project.client_timezone || 'America/New_York';
  const confirm = useConfirm();
  const toast = useToast();
  const [form, setForm] = useState<MtForm | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [doneFor, setDoneFor] = useState<Meeting | null>(null);
  const [outcome, setOutcome] = useState('');
  const [showPast, setShowPast] = useState(false);
  const can = d.permissions.manage_meetings;

  const { upcoming, past } = useMemo(() => {
    const now = Date.now();
    const up: Meeting[] = [];
    const pa: Meeting[] = [];
    for (const m of d.meetings) {
      const end = new Date(m.starts_at).getTime() + m.duration_min * 60_000;
      if (m.status === 'scheduled' && end >= now) up.push(m); else pa.push(m);
    }
    up.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    pa.sort((a, b) => b.starts_at.localeCompare(a.starts_at));
    return { upcoming: up, past: pa };
  }, [d.meetings]);

  const iso = form ? zonedToUtcIso(form.date, form.time, tz) : null;

  const openNew = () => {
    setFormErr(null);
    setForm({ title: '', kind: 'client', date: addDays(today(), 1), time: '10:00', duration_min: '30', location: '', agenda: '' });
  };
  const openEdit = (m: Meeting) => {
    const z = utcToZoned(m.starts_at, tz);
    setFormErr(null);
    setForm({ id: m.id, title: m.title, kind: m.kind, date: z.date, time: z.time, duration_min: String(m.duration_min), location: m.location || '', agenda: m.agenda || '' });
  };

  const save = async () => {
    if (!form) return;
    if (!form.title.trim()) return setFormErr('Give the meeting a title');
    if (!iso) return setFormErr('Pick a date and time');
    setSaving(true);
    setFormErr(null);
    try {
      const body = { title: form.title.trim(), kind: form.kind, starts_at: iso, duration_min: Number(form.duration_min) || 30, location: form.location.trim(), agenda: form.agenda.trim() };
      if (form.id) await papi(`/api/projects/${d.project.id}/meetings`, { method: 'PATCH', body: { id: form.id, ...body } });
      else await papi(`/api/projects/${d.project.id}/meetings`, { body });
      toast(form.id ? 'Meeting updated' : 'Meeting scheduled');
      setForm(null);
      onChange();
    } catch (e) {
      setFormErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const patch = async (m: Meeting, body: Record<string, unknown>, msg: string) => {
    try {
      await papi(`/api/projects/${d.project.id}/meetings`, { method: 'PATCH', body: { id: m.id, ...body } });
      toast(msg);
      onChange();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  const cancel = async (m: Meeting) => {
    if (await confirm({ title: 'Cancel this meeting?', body: <>“{m.title}” on {fmtInTz(m.starts_at, tz)} will be marked cancelled. Let the client know if they were invited.</>, confirmLabel: 'Cancel meeting', danger: true })) {
      patch(m, { status: 'cancelled' }, 'Meeting cancelled');
    }
  };
  const remove = async (m: Meeting) => {
    if (!(await confirm({ title: 'Delete this meeting?', body: <>“{m.title}” will be removed completely. This can’t be undone.</>, confirmLabel: 'Delete', danger: true }))) return;
    try {
      await papi(`/api/projects/${d.project.id}/meetings?meeting_id=${m.id}`, { method: 'DELETE' });
      toast('Meeting deleted');
      onChange();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  const markDone = async () => {
    if (!doneFor) return;
    await patch(doneFor, { status: 'done', outcome: outcome.trim() || null }, 'Meeting marked done');
    setDoneFor(null);
  };

  const row = (m: Meeting) => (
    <li key={m.id} className={cn('rounded-xl border px-3 py-2.5', m.status === 'cancelled' ? 'border-gray-100 bg-gray-50' : 'border-gray-200')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={cn('font-medium text-sm text-gray-900', m.status === 'cancelled' && 'line-through text-gray-400')}>{m.title}</span>
            <Pill tone={m.kind === 'client' ? 'amber' : 'gray'}>{m.kind === 'client' ? <><Building2 className="h-3 w-3" />Client</> : <><Users className="h-3 w-3" />Internal</>}</Pill>
            {m.status === 'done' && <Pill tone="green">Done</Pill>}
            {m.status === 'cancelled' && <Pill tone="red">Cancelled</Pill>}
          </div>
          <div className="mt-0.5 text-sm text-gray-800">{fmtInTz(m.starts_at, tz)} <span className="text-gray-400">· {m.duration_min} min</span></div>
          <div className="text-xs text-gray-500">{fmtPkt(m.starts_at)}</div>
          {m.location && (
            <div className="mt-1 flex items-center gap-1 text-xs min-w-0">
              {isUrl(m.location) ? <Video className="h-3 w-3 shrink-0 text-gray-400" /> : <MapPin className="h-3 w-3 shrink-0 text-gray-400" />}
              {isUrl(m.location)
                ? <a href={m.location} target="_blank" rel="noopener noreferrer" className="truncate text-primary-600 hover:underline">{m.location.replace(/^https?:\/\//, '')}</a>
                : <span className="truncate text-gray-600">{m.location}</span>}
            </div>
          )}
          {m.agenda && <p className="mt-1 text-xs text-gray-600 whitespace-pre-wrap break-words">{m.agenda}</p>}
          {m.outcome && <p className="mt-1 rounded-lg bg-emerald-50 px-2 py-1 text-xs text-emerald-800 whitespace-pre-wrap break-words"><strong>Notes:</strong> {m.outcome}</p>}
        </div>
      </div>
      {can && (
        <div className="mt-2 flex flex-wrap gap-1">
          {m.status === 'scheduled' && (
            <>
              <button onClick={() => { setOutcome(''); setDoneFor(m); }} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"><CheckCircle2 className="h-3.5 w-3.5" />Mark done</button>
              <button onClick={() => openEdit(m)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"><Pencil className="h-3.5 w-3.5" />Edit</button>
              <button onClick={() => cancel(m)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"><XCircle className="h-3.5 w-3.5" />Cancel</button>
            </>
          )}
          <button onClick={() => remove(m)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"><Trash2 className="h-3.5 w-3.5" />Delete</button>
        </div>
      )}
    </li>
  );

  return (
    <section className={cn('bg-white rounded-2xl border border-gray-200 shadow-sm min-w-0', className)}>
      <div className="flex items-center justify-between gap-2 px-4 sm:px-5 pt-4 pb-3 border-b border-gray-100">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Meetings</h2>
        {can && <Btn size="sm" variant="secondary" onClick={openNew}><Plus className="h-4 w-4" />Schedule</Btn>}
      </div>
      <div className="p-4 sm:p-5">
        <p className="mb-3 text-xs text-gray-500">Times shown in the client’s zone ({tzLabel(tz)}) and Pakistan time.</p>
        {upcoming.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-200 px-4 py-5 text-center text-sm text-gray-500">No upcoming meetings.</p>
        ) : <ul className="space-y-2">{upcoming.map(row)}</ul>}
        {past.length > 0 && (
          <div className="mt-4">
            <button onClick={() => setShowPast((s) => !s)} className="text-xs font-medium text-gray-600 hover:text-gray-900" aria-expanded={showPast}>
              {showPast ? 'Hide' : 'Show'} past & cancelled ({past.length})
            </button>
            {showPast && <ul className="mt-2 space-y-2">{past.map(row)}</ul>}
          </div>
        )}
      </div>

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Edit meeting' : 'Schedule a meeting'}
        footer={<><Btn variant="secondary" onClick={() => setForm(null)}>Cancel</Btn><Btn onClick={save} disabled={saving}>{saving ? 'Saving…' : form?.id ? 'Save' : 'Schedule'}</Btn></>}>
        {form && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Title *" htmlFor="mt-title" className="sm:col-span-2">
              <input id="mt-title" className={inputCls} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Kick-off call" maxLength={200} />
            </Field>
            <fieldset className="sm:col-span-2">
              <legend className="block text-sm font-medium text-gray-700 mb-1">With</legend>
              <div className="flex gap-2">
                {(['client', 'internal'] as const).map((k) => (
                  <label key={k} className={cn('flex flex-1 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-primary-500', form.kind === k ? 'border-primary-400 bg-primary-50' : 'border-gray-200')}>
                    <input type="radio" name="mt-kind" checked={form.kind === k} onChange={() => setForm({ ...form, kind: k })} />
                    {k === 'client' ? 'The client' : 'Internal (team only)'}
                  </label>
                ))}
              </div>
            </fieldset>
            <Field label={`Date (client’s time, ${tzAbbr(tz)})`} htmlFor="mt-date">
              <input id="mt-date" type="date" className={inputCls} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </Field>
            <Field label={`Start time (client’s time, ${tzAbbr(tz)})`} htmlFor="mt-time">
              <input id="mt-time" type="time" step={300} className={inputCls} value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
            </Field>
            <div className="sm:col-span-2 rounded-xl bg-gray-50 px-3 py-2 text-sm" aria-live="polite">
              {iso ? (
                <>
                  <div className="text-gray-900"><span className="text-gray-500">Client:</span> {fmtInTz(iso, tz)}</div>
                  <div className="text-gray-900"><span className="text-gray-500">Pakistan:</span> {fmtPkt(iso)}</div>
                  {new Date(iso).getTime() < Date.now() && <div className="mt-1 text-xs text-amber-700">This time is in the past.</div>}
                </>
              ) : <span className="text-gray-500">Pick a date and time to see it in Pakistan time.</span>}
            </div>
            <Field label="Duration" htmlFor="mt-dur">
              <select id="mt-dur" className={selectCls} value={form.duration_min} onChange={(e) => setForm({ ...form, duration_min: e.target.value })}>
                {[15, 30, 45, 60, 90, 120].map((n) => <option key={n} value={n}>{n < 60 ? `${n} min` : `${n / 60} hour${n > 60 ? 's' : ''}`}</option>)}
              </select>
            </Field>
            <Field label="Link or location" htmlFor="mt-loc">
              <input id="mt-loc" className={inputCls} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Zoom / Meet link or phone" />
            </Field>
            <Field label="Agenda" htmlFor="mt-agenda" className="sm:col-span-2">
              <textarea id="mt-agenda" rows={3} className={inputCls} value={form.agenda} onChange={(e) => setForm({ ...form, agenda: e.target.value })} />
            </Field>
            {formErr && <p className="sm:col-span-2 text-sm text-red-600" role="alert">{formErr}</p>}
          </div>
        )}
      </Modal>

      <Modal open={!!doneFor} onClose={() => setDoneFor(null)} title="Mark meeting as done"
        footer={<><Btn variant="secondary" onClick={() => setDoneFor(null)}>Cancel</Btn><Btn variant="success" onClick={markDone}>Mark done</Btn></>}>
        <Field label="What was agreed? (optional)" htmlFor="mt-outcome" hint="Posted to the thread so everyone sees it.">
          <textarea id="mt-outcome" rows={4} className={inputCls} value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="Decisions, next steps, anything the client asked for…" />
        </Field>
        {doneFor && <p className="mt-2 text-xs text-gray-500">{doneFor.title} · {fmtDay(doneFor.starts_at)}</p>}
      </Modal>
    </section>
  );
}
