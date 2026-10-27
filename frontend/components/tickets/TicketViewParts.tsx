'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Inbox, CheckCircle2, XCircle, HelpCircle, GitMerge, AlarmClock, Trash2, Plus, Link2, Pencil, Paperclip, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Btn, Pill, inputCls } from '@/components/training/ui';
import { Markdown } from '@/components/training/markdown';
import { Modal, Field, SectionCard, RoleBadge, Avatar, selectCls, useConfirm, useToast } from '@/components/projects/ui';
import { papi, usePapi, relTime, fmtExact, fmtDay, sameId } from '@/components/projects/lib';
import {
  TicketDetail, Comment, MediaFile, Epic, ChecklistItem, Relation, TICKET_KEY_RE, TICKET_STATUS_LABELS, TICKET_PRIORITY_LABELS,
  PRIORITIES, ticketHref,
} from './lib';
import { TicketStatusPill, TypeIcon, SlaTimer, Assignees } from './bits';
import { FileTile, Uploader } from './Attachments';
import { MarkdownEditor } from './MarkdownEditor';

// ------------------------------------------------------------------ helpers

/** Turn bare ticket keys into links to /tickets/KEY (leaves existing links and code alone). */
export function linkTicketKeys(src: string): string {
  return src
    .split(/(```[\s\S]*?```|`[^`\n]*`|\[[^\]]*\]\([^)]*\))/g)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(new RegExp(TICKET_KEY_RE.source, 'gi'), (k) => `[${k.toUpperCase()}](/tickets/${k.toUpperCase()})`)))
    .join('');
}

export function RichText({ source, className }: { source: string; className?: string }) {
  return <Markdown source={linkTicketKeys(source)} className={cn('text-sm text-gray-800', className)} />;
}

const toLocalInput = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// ------------------------------------------------------------------ triage

type TriageMode = 'accept' | 'need_info' | 'merge' | 'decline' | 'snooze' | null;

export function TriagePanel({ d, meId, onChange }: { d: TicketDetail; meId: number | string | undefined; onChange: () => void }) {
  const t = d.ticket;
  const toast = useToast();
  const [mode, setMode] = useState<TriageMode>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [answer, setAnswer] = useState('');
  const [accept, setAccept] = useState<{ epic_id: string; priority: string; assignee_ids: string[]; estimate_hours: string }>(
    { epic_id: '', priority: t.priority, assignee_ids: [], estimate_hours: '' });
  const [snooze, setSnooze] = useState(() => toLocalInput(new Date(Date.now() + 86_400_000)));
  const { data: epics } = usePapi<Epic[]>(d.can.triage ? `/api/projects/${d.project.id}/epics` : null);
  const isCreator = sameId(t.created_by, meId);

  async function run(body: Record<string, unknown>, done: string) {
    setErr(null); setBusy(true);
    try {
      await papi(`/api/tickets/${t.id}/triage`, { method: 'POST', body });
      toast(done);
      setMode(null); setText(''); setAnswer('');
      onChange();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  function submit() {
    if (mode === 'accept') {
      return run({
        action: 'accept', priority: accept.priority, assignee_ids: accept.assignee_ids.map(Number),
        ...(accept.epic_id ? { epic_id: Number(accept.epic_id) } : {}),
        ...(accept.estimate_hours ? { estimate_hours: Number(accept.estimate_hours) } : {}),
      }, 'Accepted');
    }
    if (mode === 'need_info') return run({ action: 'need_info', question: text }, 'Sent back with your question');
    if (mode === 'merge') return run({ action: 'merge', into_key: text }, 'Merged');
    if (mode === 'decline') return run({ action: 'decline', reason: text }, 'Declined');
    if (mode === 'snooze') return run({ action: 'snooze', until: new Date(snooze).toISOString() }, 'Snoozed');
  }

  const titles: Record<Exclude<TriageMode, null>, string> = {
    accept: 'Accept into the backlog', need_info: 'Ask for more information', merge: 'Merge into another ticket',
    decline: 'Decline this ticket', snooze: 'Snooze until',
  };

  return (
    <section className="rounded-2xl border border-orange-200 bg-orange-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-orange-900"><Inbox className="h-4 w-4" />In Triage</h2>
        <div className="flex items-center gap-2">
          {t.triage_state === 'need_info' && <Pill tone="amber">Waiting for info</Pill>}
          {t.triage_state === 'snoozed' && t.snoozed_until && <Pill tone="gray">Snoozed until {fmtExact(t.snoozed_until)}</Pill>}
          <SlaTimer due={t.triage_due_at} />
        </div>
      </div>
      <p className="mt-1 text-sm text-orange-900/80">
        {d.can.triage ? 'Decide what happens to this request.' : 'A lead developer will review this request soon.'}
      </p>

      {d.can.triage && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Btn size="sm" variant="success" onClick={() => { setErr(null); setMode('accept'); }}><CheckCircle2 className="h-4 w-4" />Accept</Btn>
          <Btn size="sm" variant="secondary" onClick={() => { setErr(null); setText(''); setMode('need_info'); }}><HelpCircle className="h-4 w-4" />Need info</Btn>
          <Btn size="sm" variant="secondary" onClick={() => { setErr(null); setText(''); setMode('merge'); }}><GitMerge className="h-4 w-4" />Merge</Btn>
          <Btn size="sm" variant="secondary" onClick={() => { setErr(null); setMode('snooze'); }}><AlarmClock className="h-4 w-4" />Snooze</Btn>
          <Btn size="sm" variant="secondary" onClick={() => { setErr(null); setText(''); setMode('decline'); }}><XCircle className="h-4 w-4" />Decline</Btn>
        </div>
      )}

      {isCreator && t.triage_state === 'need_info' && (
        <div className="mt-3 space-y-2">
          <label htmlFor="triage-answer" className="block text-sm font-medium text-orange-900">Your answer</label>
          <textarea id="triage-answer" rows={3} className={inputCls} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Reply to the question in the comments below" />
          <div className="flex justify-end">
            <Btn size="sm" disabled={busy || !answer.trim()} onClick={() => run({ action: 'info_given', note: answer }, 'Answer sent')}>Send answer</Btn>
          </div>
          {err && !mode && <p className="text-sm text-red-600">{err}</p>}
        </div>
      )}

      <Modal open={!!mode} onClose={() => setMode(null)} title={mode ? titles[mode] : ''}
        footer={<>
          <Btn variant="secondary" onClick={() => setMode(null)}>Cancel</Btn>
          <Btn variant={mode === 'decline' ? 'danger' : 'primary'} onClick={submit}
            disabled={busy || ((mode === 'need_info' || mode === 'merge' || mode === 'decline') && !text.trim())}>
            {busy ? 'Saving…' : mode === 'accept' ? 'Accept' : mode === 'decline' ? 'Decline' : mode === 'merge' ? 'Merge' : mode === 'snooze' ? 'Snooze' : 'Send'}
          </Btn>
        </>}>
        {mode === 'accept' && (
          <div className="space-y-3">
            <Field label="Epic" htmlFor="acc-epic">
              <select id="acc-epic" className={selectCls} value={accept.epic_id} onChange={(e) => setAccept({ ...accept, epic_id: e.target.value })}>
                <option value="">No epic</option>
                {(epics || []).map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Priority" htmlFor="acc-pri">
                <select id="acc-pri" className={selectCls} value={accept.priority} onChange={(e) => setAccept({ ...accept, priority: e.target.value })}>
                  {PRIORITIES.map((p) => <option key={p} value={p}>{TICKET_PRIORITY_LABELS[p]}</option>)}
                </select>
              </Field>
              <Field label="Estimate (hours)" htmlFor="acc-est">
                <input id="acc-est" type="number" min={0} step={0.5} className={inputCls} value={accept.estimate_hours} onChange={(e) => setAccept({ ...accept, estimate_hours: e.target.value })} />
              </Field>
            </div>
            <Field label="Assign to">
              {d.project_developers.length ? (
                <div className="space-y-1">
                  {d.project_developers.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={accept.assignee_ids.includes(String(p.id))}
                        onChange={(e) => setAccept({ ...accept, assignee_ids: e.target.checked ? [...accept.assignee_ids, String(p.id)] : accept.assignee_ids.filter((x) => x !== String(p.id)) })} />
                      {p.name}{p.member_role === 'lead_developer' && <span className="text-xs text-gray-400">· lead</span>}
                    </label>
                  ))}
                </div>
              ) : <p className="text-sm text-gray-500">No developers on this project yet.</p>}
            </Field>
          </div>
        )}
        {mode === 'need_info' && (
          <Field label="Question for the agent" htmlFor="tri-q" hint="They get a notification and can answer here.">
            <textarea id="tri-q" rows={4} className={inputCls} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
        )}
        {mode === 'merge' && (
          <Field label="Duplicate of" htmlFor="tri-m" hint={`A ticket key in this project, e.g. ${d.project.ticket_no}-T3`}>
            <input id="tri-m" className={cn(inputCls, 'font-mono')} value={text} onChange={(e) => setText(e.target.value.toUpperCase())} placeholder={`${d.project.ticket_no}-T`} />
          </Field>
        )}
        {mode === 'decline' && (
          <Field label="Reason" htmlFor="tri-d" hint="The agent sees this.">
            <textarea id="tri-d" rows={3} className={inputCls} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
        )}
        {mode === 'snooze' && (
          <Field label="Bring it back on" htmlFor="tri-s">
            <input id="tri-s" type="datetime-local" className={inputCls} value={snooze} onChange={(e) => setSnooze(e.target.value)} />
          </Field>
        )}
        {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      </Modal>
    </section>
  );
}

// ------------------------------------------------------------------ change request

export function ChangeRequestPanel({ d, onChange }: { d: TicketDetail; onChange: () => void }) {
  const t = d.ticket;
  const toast = useToast();
  const [mode, setMode] = useState<'approved' | 'rejected' | null>(null);
  const [deadline, setDeadline] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function decide() {
    setErr(null); setBusy(true);
    try {
      await papi(`/api/tickets/${t.id}/cr-decision`, { method: 'POST', body: { decision: mode, ...(deadline && mode === 'approved' ? { new_deadline: deadline } : {}), ...(note.trim() ? { note } : {}) } });
      toast(mode === 'approved' ? 'Change request approved' : 'Change request rejected');
      setMode(null); setDeadline(''); setNote('');
      onChange();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  const tone = t.cr_status === 'approved' ? 'border-emerald-200 bg-emerald-50' : t.cr_status === 'rejected' ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50';
  return (
    <section className={cn('rounded-2xl border p-4', tone)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900"><ShieldAlert className="h-4 w-4" />Change request</h2>
        <Pill tone={t.cr_status === 'approved' ? 'green' : t.cr_status === 'rejected' ? 'red' : 'amber'}>
          {t.cr_status === 'approved' ? 'Approved' : t.cr_status === 'rejected' ? 'Rejected' : 'Waiting for HR approval'}
        </Pill>
      </div>
      <p className="mt-1 text-sm text-gray-700">
        {t.cr_status === 'pending' && 'Work can’t start until HR approves this change.'}
        {t.cr_status === 'approved' && <>Approved{t.cr_decided_by_name ? ` by ${t.cr_decided_by_name}` : ''}{t.cr_decided_at ? ` · ${relTime(t.cr_decided_at)}` : ''}{t.cr_new_deadline ? ` · project deadline moved to ${fmtDay(t.cr_new_deadline)}` : ''}.</>}
        {t.cr_status === 'rejected' && <>Rejected{t.cr_decided_by_name ? ` by ${t.cr_decided_by_name}` : ''}{t.cr_decided_at ? ` · ${relTime(t.cr_decided_at)}` : ''}.</>}
      </p>
      {d.can.decide_cr && (
        <div className="mt-3 flex gap-2">
          <Btn size="sm" variant="success" onClick={() => { setErr(null); setMode('approved'); }}>Approve</Btn>
          <Btn size="sm" variant="danger" onClick={() => { setErr(null); setMode('rejected'); }}>Reject</Btn>
        </div>
      )}
      <Modal open={!!mode} onClose={() => setMode(null)} title={mode === 'approved' ? 'Approve change request' : 'Reject change request'}
        footer={<>
          <Btn variant="secondary" onClick={() => setMode(null)}>Cancel</Btn>
          <Btn variant={mode === 'approved' ? 'success' : 'danger'} onClick={decide} disabled={busy}>{busy ? 'Saving…' : mode === 'approved' ? 'Approve' : 'Reject'}</Btn>
        </>}>
        <div className="space-y-3">
          {mode === 'approved' && (
            <Field label="New project deadline (optional)" htmlFor="cr-dl" hint="Leave empty to keep the current deadline.">
              <input id="cr-dl" type="date" className={inputCls} value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </Field>
          )}
          <Field label="Note (optional)" htmlFor="cr-note" hint="Added as a comment on the ticket.">
            <textarea id="cr-note" rows={3} className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {err && <p className="text-sm text-red-600">{err}</p>}
        </div>
      </Modal>
    </section>
  );
}

// ------------------------------------------------------------------ checklist

export function Checklist({ d, onChange }: { d: TicketDetail; onChange: () => void }) {
  const toast = useToast();
  const [item, setItem] = useState('');
  const [busy, setBusy] = useState(false);
  const items = d.checklist;
  const done = items.filter((i) => i.done).length;
  const can = d.can.work;
  const url = `/api/tickets/${d.ticket.id}/checklist`;

  async function call(method: string, body?: unknown, q = '') {
    try { await papi(url + q, { method, body }); onChange(); } catch (e) { toast((e as Error).message, 'error'); }
  }
  async function add() {
    if (!item.trim()) return;
    setBusy(true);
    await call('POST', { body: item.trim() });
    setItem(''); setBusy(false);
  }

  if (!items.length && !can) return null;
  return (
    <SectionCard title={`Checklist${items.length ? ` · ${done}/${items.length}` : ''}`}>
      {items.length > 0 && (
        <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-valuenow={Math.round((done / items.length) * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Checklist done">
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(done / items.length) * 100}%` }} />
        </div>
      )}
      <ul className="space-y-1">
        {items.map((i: ChecklistItem) => (
          <li key={i.id} className="group flex items-start gap-2 rounded-lg px-1 py-1 hover:bg-gray-50">
            <input type="checkbox" className="mt-0.5" checked={i.done} disabled={!can} aria-label={i.body}
              onChange={(e) => call('PATCH', { item_id: i.id, done: e.target.checked })} />
            <span className={cn('flex-1 text-sm', i.done ? 'text-gray-400 line-through' : 'text-gray-800')}>{i.body}</span>
            {can && (
              <button type="button" aria-label={`Delete ${i.body}`} onClick={() => call('DELETE', undefined, `?item_id=${i.id}`)}
                className="rounded p-0.5 text-gray-300 opacity-0 hover:text-red-600 group-hover:opacity-100 focus:opacity-100"><Trash2 className="h-3.5 w-3.5" /></button>
            )}
          </li>
        ))}
      </ul>
      {can && (
        <div className="mt-2 flex gap-2">
          <input className={inputCls} value={item} placeholder="Add an item" maxLength={500} aria-label="New checklist item"
            onChange={(e) => setItem(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
          <Btn size="sm" variant="secondary" onClick={add} disabled={busy || !item.trim()}><Plus className="h-4 w-4" />Add</Btn>
        </div>
      )}
    </SectionCard>
  );
}

