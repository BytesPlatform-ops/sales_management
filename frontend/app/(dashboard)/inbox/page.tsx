'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Inbox, Check, CheckCheck, Clock, Settings, AtSign, Mail, BellOff, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Btn, Empty, ErrorNote, Spinner, PageHeader, inputCls } from '@/components/training/ui';
import { Modal, Field, ProjectsPage, ProjectsProvider, selectCls, useToast } from '@/components/projects/ui';
import { papi, usePapi, relTime } from '@/components/projects/lib';
import { MyReminders, ReminderButtons } from '@/components/reminders/Reminders';

type Tab = 'unread' | 'all' | 'mentions' | 'prefs';

interface Item {
  id: string; type: string; title: string | null; body: string; link: string | null; project_id: number | null;
  project_ticket_no: string | null; read_at: string | null; snoozed_until: string | null; created_at: string; actor_name: string | null;
  entity_type?: string | null; entity_id?: string | null;
}
interface InboxData { items: Item[]; unread_count: number; snoozed_count: number }
interface Prefs {
  types: { type: string; label: string; group: string; channel: 'in_app' | 'email' | 'off' }[];
  digest_enabled: boolean; email_available: boolean; has_email_address: boolean;
}

/** 09:00 tomorrow in Pakistan (UTC+5), as an ISO string. */
function tomorrowNinePkt(): string {
  const pktNow = new Date(Date.now() + 5 * 3600_000);
  const d = new Date(Date.UTC(pktNow.getUTCFullYear(), pktNow.getUTCMonth(), pktNow.getUTCDate() + 1, 4, 0, 0));
  return d.toISOString();
}

export default function InboxPage() {
  return <ProjectsProvider><InboxInner /></ProjectsProvider>;
}

function InboxInner() {
  const [tab, setTab] = useState<Tab>('unread');
  const [project, setProject] = useState('');
  const key = tab === 'prefs' ? null : `/api/inbox?tab=${tab}&limit=200${project ? `&project_id=${project}` : ''}`;
  const { data, error, isLoading, mutate } = usePapi<InboxData>(key, { refreshInterval: 30_000 });
  const { data: all } = usePapi<InboxData>('/api/inbox?tab=all&limit=200', { refreshInterval: 60_000 });

  const projects = useMemo(() => {
    const m = new Map<number, string>();
    for (const i of all?.items || []) if (i.project_id && i.project_ticket_no) m.set(i.project_id, i.project_ticket_no);
    return Array.from(m, ([id, no]) => ({ id, no })).sort((a, b) => a.no.localeCompare(b.no));
  }, [all]);

  const TABS: { id: Tab; label: string; icon: typeof Inbox; badge?: number }[] = [
    { id: 'unread', label: 'Unread', icon: Inbox, badge: data?.unread_count ?? all?.unread_count },
    { id: 'all', label: 'All', icon: CheckCheck },
    { id: 'mentions', label: 'Mentions', icon: AtSign },
    { id: 'prefs', label: 'Preferences', icon: Settings },
  ];

  return (
    <ProjectsPage className="max-w-6xl">
      <PageHeader title="Inbox" subtitle="Assignments, mentions, status changes and approvals in one place." />
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Inbox views" className="inline-flex gap-1 overflow-x-auto rounded-xl bg-gray-100 p-1">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
              className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                tab === t.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900')}>
              <t.icon className="h-4 w-4" />{t.label}
              {!!t.badge && <span className="rounded-full bg-primary-600 px-1.5 text-[11px] font-semibold text-white">{t.badge}</span>}
            </button>
          ))}
        </div>
        {tab !== 'prefs' && projects.length > 0 && (
          <select className={cn(selectCls, 'w-auto py-1.5')} value={project} onChange={(e) => setProject(e.target.value)} aria-label="Filter by project">
            <option value="">All projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.no}</option>)}
          </select>
        )}
      </div>

      {tab === 'prefs' ? <Preferences /> : (
        <>
          {error && <ErrorNote error={error} />}
          {isLoading && !data ? <Spinner label="Loading…" /> : (
            <List items={data?.items || []} tab={tab} onChange={() => mutate()} snoozed={data?.snoozed_count || 0} />
          )}
        </>
      )}
      </div>
      <MyReminders compact className="lg:sticky lg:top-4" />
      </div>
    </ProjectsPage>
  );
}

