'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { BellRing, Check, Clock, X, Repeat, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Btn, Pill, Empty, Spinner, inputCls } from '@/components/training/ui';
import { Modal, Field, SectionCard, selectCls, useConfirm, useToast } from '@/components/projects/ui';
import { papi, usePapi } from '@/components/projects/lib';
import { AUTO_KIND_LABELS, dueBucket, REPEAT_LABELS, REPEAT_RULES, RepeatRule, ReminderEntity } from '@/lib/reminders/rules';

export interface Reminder {
  id: number; entity_type: ReminderEntity; entity_id: string | null; project_id: number | null; title: string; note: string | null;
  due_at: string; effective_due: string; repeat_rule: RepeatRule; assigned_to: string; created_by: string | null;
  status: 'open' | 'done' | 'cancelled'; snoozed_until: string | null; fired: boolean; auto_kind: string | null; email: boolean;
  assigned_to_name: string | null; created_by_name: string | null; ticket_no: string | null; ticket_key: string | null;
}

/** "Wed, Oct 29, 10:00 AM PKT" */
const fmtPkt = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { timeZone: 'Asia/Karachi', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' PKT';

/** Where a reminder's item lives in the app. */
export function reminderHref(r: Reminder): string {
  switch (r.entity_type) {
    case 'ticket': return r.ticket_key && r.project_id ? `/projects/${r.project_id}/tickets/${r.ticket_key}` : `/projects/${r.project_id}`;
    case 'brief_entry': return `/projects/${r.project_id}?tab=brief#brief-${r.entity_id}`;
    case 'meeting': return `/projects/${r.project_id}?tab=meetings`;
    case 'message': return `/projects/${r.project_id}?tab=thread#msg-${r.entity_id}`;
    case 'project': return `/projects/${r.project_id}`;
    default: return '/my-tasks#reminders';
  }
}

// ------------------------------------------------------------------ actions: done / snooze

export function useReminderActions(onChange: () => void) {
  const toast = useToast();
  return {
    async done(id: number | string) {
      try { await papi(`/api/reminders/${id}/done`, { method: 'POST' }); toast('Done'); onChange(); } catch (e) { toast((e as Error).message, 'error'); }
    },
    async snooze(id: number | string, preset: '1h' | 'tomorrow' | 'pick', until?: string) {
      try {
        await papi(`/api/reminders/${id}/snooze`, { method: 'POST', body: { preset, until } });
        toast(preset === '1h' ? 'Snoozed for an hour' : preset === 'tomorrow' ? 'Snoozed until tomorrow 10:00' : 'Snoozed');
        onChange();
      } catch (e) { toast((e as Error).message, 'error'); }
    },
    async cancel(id: number | string) {
      try { await papi(`/api/reminders/${id}`, { method: 'DELETE' }); toast('Reminder cancelled'); onChange(); } catch (e) { toast((e as Error).message, 'error'); }
    },
  };
}

/** Done + Snooze (1h / tomorrow 10:00 PKT / pick) for one reminder — used in the inbox, bell and lists. */
export function ReminderButtons({ id, onChange, compact }: { id: number | string; onChange: () => void; compact?: boolean }) {
  const a = useReminderActions(onChange);
  const [menu, setMenu] = useState(false);
  const [pick, setPick] = useState('');
  const [picking, setPicking] = useState(false);
  return (
    <span className="relative inline-flex items-center gap-1">
      <button type="button" onClick={(e) => { e.stopPropagation(); a.done(id); }} title="Done" aria-label="Mark reminder done"
        className={cn('inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50', compact && 'px-1.5')}>
        <Check className="h-3.5 w-3.5" />{!compact && 'Done'}
      </button>
      <button type="button" onClick={(e) => { e.stopPropagation(); setMenu((m) => !m); }} title="Snooze" aria-label="Snooze reminder" aria-expanded={menu}
        className={cn('inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100', compact && 'px-1.5')}>
        <Clock className="h-3.5 w-3.5" />{!compact && 'Snooze'}
      </button>
      {menu && (
        <span className="absolute right-0 top-full z-30 mt-1 w-48 rounded-xl border border-gray-200 bg-white p-1 shadow-lg" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="block w-full rounded-lg px-3 py-1.5 text-left text-sm hover:bg-gray-50" onClick={() => { setMenu(false); a.snooze(id, '1h'); }}>In 1 hour</button>
          <button type="button" className="block w-full rounded-lg px-3 py-1.5 text-left text-sm hover:bg-gray-50" onClick={() => { setMenu(false); a.snooze(id, 'tomorrow'); }}>Tomorrow 10:00 (PKT)</button>
          <button type="button" className="block w-full rounded-lg px-3 py-1.5 text-left text-sm hover:bg-gray-50" onClick={() => { setMenu(false); setPick(''); setPicking(true); }}>Pick a time…</button>
        </span>
      )}
      <Modal open={picking} onClose={() => setPicking(false)} title="Snooze until…" size="sm"
        footer={<>
          <Btn variant="secondary" onClick={() => setPicking(false)}>Cancel</Btn>
          <Btn disabled={!pick} onClick={() => { setPicking(false); a.snooze(id, 'pick', new Date(pick).toISOString()); }}>Snooze</Btn>
        </>}>
        <Field label="Date and time (your computer’s time)" htmlFor={`snooze-${id}`}>
          <input id={`snooze-${id}`} type="datetime-local" className={inputCls} value={pick} onChange={(e) => setPick(e.target.value)} />
        </Field>
      </Modal>
    </span>
  );
}

// ------------------------------------------------------------------ "Remind me" button + modal

interface Assignees { can_assign_others: boolean; needs_admin_mode?: boolean; users: { id: string; name: string; role: string }[] }

export function RemindMeButton({ entityType, entityId, defaultTitle, className, label = 'Remind me', variant = 'button' }: {
  entityType: ReminderEntity; entityId?: number | string | null; defaultTitle: string; className?: string; label?: string;
  variant?: 'button' | 'menuitem' | 'icon';
}) {
  const [open, setOpen] = useState(false);
  const trigger = variant === 'menuitem' ? (
    <button type="button" onClick={() => setOpen(true)} className={cn('flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50', className)}>
      <BellRing className="h-4 w-4" />{label}
    </button>
  ) : variant === 'icon' ? (
    <button type="button" onClick={() => setOpen(true)} title={label} aria-label={label} className={cn('rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700', className)}>
      <BellRing className="h-4 w-4" />
    </button>
  ) : (
    <Btn size="sm" variant="secondary" className={className} onClick={() => setOpen(true)}><BellRing className="h-4 w-4" />{label}</Btn>
  );
  return (
    <>
      {trigger}
      {open && <ReminderModal entityType={entityType} entityId={entityId ?? null} defaultTitle={defaultTitle} onClose={() => setOpen(false)} />}
    </>
  );
}

export function ReminderModal({ entityType, entityId, defaultTitle, onClose, onSaved }: {
  entityType: ReminderEntity; entityId: number | string | null; defaultTitle: string; onClose: () => void; onSaved?: () => void;
}) {
  const toast = useToast();
  const { data: who } = usePapi<Assignees>(`/api/reminders/assignees?entity_type=${entityType}${entityId != null ? `&entity_id=${entityId}` : ''}`);
  const [title, setTitle] = useState(defaultTitle.slice(0, 200));
  const [note, setNote] = useState('');
  const [preset, setPreset] = useState<'1h' | 'tomorrow' | 'monday' | 'pick'>('tomorrow');
  const [pick, setPick] = useState('');
  const [repeat, setRepeat] = useState<RepeatRule>('none');
  const [assignee, setAssignee] = useState('');
  const [email, setEmail] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setErr(null); setSaving(true);
    try {
      await papi('/api/reminders', {
        method: 'POST',
        body: {
          entity_type: entityType, entity_id: entityId, title, note, preset,
          until: preset === 'pick' && pick ? new Date(pick).toISOString() : undefined,
          repeat_rule: repeat, assigned_to: assignee || undefined, email,
        },
      });
      toast('Reminder set');
      onSaved?.();
      onClose();
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  }

  const presets: { id: typeof preset; label: string }[] = [
    { id: '1h', label: 'In 1 hour' }, { id: 'tomorrow', label: 'Tomorrow 10:00' }, { id: 'monday', label: 'Next Monday 10:00' }, { id: 'pick', label: 'Pick…' },
  ];
  return (
    <Modal open onClose={onClose} title="Remind me" size="sm"
      footer={<>
        <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
        <Btn onClick={save} disabled={saving || !title.trim() || (preset === 'pick' && !pick)}>{saving ? 'Saving…' : 'Set reminder'}</Btn>
      </>}>
      <div className="space-y-3">
        <Field label="What" htmlFor="rm-title"><input id="rm-title" className={inputCls} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} /></Field>
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-gray-700">When <span className="font-normal text-gray-400">(times in PKT)</span></legend>
          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <button key={p.id} type="button" aria-pressed={preset === p.id} onClick={() => setPreset(p.id)}
                className={cn('rounded-full border px-3 py-1 text-sm', preset === p.id ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50')}>
                {p.label}
              </button>
            ))}
          </div>
          {preset === 'pick' && <input type="datetime-local" aria-label="Pick a date and time" className={cn(inputCls, 'mt-2')} value={pick} onChange={(e) => setPick(e.target.value)} />}
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Repeat" htmlFor="rm-repeat">
            <select id="rm-repeat" className={selectCls} value={repeat} onChange={(e) => setRepeat(e.target.value as RepeatRule)}>
              {REPEAT_RULES.map((r) => <option key={r} value={r}>{REPEAT_LABELS[r]}</option>)}
            </select>
          </Field>
          {who?.can_assign_others ? (
            <Field label="For" htmlFor="rm-who" hint={who.needs_admin_mode ? 'Someone else needs Admin mode' : undefined}>
              <select id="rm-who" className={selectCls} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                {who.users.map((u, i) => <option key={u.id} value={i === 0 ? '' : u.id}>{u.name}</option>)}
              </select>
            </Field>
          ) : <div />}
        </div>
        <Field label="Note (optional)" htmlFor="rm-note"><textarea id="rm-note" rows={2} className={inputCls} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
          Also send an email
        </label>
        {err && <p className="text-sm text-red-600">{err}</p>}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ "My reminders" panel

const BUCKETS = [
  { id: 'overdue', label: 'Overdue', tone: 'text-red-600' },
  { id: 'today', label: 'Today', tone: 'text-amber-700' },
  { id: 'upcoming', label: 'Upcoming', tone: 'text-gray-600' },
] as const;

export function MyReminders({ className, compact, id = 'reminders' }: { className?: string; compact?: boolean; id?: string }) {
  const { data, isLoading, mutate } = usePapi<Reminder[]>('/api/reminders?scope=mine', { refreshInterval: 30_000 });
  const { data: forOthers, mutate: mutateOthers } = usePapi<Reminder[]>(compact ? null : '/api/reminders?scope=created', { refreshInterval: 60_000 });
  const [showOthers, setShowOthers] = useState(false);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(t); }, []);
  const refresh = () => { mutate(); mutateOthers(); };
  const { cancel } = useReminderActions(refresh);
  const confirm = useConfirm();

  const grouped = useMemo(() => {
    const g: Record<string, Reminder[]> = { overdue: [], today: [], upcoming: [] };
    for (const r of data || []) g[dueBucket(new Date(r.effective_due), now)].push(r);
    return g;
  }, [data, now]);

  return (
    <SectionCard id={id} className={className} title={<span className="inline-flex items-center gap-1.5"><BellRing className="h-4 w-4" />My reminders</span>}
      action={<RemindMeButton entityType="none" defaultTitle="" label="New reminder" />}>
      {isLoading && !data ? <Spinner label="Loading reminders…" /> : !data?.length ? (
        <Empty icon={<BellRing className="h-6 w-6" />} title="No reminders" body="Use “Remind me” on a ticket, brief update, message or meeting." />
      ) : (
        <div className="space-y-4">
          {BUCKETS.map((b) => grouped[b.id].length > 0 && (
            <div key={b.id}>
              <h3 className={cn('mb-1.5 text-xs font-semibold uppercase tracking-wide', b.tone)}>{b.label} · {grouped[b.id].length}</h3>
              <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
                {grouped[b.id].map((r) => <ReminderRowView key={r.id} r={r} onChange={refresh} compact={compact} />)}
              </ul>
            </div>
          ))}
        </div>
      )}
      {!compact && !!forOthers?.length && (
        <div className="mt-4">
          <button type="button" onClick={() => setShowOthers((s) => !s)} className="text-xs font-medium text-primary-600 hover:underline">
            {showOthers ? 'Hide' : 'Show'} reminders you set for others ({forOthers.length})
          </button>
          {showOthers && (
            <ul className="mt-2 divide-y divide-gray-100 rounded-xl border border-gray-200">
              {forOthers.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0">
                    <Link href={reminderHref(r)} className="font-medium text-gray-900 hover:underline">{r.title}</Link>
                    <span className="block text-xs text-gray-500">For {r.assigned_to_name} · {fmtPkt(r.effective_due)}</span>
                  </span>
                  <button type="button" aria-label={`Cancel reminder ${r.title}`} title="Cancel" className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-red-600"
                    onClick={async () => { if (await confirm({ title: 'Cancel this reminder?', confirmLabel: 'Cancel reminder', danger: true })) cancel(r.id); }}>
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </SectionCard>
  );
}

function ReminderRowView({ r, onChange, compact }: { r: Reminder; onChange: () => void; compact?: boolean }) {
  const { cancel } = useReminderActions(onChange);
  return (
    <li id={`reminder-${r.id}`} className="flex flex-col gap-1.5 px-3 py-2 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <Link href={reminderHref(r)} className="block truncate text-sm font-medium text-gray-900 hover:underline">{r.title}</Link>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500">
          <span>{fmtPkt(r.effective_due)}</span>
          {r.snoozed_until && <span className="text-gray-400">· snoozed</span>}
          {r.repeat_rule !== 'none' && <span className="inline-flex items-center gap-0.5"><Repeat className="h-3 w-3" />{REPEAT_LABELS[r.repeat_rule]}</span>}
          {(r.ticket_key || r.ticket_no) && <span>· {r.ticket_key || r.ticket_no}</span>}
          {r.created_by && r.created_by !== r.assigned_to && r.created_by_name && <span>· from {r.created_by_name}</span>}
          {r.auto_kind && <Pill tone="violet"><Zap className="h-3 w-3" />{AUTO_KIND_LABELS[r.auto_kind] || 'Automatic'}</Pill>}
        </p>
        {!compact && r.note && <p className="mt-0.5 line-clamp-2 text-xs text-gray-600">{r.note}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <ReminderButtons id={r.id} onChange={onChange} compact={compact} />
        {!compact && (
          <button type="button" aria-label={`Cancel reminder ${r.title}`} title="Cancel reminder" onClick={() => cancel(r.id)}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-red-600"><X className="h-4 w-4" /></button>
        )}
      </div>
    </li>
  );
}

// ------------------------------------------------------------------ project settings (automatic reminders)

interface Settings {
  client_content_enabled: boolean; client_content_days: number; clarification_enabled: boolean; clarification_hours: number;
  meeting_notes_enabled: boolean; meeting_notes_hours: number; cycle_renewal_enabled: boolean; cycle_renewal_days: number; can_edit: boolean;
}

export function ReminderSettingsCard({ projectId }: { projectId: number }) {
  const { data, mutate } = usePapi<Settings>(`/api/projects/${projectId}/reminder-settings`);
  const toast = useToast();
  if (!data) return null;
  const rows: { on: keyof Settings; n: keyof Settings; label: string; unit: string }[] = [
    { on: 'client_content_enabled', n: 'client_content_days', label: 'Client content still pending (Requirement tagged “waiting on client”, no follow-up)', unit: 'days' },
    { on: 'clarification_enabled', n: 'clarification_hours', label: 'A developer’s clarification question unanswered', unit: 'hours' },
    { on: 'meeting_notes_enabled', n: 'meeting_notes_hours', label: 'Meeting ended without notes', unit: 'hours after' },
    { on: 'cycle_renewal_enabled', n: 'cycle_renewal_days', label: 'Recurring cycle renews', unit: 'days before' },
  ];
  async function save(patch: Partial<Settings>) {
    try { await mutate(await papi(`/api/projects/${projectId}/reminder-settings`, { method: 'PUT', body: patch }), false); toast('Saved'); }
    catch (e) { toast((e as Error).message, 'error'); }
  }
  return (
    <SectionCard title="Automatic reminders">
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.on} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <label className="flex min-w-0 flex-1 items-center gap-2 text-gray-700">
              <input type="checkbox" className="h-4 w-4 rounded border-gray-300" checked={!!data[r.on]} disabled={!data.can_edit}
                onChange={(e) => save({ [r.on]: e.target.checked } as Partial<Settings>)} />
              {r.label}
            </label>
            <span className="flex items-center gap-1.5 text-xs text-gray-500">
              <input type="number" min={1} aria-label={`${r.label}: ${r.unit}`} className={cn(inputCls, 'w-16 py-1')} defaultValue={Number(data[r.n])}
                disabled={!data.can_edit || !data[r.on]}
                onBlur={(e) => { const n = Number(e.target.value); if (n && n !== Number(data[r.n])) save({ [r.n]: n } as Partial<Settings>); }} />
              {r.unit}
            </span>
          </li>
        ))}
      </ul>
      {!data.can_edit && <p className="mt-3 text-xs text-gray-500">Only HR, the lead developer or the client’s agent can change these.</p>}
    </SectionCard>
  );
}
