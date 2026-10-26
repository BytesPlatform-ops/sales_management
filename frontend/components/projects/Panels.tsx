'use client';

import { useEffect, useMemo, useState } from 'react';
import { UserPlus, X, Mail, Phone, Clock, Repeat, CheckCircle2, SkipForward, ChevronDown, Save } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Btn, Pill, inputCls } from '@/components/training/ui';
import { Avatar, Modal, Field, SectionCard, selectCls, useConfirm, useToast, StatusPill } from './ui';
import {
  papi, usePapi, ProjectDetail, Person, Status, STATUS_LABELS, STATUS_ORDER, MEMBER_ROLE_LABELS, SERVICE_LABELS,
  PRIORITY_LABELS, RECURRENCE_LABELS, TIMEZONES, fmtDay, fmtInTz, tzAbbr, tzLabel, fmtMoney, today, sameId, PKT,
} from './lib';

// ------------------------------------------------------------------ client card

export function ClientCard({ d }: { d: ProjectDetail }) {
  const p = d.project;
  const tz = p.client_timezone || 'America/New_York';
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm min-w-0">
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Client</div>
      <div className="mt-1 font-semibold text-gray-900 break-words">{p.client_name}</div>
      {p.client_company && <div className="text-sm text-gray-600 break-words">{p.client_company}</div>}
      <div className="mt-2 space-y-1 text-sm">
        {p.client_email && <a href={`mailto:${p.client_email}`} className="flex items-center gap-1.5 text-primary-600 hover:underline min-w-0"><Mail className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{p.client_email}</span></a>}
        {p.client_phone && <a href={`tel:${p.client_phone.replace(/[^\d+]/g, '')}`} className="flex items-center gap-1.5 text-primary-600 hover:underline"><Phone className="h-3.5 w-3.5 shrink-0" />{p.client_phone}</a>}
        <div className="flex items-start gap-1.5 text-gray-700">
          <Clock className="h-3.5 w-3.5 mt-0.5 shrink-0 text-gray-400" />
          <span>
            Their time: <strong>{fmtInTz(now, tz, { date: false, zone: false })} {tzAbbr(tz, now)}</strong>
            <span className="block text-xs text-gray-500">{tzLabel(tz)} · Pakistan now {fmtInTz(now, PKT, { date: false, zone: false })} PKT</span>
          </span>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ status control

const DEV_TARGETS: { to: Status; label: string }[] = [
  { to: 'in_progress', label: 'Start work' },
  { to: 'review', label: 'Send for review' },
];

export function StatusControl({ d, onChange }: { d: ProjectDetail; onChange: () => void }) {
  const p = d.project;
  const role = d.permissions.role;
  const toast = useToast();
  const [target, setTarget] = useState<Status | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [menu, setMenu] = useState(false);

  if (!d.permissions.set_status) return null;

  let options: { to: Status; label: string }[] = [];
  if (role === 'developer') {
    if (['new', 'in_progress', 'review', 'on_hold'].includes(p.status)) {
      options = DEV_TARGETS.filter((o) => o.to !== p.status).map((o) => (o.to === 'in_progress' && p.status === 'review' ? { ...o, label: 'Back to in progress' } : o));
    }
  } else {
    const closed = ['closed', 'cancelled'].includes(p.status);
    options = closed
      ? [{ to: 'in_progress', label: 'Reopen (in progress)' }, { to: 'new', label: 'Reopen as new' }, ...(p.status === 'cancelled' ? [{ to: 'closed' as Status, label: 'Mark closed' }] : [])]
      : STATUS_ORDER.filter((s) => s !== p.status).map((s) => ({
          to: s, label: s === 'closed' ? 'Close project' : s === 'cancelled' ? 'Cancel project' : s === 'delivered' ? 'Mark delivered' : `Move to ${STATUS_LABELS[s]}`,
        }));
  }
  if (!options.length) return null;

  // One primary "next step" button + the rest in a menu.
  const next: Status | undefined = role === 'developer'
    ? (p.status === 'in_progress' ? 'review' : p.status === 'review' ? undefined : 'in_progress')
    : ({ new: 'in_progress', in_progress: 'review', review: 'delivered', on_hold: 'in_progress', delivered: 'closed', closed: 'in_progress', cancelled: 'in_progress' } as Record<Status, Status>)[p.status];
  const primary = options.find((o) => o.to === next) || (role === 'developer' ? options[0] : undefined);
  const rest = options.filter((o) => o !== primary);
  const danger = target === 'closed' || target === 'cancelled';

  const submit = async () => {
    if (!target) return;
    setSaving(true);
    try {
      await papi(`/api/projects/${p.id}/status`, { body: { status: target, note: note.trim() || undefined } });
      toast(`Moved to ${STATUS_LABELS[target]}`);
      setTarget(null);
      onChange();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const open = (s: Status) => { setNote(''); setMenu(false); setTarget(s); };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {primary && <Btn size="sm" variant={primary.to === 'delivered' ? 'success' : 'primary'} onClick={() => open(primary.to)}>{primary.label}</Btn>}
      {rest.length > 0 && (
        <div className="relative">
          <Btn size="sm" variant="secondary" onClick={() => setMenu((m) => !m)}>
            {primary ? 'More' : 'Change status'} <ChevronDown className="h-4 w-4" />
          </Btn>
          {menu && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setMenu(false)} aria-hidden />
              <ul role="menu" className="absolute right-0 z-30 mt-1 w-56 rounded-xl border border-gray-200 bg-white py-1 shadow-lg"
                onKeyDown={(e) => { if (e.key === 'Escape') setMenu(false); }}>
                {rest.map((o) => (
                  <li key={o.to} role="none">
                    <button role="menuitem" onClick={() => open(o.to)}
                      className={cn('flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 focus:bg-gray-50 focus:outline-none',
                        (o.to === 'cancelled' || o.to === 'closed') ? 'text-red-600' : 'text-gray-700')}>
                      {o.label}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <Modal open={!!target} onClose={() => setTarget(null)} size="sm"
        title={target === 'closed' ? 'Close this project?' : target === 'cancelled' ? 'Cancel this project?' : `Move to ${target ? STATUS_LABELS[target] : ''}`}
        footer={<>
          <Btn variant="secondary" onClick={() => setTarget(null)}>Back</Btn>
          <Btn variant={danger ? 'danger' : target === 'delivered' ? 'success' : 'primary'} onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : target === 'closed' ? 'Close project' : target === 'cancelled' ? 'Cancel project' : 'Confirm'}
          </Btn>
        </>}>
        <div className="space-y-3 text-sm text-gray-600">
          <div className="flex items-center gap-2"><StatusPill status={p.status} /> → {target && <StatusPill status={target} />}</div>
          {target === 'closed' && <p>Closing means the work is finished and the client is happy. It moves to the Closed tab{p.project_type === 'recurring' ? ' and no further cycles will open' : ''}. You can reopen it later.</p>}
          {target === 'cancelled' && <p>Cancelling stops all work on this project{p.project_type === 'recurring' ? ' and future cycles' : ''}. Everyone on the thread will see it. You can reopen it later.</p>}
          {target === 'delivered' && <p>Use this once the finished work has been handed over to the client.</p>}
          {target === 'review' && role === 'developer' && <p>Your supervisor will check the work before it goes to the client.</p>}
          <Field label="Note for the thread (optional)" htmlFor="status-note">
            <textarea id="status-note" rows={3} className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder={target === 'review' ? 'What should be checked?' : 'Why? Anything the team should know?'} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

// ------------------------------------------------------------------ people

export function People({ d, onChange, className }: { d: ProjectDetail; onChange: () => void; className?: string }) {
  const can = d.permissions.manage_members;
  const confirm = useConfirm();
  const toast = useToast();
  const { data: people } = usePapi<Person[]>(can ? '/api/projects/people' : null);
  const [userId, setUserId] = useState('');
  const [memberRole, setMemberRole] = useState('developer');
  const [adding, setAdding] = useState(false);
  const available = useMemo(() => (people || []).filter((u) => !d.members.some((m) => sameId(m.id, u.id))), [people, d.members]);

  const add = async () => {
    if (!userId) return;
    setAdding(true);
    try {
      await papi(`/api/projects/${d.project.id}/members`, { body: { user_id: Number(userId), member_role: memberRole } });
      toast('Added to the project');
      setUserId('');
      onChange();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setAdding(false);
    }
  };
  const remove = async (id: string | number, name: string) => {
    if (!(await confirm({ title: `Remove ${name}?`, body: `${name} will no longer see this project or its thread.`, confirmLabel: 'Remove', danger: true }))) return;
    try {
      await papi(`/api/projects/${d.project.id}/members?user_id=${id}`, { method: 'DELETE' });
      toast(`${name} removed`);
      onChange();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  const changeRole = async (id: string | number, role: string) => {
    try {
      await papi(`/api/projects/${d.project.id}/members`, { body: { user_id: Number(id), member_role: role } });
      onChange();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const p = d.project;
  return (
    <SectionCard title="People" className={className}>
      <ul className="space-y-2.5">
        {p.supervisor_name && (
          <li className="flex items-center gap-2.5"><Avatar name={p.supervisor_name} /><div className="min-w-0"><div className="text-sm font-medium text-gray-900 truncate">{p.supervisor_name}</div><div className="text-xs text-gray-500">Supervisor (HR)</div></div></li>
        )}
        {p.created_by_name && (
          <li className="flex items-center gap-2.5"><Avatar name={p.created_by_name} /><div className="min-w-0"><div className="text-sm font-medium text-gray-900 truncate">{p.created_by_name}</div><div className="text-xs text-gray-500">Opened the ticket{p.source !== 'manual' ? ' · converted the client' : ''}</div></div></li>
        )}
        {d.members.map((m) => (
          <li key={String(m.id)} className="flex items-center gap-2.5">
            <Avatar name={m.name} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-gray-900 truncate">{m.name}</div>
              {can ? (
                <>
                  <label htmlFor={`mr-${m.id}`} className="sr-only">Role of {m.name}</label>
                  <select id={`mr-${m.id}`} value={m.member_role} onChange={(e) => changeRole(m.id, e.target.value)} className="mt-0.5 rounded border border-gray-200 bg-white px-1 py-0.5 text-xs text-gray-600">
                    {Object.entries(MEMBER_ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </>
              ) : <div className="text-xs text-gray-500">{MEMBER_ROLE_LABELS[m.member_role] || m.member_role}</div>}
            </div>
            {can && (
              <button onClick={() => remove(m.id, m.name)} className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500" aria-label={`Remove ${m.name}`}>
                <X className="h-4 w-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {d.members.length === 0 && <p className="mt-3 text-sm text-gray-500">{can ? 'No developers yet. Assign someone below.' : 'No developers assigned yet. HR will assign the team.'}</p>}

      {can && (
        <div className="mt-4 space-y-2 border-t border-gray-100 pt-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Assign someone</div>
          <label htmlFor="add-person" className="sr-only">Person</label>
          <select id="add-person" className={selectCls} value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Choose a developer…</option>
            {available.filter((u) => u.role === 'developer').length > 0 && (
              <optgroup label="Developers">
                {available.filter((u) => u.role === 'developer').map((u) => <option key={String(u.id)} value={String(u.id)}>{u.name} — {u.open_projects} open project{u.open_projects === 1 ? '' : 's'}</option>)}
              </optgroup>
            )}
            {available.filter((u) => u.role !== 'developer').length > 0 && (
              <optgroup label="HR">
                {available.filter((u) => u.role !== 'developer').map((u) => <option key={String(u.id)} value={String(u.id)}>{u.name} — {u.open_projects} open</option>)}
              </optgroup>
            )}
          </select>
          <div className="flex gap-2">
            <label htmlFor="add-role" className="sr-only">Role on the project</label>
            <select id="add-role" className={selectCls} value={memberRole} onChange={(e) => setMemberRole(e.target.value)}>
              {Object.entries(MEMBER_ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <Btn size="sm" onClick={add} disabled={!userId || adding} className="shrink-0"><UserPlus className="h-4 w-4" />Add</Btn>
          </div>
          {people && !people.some((u) => u.role === 'developer') && <p className="text-xs text-gray-500">No developer accounts yet — create them under HR → Developers.</p>}
        </div>
      )}
    </SectionCard>
  );
}

// ------------------------------------------------------------------ dates & recurring (HR)

export function DatesEditor({ d, onChange }: { d: ProjectDetail; onChange: () => void }) {
  const p = d.project;
  const can = d.permissions.edit_dates;
  const toast = useToast();
  const init = () => ({
    start_date: p.start_date || '', deadline: p.deadline || '', expected_delivery: p.expected_delivery || '',
    project_type: p.project_type, recurrence: p.recurrence || 'monthly', recurrence_end: p.recurrence_end || '',
  });
  const [f, setF] = useState(init);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Reset the form when the project changes elsewhere.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setF(init()), [p.start_date, p.deadline, p.expected_delivery, p.project_type, p.recurrence, p.recurrence_end]);

  const dirty = JSON.stringify(f) !== JSON.stringify(init());
  const save = async () => {
    if (f.start_date && f.deadline && f.deadline < f.start_date) return setErr('The deadline is before the start date');
    setSaving(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = { start_date: f.start_date, deadline: f.deadline, expected_delivery: f.expected_delivery, project_type: f.project_type };
      if (f.project_type === 'recurring') { body.recurrence = f.recurrence; body.recurrence_end = f.recurrence_end; }
      else { body.recurrence = null; body.recurrence_end = null; }
      await papi(`/api/projects/${p.id}`, { method: 'PATCH', body });
      toast('Dates saved');
      onChange();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!can) {
    return (
      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
        {[['Work start', p.start_date], ['Internal deadline', p.deadline], ['Delivery to client', p.expected_delivery]].map(([l, v]) => (
          <div key={l as string}><dt className="text-xs text-gray-500">{l}</dt><dd className="font-medium text-gray-900">{v ? fmtDay(v as string) : 'Not set'}</dd></div>
        ))}
        <div><dt className="text-xs text-gray-500">Type</dt><dd className="font-medium text-gray-900">{p.project_type === 'recurring' ? `Recurring · ${RECURRENCE_LABELS[p.recurrence || ''] || ''}` : 'One-time'}</dd></div>
        {p.project_type === 'recurring' && <div><dt className="text-xs text-gray-500">Repeats until</dt><dd className="font-medium text-gray-900">{p.recurrence_end ? fmtDay(p.recurrence_end) : 'Until closed'}</dd></div>}
        <p className="col-span-full text-xs text-gray-500">Only HR can change dates. Ask in the thread if something needs to move.</p>
      </dl>
    );
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Field label="Work start" htmlFor="d-start"><input id="d-start" type="date" className={inputCls} value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></Field>
        <Field label="Internal deadline" htmlFor="d-deadline" hint={f.project_type === 'recurring' ? 'Moves with each cycle.' : 'For the team.'}><input id="d-deadline" type="date" className={inputCls} value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} /></Field>
        <Field label="Expected delivery to client" htmlFor="d-delivery" hint="What the client was promised."><input id="d-delivery" type="date" className={inputCls} value={f.expected_delivery} onChange={(e) => setF({ ...f, expected_delivery: e.target.value })} /></Field>
      </div>
      {f.deadline && f.expected_delivery && f.expected_delivery < f.deadline && <p className="text-xs text-amber-700">The client delivery date is before the internal deadline — usually the deadline should come first, with a buffer.</p>}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Field label="Type" htmlFor="d-type">
          <select id="d-type" className={selectCls} value={f.project_type} onChange={(e) => setF({ ...f, project_type: e.target.value as 'one_time' | 'recurring' })}>
            <option value="one_time">One-time</option><option value="recurring">Recurring</option>
          </select>
        </Field>
        {f.project_type === 'recurring' && (
          <>
            <Field label="Repeats" htmlFor="d-rec">
              <select id="d-rec" className={selectCls} value={f.recurrence} onChange={(e) => setF({ ...f, recurrence: e.target.value })}>
                {Object.entries(RECURRENCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Repeat until" htmlFor="d-until" hint="Empty = until closed."><input id="d-until" type="date" className={inputCls} value={f.recurrence_end} onChange={(e) => setF({ ...f, recurrence_end: e.target.value })} /></Field>
          </>
        )}
      </div>
      {err && <p className="text-sm text-red-600" role="alert">{err}</p>}
      <div className="flex justify-end gap-2">
        {dirty && <Btn variant="ghost" size="sm" onClick={() => setF(init())}>Undo changes</Btn>}
        <Btn size="sm" onClick={save} disabled={!dirty || saving}><Save className="h-4 w-4" />{saving ? 'Saving…' : 'Save dates'}</Btn>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ details (agent who opened it / HR)

export function DetailsEditor({ d, onChange }: { d: ProjectDetail; onChange: () => void }) {
  const p = d.project;
  const can = d.permissions.edit_details;
  const toast = useToast();
  const init = () => ({
    title: p.title, client_name: p.client_name, client_company: p.client_company || '', client_email: p.client_email || '',
    client_phone: p.client_phone || '', client_timezone: p.client_timezone || 'America/New_York', service_type: p.service_type,
    priority: p.priority, deal_value: p.deal_value ? String(Number(p.deal_value)) : '', description: p.description || '',
  });
  const [f, setF] = useState(init);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!f.title.trim() || !f.client_name.trim()) return setErr('Title and client name are required');
    setSaving(true);
    setErr(null);
    try {
      await papi(`/api/projects/${p.id}`, { method: 'PATCH', body: { ...f, deal_value: f.deal_value ? Number(f.deal_value) : null } });
      toast('Details saved');
      setEditing(false);
      onChange();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div><dt className="text-xs text-gray-500">Service</dt><dd className="text-gray-900">{SERVICE_LABELS[p.service_type] || p.service_type}</dd></div>
          <div><dt className="text-xs text-gray-500">Priority</dt><dd className="text-gray-900">{PRIORITY_LABELS[p.priority] || p.priority}</dd></div>
          <div><dt className="text-xs text-gray-500">Deal value</dt><dd className="text-gray-900">{fmtMoney(p.deal_value)}</dd></div>
          <div><dt className="text-xs text-gray-500">Source</dt><dd className="text-gray-900">{p.source === 'lead' ? 'Pipeline lead' : p.source === 'sale' ? 'Logged sale' : 'Entered manually'}</dd></div>
          <div><dt className="text-xs text-gray-500">Opened</dt><dd className="text-gray-900">{fmtDay(p.created_at)}{p.created_by_name ? ` by ${p.created_by_name}` : ''}</dd></div>
          <div><dt className="text-xs text-gray-500">Client time zone</dt><dd className="text-gray-900">{tzLabel(p.client_timezone)}</dd></div>
          <div className="sm:col-span-2"><dt className="text-xs text-gray-500">Original brief</dt><dd className="text-gray-900 whitespace-pre-wrap break-words">{p.description || <span className="text-gray-400">—</span>}</dd></div>
        </dl>
        {can && <div className="mt-4 flex justify-end"><Btn size="sm" variant="secondary" onClick={() => { setF(init()); setErr(null); setEditing(true); }}>Edit details</Btn></div>}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Field label="Title" htmlFor="e-title" className="sm:col-span-2"><input id="e-title" className={inputCls} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={200} /></Field>
      <Field label="Client name" htmlFor="e-cn"><input id="e-cn" className={inputCls} value={f.client_name} onChange={(e) => setF({ ...f, client_name: e.target.value })} /></Field>
      <Field label="Company" htmlFor="e-cc"><input id="e-cc" className={inputCls} value={f.client_company} onChange={(e) => setF({ ...f, client_company: e.target.value })} /></Field>
      <Field label="Email" htmlFor="e-ce"><input id="e-ce" type="email" className={inputCls} value={f.client_email} onChange={(e) => setF({ ...f, client_email: e.target.value })} /></Field>
      <Field label="Phone" htmlFor="e-cp"><input id="e-cp" type="tel" className={inputCls} value={f.client_phone} onChange={(e) => setF({ ...f, client_phone: e.target.value })} /></Field>
      <Field label="Client time zone" htmlFor="e-tz">
        <select id="e-tz" className={selectCls} value={f.client_timezone} onChange={(e) => setF({ ...f, client_timezone: e.target.value })}>
          {TIMEZONES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </Field>
      <Field label="Service" htmlFor="e-svc">
        <select id="e-svc" className={selectCls} value={f.service_type} onChange={(e) => setF({ ...f, service_type: e.target.value })}>
          {Object.entries(SERVICE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <Field label="Priority" htmlFor="e-pri">
        <select id="e-pri" className={selectCls} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
          {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <Field label="Deal value (USD)" htmlFor="e-dv"><input id="e-dv" type="number" min="0" step="0.01" className={inputCls} value={f.deal_value} onChange={(e) => setF({ ...f, deal_value: e.target.value })} /></Field>
      <Field label="Brief" htmlFor="e-desc" className="sm:col-span-2" hint="Editing the brief doesn’t change the first thread message."><textarea id="e-desc" rows={4} className={inputCls} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      {err && <p className="sm:col-span-2 text-sm text-red-600" role="alert">{err}</p>}
      <div className="sm:col-span-2 flex justify-end gap-2">
        <Btn size="sm" variant="secondary" onClick={() => setEditing(false)}>Cancel</Btn>
        <Btn size="sm" onClick={save} disabled={saving}><Save className="h-4 w-4" />{saving ? 'Saving…' : 'Save details'}</Btn>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ recurring cycles

export function Cycles({ d, onChange }: { d: ProjectDetail; onChange: () => void }) {
  const p = d.project;
  const can = d.permissions.deliver_cycle && !['closed', 'cancelled'].includes(p.status);
  const confirm = useConfirm();
  const toast = useToast();
  const [deliverOpen, setDeliverOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [completeMs, setCompleteMs] = useState(true);
  const [busy, setBusy] = useState(false);
  const current = d.cycles.find((c) => c.status === 'open');
  const t = today();

  const act = async (action: 'deliver' | 'skip' | 'open_next', extra: Record<string, unknown> = {}) => {
    setBusy(true);
    try {
      const r = await papi<{ next_cycle_id?: number | null }>(`/api/projects/${p.id}/cycles`, { body: { action, cycle_id: current?.id, ...extra } });
      toast(action === 'deliver' ? `Cycle ${current?.cycle_no} delivered${r.next_cycle_id ? ' — next cycle opened' : ''}` : action === 'skip' ? `Cycle ${current?.cycle_no} skipped` : 'Next cycle opened');
      setDeliverOpen(false);
      onChange();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const skip = async () => {
    if (!current) return;
    if (await confirm({ title: `Skip cycle ${current.cycle_no}?`, body: 'Use this when nothing is due this period (e.g. the client paused). The next cycle opens automatically.', confirmLabel: 'Skip cycle' })) act('skip');
  };
  const msInCurrent = current ? d.milestones.filter((m) => m.cycle_id === current.id && m.status !== 'done').length : 0;

  return (
    <div>
      {current ? (
        <div className={cn('mb-4 rounded-xl border px-4 py-3', current.deadline < t ? 'border-red-200 bg-red-50' : 'border-violet-200 bg-violet-50')}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-900"><Repeat className="h-4 w-4 text-violet-600" />Current: cycle {current.cycle_no}</div>
              <div className="text-sm text-gray-700">{fmtDay(current.period_start)} – {fmtDay(current.period_end)} · deadline <strong className={current.deadline < t ? 'text-red-700' : ''}>{fmtDay(current.deadline)}</strong></div>
            </div>
            {can && (
              <div className="flex flex-wrap gap-2">
                <Btn size="sm" variant="success" onClick={() => { setNotes(''); setCompleteMs(true); setDeliverOpen(true); }} disabled={busy}><CheckCircle2 className="h-4 w-4" />Mark delivered</Btn>
                <Btn size="sm" variant="secondary" onClick={skip} disabled={busy}><SkipForward className="h-4 w-4" />Skip</Btn>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
          <span>No open cycle{p.recurrence_end && p.recurrence_end < t ? ' — the recurring end date has passed.' : '.'}</span>
          {can && <Btn size="sm" variant="secondary" onClick={() => act('open_next')} disabled={busy}>Open next cycle</Btn>}
        </div>
      )}
      {d.cycles.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr><th className="px-3 py-2 font-medium">Cycle</th><th className="px-3 py-2 font-medium">Period</th><th className="px-3 py-2 font-medium">Deadline</th><th className="px-3 py-2 font-medium">Status</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {[...d.cycles].reverse().map((c) => (
                <tr key={c.id}>
                  <td className="px-3 py-2 font-medium text-gray-900">#{c.cycle_no}</td>
                  <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{fmtDay(c.period_start, { noYear: true })} – {fmtDay(c.period_end)}</td>
                  <td className={cn('px-3 py-2 whitespace-nowrap', c.status === 'open' && c.deadline < t ? 'text-red-700 font-semibold' : 'text-gray-700')}>{fmtDay(c.deadline)}</td>
                  <td className="px-3 py-2">
                    {c.status === 'delivered' ? <Pill tone="green">Delivered{c.delivered_at ? ` ${fmtDay(c.delivered_at, { noYear: true })}` : ''}</Pill> : c.status === 'skipped' ? <Pill tone="gray">Skipped</Pill> : <Pill tone="violet">Open</Pill>}
                    {c.notes && <div className="mt-0.5 text-xs text-gray-500 break-words">{c.notes}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={deliverOpen} onClose={() => setDeliverOpen(false)} title={`Mark cycle ${current?.cycle_no ?? ''} delivered`} size="sm"
        footer={<><Btn variant="secondary" onClick={() => setDeliverOpen(false)}>Cancel</Btn><Btn variant="success" onClick={() => act('deliver', { notes: notes.trim() || undefined, complete_milestones: completeMs })} disabled={busy}>{busy ? 'Saving…' : 'Mark delivered'}</Btn></>}>
        <div className="space-y-3 text-sm text-gray-600">
          <p>The next cycle opens automatically{p.recurrence_end ? ` (until ${fmtDay(p.recurrence_end)})` : ''}, with a new deadline.</p>
          {msInCurrent > 0 && (
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={completeMs} onChange={(e) => setCompleteMs(e.target.checked)} className="mt-0.5" />
              <span>Also mark this cycle’s {msInCurrent} open milestone{msInCurrent === 1 ? '' : 's'} as done</span>
            </label>
          )}
          <Field label="What was delivered? (optional)" htmlFor="cy-notes">
            <textarea id="cy-notes" rows={3} className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. 12 posts published, monthly report sent" />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