function List({ items, tab, onChange, snoozed }: { items: Item[]; tab: Tab; onChange: () => void; snoozed: number }) {
  const router = useRouter();
  const toast = useToast();
  const [snoozing, setSnoozing] = useState<Item | null>(null);
  const [pick, setPick] = useState('');
  const unread = items.filter((i) => !i.read_at);

  async function read(ids: string[] | null, asUnread = false) {
    try {
      await papi('/api/inbox/read', { method: 'POST', body: ids ? { ids, unread: asUnread || undefined } : {} });
      onChange();
    } catch (e) { toast((e as Error).message, 'error'); }
  }
  async function snooze(item: Item, until: string) {
    try {
      await papi('/api/inbox/snooze', { method: 'POST', body: { id: item.id, until } });
      setSnoozing(null);
      onChange();
      toast('Snoozed');
    } catch (e) { toast((e as Error).message, 'error'); }
  }
  function open(i: Item) {
    if (!i.read_at) read([i.id]);
    if (i.link) router.push(i.link);
  }

  if (!items.length) {
    return <div className="rounded-2xl border border-gray-200 bg-white"><Empty icon={<Inbox className="h-6 w-6" />}
      title={tab === 'unread' ? 'You’re all caught up' : tab === 'mentions' ? 'No mentions yet' : 'Nothing here yet'}
      body={snoozed ? `${snoozed} snoozed notification${snoozed === 1 ? '' : 's'} will come back later.` : undefined} /></div>;
  }

  return (
    <>
      {unread.length > 0 && (
        <div className="mb-2 flex justify-end">
          <Btn size="sm" variant="ghost" onClick={() => read(null)}><CheckCheck className="h-4 w-4" />Mark all read</Btn>
        </div>
      )}
      <ul className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white">
        {items.map((i) => (
          <li key={i.id} className={cn('group flex gap-3 px-4 py-3', !i.read_at && 'bg-primary-50/40')}>
            <span className={cn('mt-2 h-2 w-2 shrink-0 rounded-full', i.read_at ? 'bg-transparent' : 'bg-primary-500')} aria-hidden />
            <button type="button" onClick={() => open(i)} className="min-w-0 flex-1 text-left focus:outline-none focus-visible:underline">
              {i.title && <span className="block text-xs font-semibold uppercase tracking-wide text-gray-500">{i.title}</span>}
              <span className="block break-words text-sm text-gray-900">{i.body}</span>
              <span className="mt-0.5 block text-xs text-gray-500">
                {i.project_ticket_no ? `${i.project_ticket_no} · ` : ''}{relTime(i.created_at)}
              </span>
            </button>
            <div className="flex shrink-0 items-start gap-1">
              {i.type === 'reminder' && i.entity_type === 'reminder' && i.entity_id && <ReminderButtons id={i.entity_id} onChange={onChange} compact />}
              {i.read_at ? (
                <button type="button" title="Mark unread" aria-label="Mark unread" onClick={() => read([i.id], true)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><RotateCcw className="h-4 w-4" /></button>
              ) : (
                <button type="button" title="Mark read" aria-label="Mark read" onClick={() => read([i.id])} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><Check className="h-4 w-4" /></button>
              )}
              {i.id.startsWith('n') && (
                <button type="button" title="Snooze" aria-label="Snooze" onClick={() => { setSnoozing(i); setPick(''); }} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><Clock className="h-4 w-4" /></button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <Modal open={!!snoozing} onClose={() => setSnoozing(null)} title="Snooze until…" size="sm"
        footer={<>
          <Btn variant="secondary" onClick={() => setSnoozing(null)}>Cancel</Btn>
          <Btn disabled={!pick} onClick={() => snooze(snoozing!, new Date(pick).toISOString())}>Snooze</Btn>
        </>}>
        <div className="space-y-2">
          <Btn variant="secondary" className="w-full justify-start" onClick={() => snooze(snoozing!, new Date(Date.now() + 3600_000).toISOString())}>In 1 hour</Btn>
          <Btn variant="secondary" className="w-full justify-start" onClick={() => snooze(snoozing!, tomorrowNinePkt())}>Tomorrow 9:00 AM (PKT)</Btn>
          <Field label="Pick a time" htmlFor="snooze-at">
            <input id="snooze-at" type="datetime-local" className={inputCls} value={pick} onChange={(e) => setPick(e.target.value)} />
          </Field>
        </div>
      </Modal>
    </>
  );
}

function Preferences() {
  const toast = useToast();
  const { data, error, mutate } = usePapi<Prefs>('/api/inbox/prefs');
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Spinner label="Loading…" />;

  async function save(body: Record<string, unknown>) {
    try { await papi('/api/inbox/prefs', { method: 'PUT', body }); mutate(); toast('Saved'); }
    catch (e) { toast((e as Error).message, 'error'); }
  }
  const groups = Array.from(new Set(data.types.map((t) => t.group)));

  return (
    <div className="space-y-4">
      {!data.email_available && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {data.has_email_address ? 'Email isn’t set up on the server yet, so email choices only take effect once it is.' : 'Your account has no email address, so email choices won’t send anything. Ask HR to add one.'}
        </p>
      )}
      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-1 h-4 w-4 rounded border-gray-300" checked={data.digest_enabled}
            onChange={(e) => save({ digest_enabled: e.target.checked })} />
          <span>
            <span className="flex items-center gap-1.5 text-sm font-semibold text-gray-900"><Mail className="h-4 w-4" />Daily email digest</span>
            <span className="text-sm text-gray-600">Every morning at 9:00 (PKT), an email listing your unread notifications.</span>
          </span>
        </label>
      </section>
      {groups.map((g) => (
        <section key={g} className="rounded-2xl border border-gray-200 bg-white shadow-sm">
          <h2 className="border-b border-gray-100 px-4 py-3 text-sm font-semibold uppercase tracking-wide text-gray-500">{g}</h2>
          <ul className="divide-y divide-gray-50">
            {data.types.filter((t) => t.group === g).map((t) => (
              <li key={t.type} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="text-sm text-gray-800">{t.label}</span>
                <select className={cn(selectCls, 'w-auto py-1')} value={t.channel} aria-label={t.label}
                  onChange={(e) => save({ prefs: { [t.type]: e.target.value } })}>
                  <option value="in_app">In app</option>
                  <option value="email">In app + email</option>
                  <option value="off">Off</option>
                </select>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="flex items-center gap-1.5 text-xs text-gray-500"><BellOff className="h-3.5 w-3.5" />“Off” stops that notification entirely. Training notifications always show.</p>
    </div>
  );
}