// ------------------------------------------------------------------ subtasks

export function Subtasks({ d, onChange }: { d: TicketDetail; onChange: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const canAdd = d.can.edit && !d.ticket.parent_id && d.ticket.status !== 'triage' && d.ticket.status !== 'declined';
  const subs = d.subtasks;
  if (!subs.length && !canAdd) return null;

  async function add() {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await papi(`/api/projects/${d.project.id}/tickets`, { method: 'POST', body: { title: title.trim(), type: 'task', parent_id: d.ticket.id, epic_id: d.ticket.epic_id } });
      setTitle('');
      onChange();
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }

  const done = subs.filter((s) => s.status === 'done' || s.status === 'closed').length;
  return (
    <SectionCard title={`Subtasks${subs.length ? ` · ${done}/${subs.length}` : ''}`}>
      {subs.length > 0 && (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
          {subs.map((s) => (
            <li key={s.id}>
              <Link href={ticketHref(s.project_id, s.key)} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50">
                <TypeIcon type={s.type} />
                <span className="font-mono text-xs text-gray-500">{s.key}</span>
                <span className={cn('min-w-0 flex-1 truncate text-sm', (s.status === 'done' || s.status === 'closed') ? 'text-gray-400 line-through' : 'text-gray-800')}>{s.title}</span>
                <Assignees people={s.assignees} max={2} />
                <TicketStatusPill status={s.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {canAdd && (
        <div className={cn('flex gap-2', subs.length > 0 && 'mt-2')}>
          <input className={inputCls} value={title} placeholder="Subtask title" maxLength={300} aria-label="New subtask title"
            onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
          <Btn size="sm" variant="secondary" onClick={add} disabled={busy || !title.trim()}><Plus className="h-4 w-4" />Add</Btn>
        </div>
      )}
    </SectionCard>
  );
}

// ------------------------------------------------------------------ relations

const REL_GROUPS: { label: string; match: (r: Relation) => boolean }[] = [
  { label: 'Blocked by', match: (r) => r.kind === 'blocks' && r.direction === 'in' },
  { label: 'Blocks', match: (r) => r.kind === 'blocks' && r.direction === 'out' },
  { label: 'Relates to', match: (r) => r.kind === 'relates_to' },
  { label: 'Duplicate of', match: (r) => r.kind === 'duplicate_of' && r.direction === 'out' },
  { label: 'Duplicates', match: (r) => r.kind === 'duplicate_of' && r.direction === 'in' },
];

export function Relations({ d, onChange }: { d: TicketDetail; onChange: () => void }) {
  const toast = useToast();
  const [rel, setRel] = useState('blocked_by');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const can = d.can.work;
  if (!d.relations.length && !can) return null;

  async function add() {
    setBusy(true);
    try {
      await papi(`/api/tickets/${d.ticket.id}/relations`, { method: 'POST', body: { relation: rel, key: key.trim() } });
      setKey('');
      onChange();
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }
  async function remove(id: number) {
    try { await papi(`/api/tickets/${d.ticket.id}/relations?relation_id=${id}`, { method: 'DELETE' }); onChange(); } catch (e) { toast((e as Error).message, 'error'); }
  }

  return (
    <SectionCard title="Linked tickets">
      <div className="space-y-3">
        {REL_GROUPS.map((g) => {
          const rows = d.relations.filter(g.match);
          if (!rows.length) return null;
          return (
            <div key={g.label}>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{g.label}</h3>
              <ul className="space-y-1">
                {rows.map((r) => (
                  <li key={r.id} className="group flex items-center gap-2 text-sm">
                    <Link href={ticketHref(d.project.id, r.key)} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-1 hover:bg-gray-50">
                      <span className="font-mono text-xs text-gray-500">{r.key}</span>
                      <span className={cn('min-w-0 flex-1 truncate', ['done', 'closed', 'declined'].includes(r.status) && 'text-gray-400 line-through')}>{r.title}</span>
                      <TicketStatusPill status={r.status} />
                    </Link>
                    {can && (
                      <button type="button" aria-label={`Unlink ${r.key}`} onClick={() => remove(r.id)}
                        className="rounded p-1 text-gray-300 opacity-0 hover:text-red-600 group-hover:opacity-100 focus:opacity-100"><Trash2 className="h-3.5 w-3.5" /></button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {!d.relations.length && <p className="text-sm text-gray-500">No linked tickets.</p>}
        {can && (
          <div className="flex flex-wrap gap-2">
            <select className={cn(selectCls, 'w-auto')} value={rel} onChange={(e) => setRel(e.target.value)} aria-label="Relation">
              <option value="blocked_by">Blocked by</option>
              <option value="blocks">Blocks</option>
              <option value="relates_to">Relates to</option>
              <option value="duplicate_of">Duplicate of</option>
            </select>
            <input className={cn(inputCls, 'w-40 flex-1 font-mono')} value={key} placeholder={`${d.project.ticket_no}-T…`} aria-label="Ticket key"
              onChange={(e) => setKey(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === 'Enter' && key.trim()) { e.preventDefault(); add(); } }} />
            <Btn size="sm" variant="secondary" onClick={add} disabled={busy || !key.trim()}><Link2 className="h-4 w-4" />Link</Btn>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

// ------------------------------------------------------------------ comments

export function Comments({ d, meId, isHr }: { d: TicketDetail; meId: number | string | undefined; isHr: boolean }) {
  const toast = useToast();
  const confirm = useConfirm();
  const { data: comments, mutate } = usePapi<Comment[]>(`/api/tickets/${d.ticket.id}/comments`, { refreshInterval: 15_000 });
  // One request for every file in the project, then pick out this ticket's comment attachments.
  const { data: media, mutate: mutateMedia } = usePapi<MediaFile[]>(`/api/media?project_id=${d.project.id}`, { refreshInterval: 30_000 });
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ id: number; body: string } | null>(null);
  const [attachTo, setAttachTo] = useState<number | null>(null);

  const filesByComment = useMemo(() => {
    const map = new Map<string, MediaFile[]>();
    for (const f of media || []) {
      if (f.entity_type !== 'ticket_comment') continue;
      map.set(f.entity_id, [...(map.get(f.entity_id) || []), f]);
    }
    return map;
  }, [media]);

  async function post() {
    if (!body.trim()) return;
    setBusy(true);
    try {
      const c = await papi<Comment>(`/api/tickets/${d.ticket.id}/comments`, { method: 'POST', body: { body } });
      setBody('');
      mutate();
      setAttachTo(c.id);
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }
  async function saveEdit() {
    if (!editing) return;
    try {
      await papi(`/api/ticket-comments/${editing.id}`, { method: 'PATCH', body: { body: editing.body } });
      setEditing(null);
      mutate();
    } catch (e) { toast((e as Error).message, 'error'); }
  }
  async function remove(c: Comment) {
    if (!(await confirm({ title: 'Delete this comment?', body: 'Its attachments are removed too.', confirmLabel: 'Delete', danger: true }))) return;
    try { await papi(`/api/ticket-comments/${c.id}`, { method: 'DELETE' }); mutate(); mutateMedia(); } catch (e) { toast((e as Error).message, 'error'); }
  }

  return (
    <SectionCard title={`Comments${comments?.length ? ` · ${comments.filter((c) => !c.deleted_at).length}` : ''}`}>
      <ul className="space-y-4">
        {(comments || []).map((c) => {
          const mine = sameId(c.user_id, meId);
          const files = filesByComment.get(String(c.id)) || [];
          if (c.deleted_at) {
            return <li key={c.id} className="text-sm italic text-gray-400">Comment deleted · {relTime(c.deleted_at)}</li>;
          }
          return (
            <li key={c.id} className="flex gap-3">
              <Avatar name={c.user_name} size="sm" className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="text-sm font-semibold text-gray-900">{c.user_name || 'Someone'}</span>
                  <RoleBadge role={c.user_role} />
                  <time className="text-xs text-gray-400" dateTime={c.created_at} title={fmtExact(c.created_at)}>{relTime(c.created_at)}</time>
                  {c.edited_at && <span className="text-xs text-gray-400">· edited</span>}
                  <span className="ml-auto flex gap-1">
                    {mine && <button type="button" onClick={() => setAttachTo(attachTo === c.id ? null : c.id)} aria-label="Attach files" title="Attach files" className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><Paperclip className="h-3.5 w-3.5" /></button>}
                    {mine && <button type="button" onClick={() => setEditing({ id: c.id, body: c.body })} aria-label="Edit comment" className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><Pencil className="h-3.5 w-3.5" /></button>}
                    {(mine || isHr) && <button type="button" onClick={() => remove(c)} aria-label="Delete comment" className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>}
                  </span>
                </div>
                {editing?.id === c.id ? (
                  <div className="mt-1 space-y-2">
                    <MarkdownEditor value={editing.body} onChange={(v) => setEditing({ id: c.id, body: v })} rows={4} />
                    <div className="flex justify-end gap-2">
                      <Btn size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Btn>
                      <Btn size="sm" onClick={saveEdit} disabled={!editing.body.trim()}>Save</Btn>
                    </div>
                  </div>
                ) : (
                  <RichText source={c.body} className="mt-0.5 break-words" />
                )}
                {files.length > 0 && (
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {files.map((f) => <FileTile key={f.id} f={f} canDelete={isHr || sameId(f.uploaded_by, meId)} onChanged={() => mutateMedia()} />)}
                  </div>
                )}
                {mine && attachTo === c.id && (
                  <div className="mt-2">
                    <Uploader target={{ entity_type: 'ticket_comment', entity_id: c.id }} requireDescription={false} compact
                      onUploaded={() => { mutateMedia(); }} />
                  </div>
                )}
              </div>
            </li>
          );
        })}
        {comments && !comments.length && <li className="text-sm text-gray-500">No comments yet.</li>}
      </ul>
      <div className="mt-4 space-y-2 border-t border-gray-100 pt-4">
        <MarkdownEditor value={body} onChange={setBody} rows={3} placeholder="Write a comment…" />
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-gray-500">Type @username to mention someone. You can attach files after posting.</p>
          <Btn size="sm" onClick={post} disabled={busy || !body.trim()}>{busy ? 'Posting…' : 'Comment'}</Btn>
        </div>
      </div>
    </SectionCard>
  );
}

// ------------------------------------------------------------------ history

interface HistoryRow { id: number; field: string; old_value: any; new_value: any; created_at: string; user_id: number | null; user_name: string | null }

const FIELD_LABELS: Record<string, string> = {
  title: 'title', type: 'type', priority: 'priority', epic_id: 'epic', parent_id: 'parent ticket', start_date: 'start date',
  due_date: 'due date', estimate_hours: 'estimate', status: 'status', cr_status: 'change request',
};

function fmtVal(field: string, v: any): string {
  if (v === null || v === undefined || v === '') return 'none';
  if (field === 'status') return TICKET_STATUS_LABELS[v as keyof typeof TICKET_STATUS_LABELS] || String(v);
  if (field === 'priority') return TICKET_PRIORITY_LABELS[v as keyof typeof TICKET_PRIORITY_LABELS] || String(v);
  if (field === 'estimate_hours') return `${Number(v)}h`;
  if (field === 'due_date' || field === 'start_date') return fmtDay(String(v).slice(0, 10));
  return String(v);
}

function describe(h: HistoryRow, names: Map<string, string>): string {
  const n = (ids: unknown) => (Array.isArray(ids) ? ids.map((id) => names.get(String(id)) || 'someone').join(', ') : '');
  switch (h.field) {
    case 'created': return `created this ticket${h.new_value?.status === 'triage' ? ' in Triage' : ''}`;
    case 'description': return 'edited the description';
    case 'labels': return 'updated the labels';
    case 'assignees': {
      const list = n(h.new_value);
      return list ? `set assignees to ${list}` : 'removed all assignees';
    }
    case 'checklist': return `${h.new_value?.done ? 'checked' : 'unchecked'} “${h.new_value?.item ?? ''}”`;
    case 'relation': return h.new_value ? `linked ${String(h.new_value.relation || '').replace('_', ' ')} ${h.new_value.key || ''}` : 'removed a link';
    case 'attachment': return `added attachment ${h.new_value ?? ''}`;
    case 'deleted': return 'deleted this ticket';
    case 'cr_status': return `${h.new_value} the change request`;
    case 'epic_id': return h.new_value ? 'changed the epic' : 'removed the epic';
    case 'parent_id': return h.new_value ? 'made it a subtask' : 'removed the parent ticket';
    default: {
      const label = FIELD_LABELS[h.field] || h.field.replace(/_/g, ' ');
      return `changed ${label} ${fmtVal(h.field, h.old_value)} → ${fmtVal(h.field, h.new_value)}`;
    }
  }
}

export function History({ d }: { d: TicketDetail }) {
  const { data, error } = usePapi<HistoryRow[]>(`/api/tickets/${d.ticket.id}/history`, { refreshInterval: 30_000 });
  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of [...d.project_developers, ...d.assignees, ...d.watchers]) m.set(String(p.id), p.name);
    return m;
  }, [d]);
  if (error) return <p className="text-sm text-red-600">Couldn’t load history.</p>;
  if (!data) return <p className="text-sm text-gray-500">Loading…</p>;
  if (!data.length) return <p className="text-sm text-gray-500">No changes yet.</p>;
  return (
    <ol className="space-y-2">
      {data.map((h) => (
        <li key={h.id} className="flex gap-2 text-sm">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gray-300" aria-hidden />
          <span className="min-w-0 flex-1 text-gray-700">
            <span className="font-medium text-gray-900">{h.user_name || 'System'}</span> {describe(h, names)}
            <time className="ml-1.5 text-xs text-gray-400" dateTime={h.created_at} title={fmtExact(h.created_at)}>{relTime(h.created_at)}</time>
          </span>
        </li>
      ))}
    </ol>
  );
}
