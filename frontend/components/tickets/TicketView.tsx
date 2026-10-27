'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileX2, GitBranch, Eye, EyeOff, Pencil, Trash2, Copy, Check, Plus, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import { Btn, Spinner, ErrorNote, Empty, inputCls } from '@/components/training/ui';
import { ProjectsPage, Modal, Field, SectionCard, selectCls, useConfirm, useToast } from '@/components/projects/ui';
import { papi, usePapi, ApiError, relTime, fmtExact, sameId } from '@/components/projects/lib';
import {
  TicketDetail, Epic, LabelRef, TICKET_STATUS_LABELS, TYPE_LABELS, TICKET_PRIORITY_LABELS, TICKET_TYPES, PRIORITIES,
  WORK_STATUSES, TicketStatus, ticketHref,
} from './lib';
import { KeyChip, TypeBadge, TicketStatusPill, TicketPriority, BlockedBadge, Assignees } from './bits';
import { Attachments } from './Attachments';
import { RemindMeButton } from '@/components/reminders/Reminders';
import { MarkdownEditor } from './MarkdownEditor';
import { TriagePanel, ChangeRequestPanel, Checklist, Subtasks, Relations, Comments, History, RichText } from './TicketViewParts';
import { CollabActions, CollabBanners, CollabPanel, HandoffFields, useCollab } from '@/components/collab/TicketCollab';
import { TicketActivity } from '@/components/projects/ActivityTab';

/** Ticket page body. The URL carries the key; it's resolved to an id first. */
export function TicketView({ projectId, ticketKey }: { projectId: string; ticketKey: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const key = decodeURIComponent(ticketKey).toUpperCase();
  const { data: ref, error: refErr } = usePapi<{ id: number; project_id: number; key: string }>(`/api/tickets/by-key/${encodeURIComponent(key)}`);
  const { data: d, error, mutate } = usePapi<TicketDetail>(ref ? `/api/tickets/${ref.id}` : null, { refreshInterval: 30_000 });

  // Wrong project in the URL (e.g. a pasted link): send them to the right one.
  useEffect(() => {
    if (ref && String(ref.project_id) !== String(projectId)) router.replace(ticketHref(ref.project_id, ref.key));
  }, [ref, projectId, router]);

  const back = <Link href={`/projects/${projectId}?tab=tickets`} className="mb-2 inline-block text-sm text-gray-500 hover:text-gray-700">← Tickets</Link>;
  const err = refErr || error;
  if (err) {
    const notFound = /not found/i.test((err as Error).message);
    return (
      <ProjectsPage>
        {back}
        {notFound ? (
          <div className="rounded-2xl border border-gray-200 bg-white">
            <Empty icon={<FileX2 className="h-6 w-6" />} title="Ticket not found" body="It may have been deleted, or you’re not on this project." />
          </div>
        ) : <ErrorNote error={err} />}
      </ProjectsPage>
    );
  }
  if (!d) return <ProjectsPage>{back}<Spinner label="Loading ticket…" /></ProjectsPage>;
  return <ProjectsPage>{back}<TicketBody d={d} meId={user?.id} onChange={() => mutate()} /></ProjectsPage>;
}

function TicketBody({ d, meId, onChange }: { d: TicketDetail; meId: number | undefined; onChange: () => void }) {
  const t = d.ticket;
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const isHr = d.viewer_role === 'hr';
  const isLead = d.project_developers.some((p) => sameId(p.id, meId) && p.member_role === 'lead_developer');
  const [tab, setTab] = useState<'comments' | 'history'>('comments');
  const [editTitle, setEditTitle] = useState<string | null>(null);
  const [editDesc, setEditDesc] = useState<string | null>(null);
  const { data: collab, mutate: mutateCollab } = useCollab(t.id);
  const changed = () => { onChange(); mutateCollab(); };

  /** PATCH with a confirm-and-retry when the server says the ticket is blocked. */
  async function patch(body: Record<string, unknown>, ok?: string) {
    try {
      await papi(`/api/tickets/${t.id}`, { method: 'PATCH', body });
      if (ok) toast(ok);
      onChange();
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        if (await confirm({ title: 'This ticket is blocked', body: e.message, confirmLabel: 'Move anyway' })) return patch({ ...body, confirm_blocked: true }, ok);
        return false;
      }
      toast((e as Error).message, 'error');
      return false;
    }
  }

  async function toggleWatch() {
    try {
      await papi(`/api/tickets/${t.id}/watchers`, { method: d.watching ? 'DELETE' : 'POST' });
      toast(d.watching ? 'You’ll stop getting updates' : 'You’ll get updates on this ticket', 'info');
      onChange();
    } catch (e) { toast((e as Error).message, 'error'); }
  }

  async function del() {
    if (!(await confirm({ title: `Delete ${t.key}?`, body: 'It disappears from the board and lists.', confirmLabel: 'Delete', danger: true }))) return;
    try {
      await papi(`/api/tickets/${t.id}`, { method: 'DELETE' });
      toast(`${t.key} deleted`);
      router.push(`/projects/${d.project.id}?tab=tickets`);
    } catch (e) { toast((e as Error).message, 'error'); }
  }

  async function reopen() {
    try { await papi(`/api/tickets/${t.id}/triage`, { method: 'POST', body: { action: 'reopen' } }); toast('Back in Triage'); onChange(); }
    catch (e) { toast((e as Error).message, 'error'); }
  }

  const inWork = t.status !== 'triage' && t.status !== 'declined';
  const statusOptions: TicketStatus[] = [...WORK_STATUSES, 'closed'];

  return (
    <>
      {/* Header */}
      <div className="mb-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <KeyChip value={t.key} className="text-sm" />
          <TypeBadge type={t.type} />
          <TicketStatusPill status={t.status} />
          <TicketPriority priority={t.priority} />
          {d.blockers.length > 0 && <BlockedBadge />}
          <span className="ml-auto flex items-center gap-1">
            <Btn size="sm" variant="ghost" onClick={toggleWatch}>{d.watching ? <><EyeOff className="h-4 w-4" />Unwatch</> : <><Eye className="h-4 w-4" />Watch</>}</Btn>
            <CollabActions d={d} onChange={changed} />
            <RemindMeButton entityType="ticket" entityId={t.id} defaultTitle={`${t.key}: ${t.title}`} variant="icon" />
            {d.can.delete && <Btn size="sm" variant="ghost" onClick={del} className="text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" />Delete</Btn>}
          </span>
        </div>

        {editTitle !== null ? (
          <div className="mt-2 flex flex-wrap gap-2">
            <input className={cn(inputCls, 'flex-1 text-lg font-semibold')} value={editTitle} maxLength={300} autoFocus aria-label="Title"
              onChange={(e) => setEditTitle(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Escape') setEditTitle(null);
                if (e.key === 'Enter' && editTitle.trim() && await patch({ title: editTitle.trim() })) setEditTitle(null);
              }} />
            <Btn size="sm" variant="ghost" onClick={() => setEditTitle(null)}>Cancel</Btn>
            <Btn size="sm" disabled={!editTitle.trim()} onClick={async () => { if (await patch({ title: editTitle.trim() })) setEditTitle(null); }}>Save</Btn>
          </div>
        ) : (
          <h1 className="group mt-2 flex items-start gap-2 text-xl font-bold tracking-tight text-gray-900 sm:text-2xl">
            <span className="min-w-0 break-words">{t.title}</span>
            {d.can.edit && (
              <button type="button" aria-label="Edit title" onClick={() => setEditTitle(t.title)}
                className="mt-1 rounded p-1 text-gray-300 opacity-0 hover:text-gray-600 group-hover:opacity-100 focus:opacity-100"><Pencil className="h-4 w-4" /></button>
            )}
          </h1>
        )}

        <p className="mt-1 text-sm text-gray-500">
          Opened by {t.created_by_name || 'someone'} <time dateTime={t.created_at} title={fmtExact(t.created_at)}>{relTime(t.created_at)}</time>
          {' · '}{d.project.ticket_no} · {d.project.client_name}
          {d.parent && <> · subtask of <Link href={ticketHref(d.project.id, d.parent.key)} className="text-primary-600 hover:underline">{d.parent.key}</Link></>}
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-3">
          {inWork && d.viewer_role !== 'agent' ? <BranchName branch={t.branch} /> : <span />}
          {inWork && d.can.work && (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-gray-500">Status</span>
              <select data-shortcut="status" aria-label="Status" className={cn(selectCls, 'w-auto')} value={t.status} onChange={(e) => patch({ status: e.target.value }, `Moved to ${TICKET_STATUS_LABELS[e.target.value as TicketStatus]}`)}>
                {statusOptions.map((s) => <option key={s} value={s}>{TICKET_STATUS_LABELS[s]}</option>)}
              </select>
            </label>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Main */}
        <div className="min-w-0 space-y-4">
          <CollabBanners collab={collab} />
          {t.status === 'triage' && <TriagePanel d={d} meId={meId} onChange={onChange} />}
          {t.status === 'declined' && (
            <section className="rounded-2xl border border-red-200 bg-red-50 p-4">
              <h2 className="text-sm font-semibold text-red-900">Declined</h2>
              <p className="mt-1 text-sm text-red-900/80">{t.decline_reason || 'No reason given.'}</p>
              {(isHr || isLead) && <Btn size="sm" variant="secondary" className="mt-3" onClick={reopen}><RotateCcw className="h-4 w-4" />Reopen in Triage</Btn>}
            </section>
          )}
          {t.type === 'change_request' && t.cr_status && <ChangeRequestPanel d={d} onChange={onChange} />}

          <SectionCard title="Description" action={d.can.edit && editDesc === null
            ? <button data-shortcut="edit-description" onClick={() => setEditDesc(t.description)} className="text-xs font-medium text-primary-600 hover:underline">Edit</button> : undefined}>
            {editDesc !== null ? (
              <div className="space-y-2">
                <MarkdownEditor value={editDesc} onChange={setEditDesc} rows={10} autoFocus />
                <div className="flex justify-end gap-2">
                  <Btn size="sm" variant="ghost" onClick={() => setEditDesc(null)}>Cancel</Btn>
                  <Btn size="sm" onClick={async () => { if (await patch({ description: editDesc }, 'Description saved')) setEditDesc(null); }}>Save</Btn>
                </div>
              </div>
            ) : t.description.trim() ? <RichText source={t.description} /> : <p className="text-sm text-gray-400">No description.</p>}
          </SectionCard>

          <Checklist d={d} onChange={onChange} />
          <Subtasks d={d} onChange={onChange} />

          <SectionCard title="Attachments">
            <Attachments target={{ entity_type: 'ticket', entity_id: t.id }} meId={meId} isHr={isHr} capturePaste requireDescription />
          </SectionCard>

          {/* GitHub / work-update activity for this ticket (hidden when there is none) */}
          <TicketActivity projectId={d.project.id} ticketId={t.id} />

          <div>
            <div role="tablist" aria-label="Activity" className="mb-3 inline-flex gap-1 rounded-xl bg-gray-100 p-1">
              {(['comments', 'history'] as const).map((k) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                  className={cn('rounded-lg px-3 py-1.5 text-sm font-medium', tab === k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900')}>
                  {k === 'comments' ? 'Comments' : 'History'}
                </button>
              ))}
            </div>
            {tab === 'comments' ? <Comments d={d} meId={meId} isHr={isHr} /> : <SectionCard title="History"><History d={d} /></SectionCard>}
          </div>
        </div>

        {/* Sidebar */}
        <div className="min-w-0 space-y-4">
          <Fields d={d} patch={patch} onChange={changed} />
          <CollabPanel d={d} collab={collab} meId={meId} onChange={changed} />
          <Relations d={d} onChange={onChange} />
        </div>
      </div>
    </>
  );
}

function BranchName({ branch }: { branch: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="min-w-0">
      <button type="button" onClick={() => navigator.clipboard.writeText(branch).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
        className="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-gray-50 px-2 py-1 font-mono text-xs text-gray-700 ring-1 ring-gray-200 hover:bg-gray-100" title="Copy branch name">
        <GitBranch className="h-3.5 w-3.5 shrink-0 text-gray-400" />
        <span className="truncate">{branch}</span>
        {copied ? <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" /> : <Copy className="h-3.5 w-3.5 shrink-0 text-gray-400" />}
      </button>
      <p className="mt-1 text-xs text-gray-500">Name your branch like this and GitHub tracking will link it automatically.</p>
    </div>
  );
}

// ------------------------------------------------------------------ sidebar fields

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-2 py-1.5">
      <span className="text-xs font-medium text-gray-500">{label}</span>
      <div className="min-w-0 text-sm text-gray-800">{children}</div>
    </div>
  );
}

function Fields({ d, patch, onChange }: { d: TicketDetail; patch: (b: Record<string, unknown>, ok?: string) => Promise<boolean>; onChange: () => void }) {
  const t = d.ticket;
  const toast = useToast();
  const canEdit = d.can.edit;
  const canWork = d.can.work;
  const { data: epics } = usePapi<Epic[]>(canEdit ? `/api/projects/${d.project.id}/epics` : null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [est, setEst] = useState(t.estimate_hours ?? '');
  useEffect(() => setEst(t.estimate_hours ?? ''), [t.estimate_hours]);

  return (
    <SectionCard title="Details">
      <div className="divide-y divide-gray-50">
        <Row label="Assignees">
          <div className="flex items-center justify-between gap-2">
            <Assignees people={d.assignees} max={4} />
            {canWork && t.status !== 'triage' && <button data-shortcut="assignees" onClick={() => setAssignOpen(true)} className="text-xs font-medium text-primary-600 hover:underline">Change</button>}
          </div>
          {d.assignees.length > 0 && <p className="mt-0.5 truncate text-xs text-gray-500">{d.assignees.map((a) => a.name).join(', ')}</p>}
        </Row>
        <Row label="Type">
          {canEdit ? (
            <select className={cn(selectCls, 'py-1')} value={t.type} onChange={(e) => patch({ type: e.target.value }, 'Type changed')} aria-label="Type">
              {TICKET_TYPES.map((x) => <option key={x} value={x}>{TYPE_LABELS[x]}</option>)}
            </select>
          ) : TYPE_LABELS[t.type]}
        </Row>
        <Row label="Priority">
          {canEdit ? (
            <select className={cn(selectCls, 'py-1')} value={t.priority} onChange={(e) => patch({ priority: e.target.value }, 'Priority changed')} aria-label="Priority">
              {PRIORITIES.map((x) => <option key={x} value={x}>{TICKET_PRIORITY_LABELS[x]}</option>)}
            </select>
          ) : TICKET_PRIORITY_LABELS[t.priority]}
        </Row>
        <Row label="Epic">
          {canEdit ? (
            <select className={cn(selectCls, 'py-1')} value={t.epic_id ?? ''} onChange={(e) => patch({ epic_id: e.target.value ? Number(e.target.value) : null })} aria-label="Epic">
              <option value="">None</option>
              {(epics || []).map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
              {d.epic && !(epics || []).some((e) => e.id === d.epic!.id) && <option value={d.epic.id}>{d.epic.title}</option>}
            </select>
          ) : d.epic ? <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: d.epic.color }} />{d.epic.title}</span> : <span className="text-gray-400">None</span>}
        </Row>
        <Row label="Labels">
          <div className="flex flex-wrap items-center gap-1">
            {d.labels.map((l) => <LabelChip key={l.id} l={l} />)}
            {!d.labels.length && <span className="text-gray-400">None</span>}
            {canEdit && <button onClick={() => setLabelsOpen(true)} className="ml-auto text-xs font-medium text-primary-600 hover:underline">Edit</button>}
          </div>
        </Row>
        <Row label="Start">
          {canEdit ? <input type="date" className={cn(inputCls, 'py-1')} value={t.start_date ?? ''} onChange={(e) => patch({ start_date: e.target.value || null })} aria-label="Start date" />
            : t.start_date || <span className="text-gray-400">—</span>}
        </Row>
        <Row label="Due">
          {canEdit ? <input type="date" className={cn(inputCls, 'py-1')} value={t.due_date ?? ''} onChange={(e) => patch({ due_date: e.target.value || null })} aria-label="Due date" />
            : t.due_date || <span className="text-gray-400">—</span>}
        </Row>
        <Row label="Estimate">
          {canWork ? (
            <div className="flex items-center gap-1">
              <input type="number" min={0} step={0.5} className={cn(inputCls, 'py-1')} value={est} aria-label="Estimate in hours"
                onChange={(e) => setEst(e.target.value)}
                onBlur={() => { if (String(est) !== String(t.estimate_hours ?? '')) patch({ estimate_hours: est === '' ? null : Number(est) }, 'Estimate saved'); }} />
              <span className="text-xs text-gray-500">h</span>
            </div>
          ) : t.estimate_hours ? `${Number(t.estimate_hours)}h` : <span className="text-gray-400">—</span>}
        </Row>
        {d.parent && (
          <Row label="Parent">
            <Link href={ticketHref(d.project.id, d.parent.key)} className="truncate text-primary-600 hover:underline">{d.parent.key} · {d.parent.title}</Link>
          </Row>
        )}
        <Row label="Watchers"><span className="block break-words text-xs text-gray-600">{d.watchers.map((w) => w.name).join(', ') || 'Nobody'}</span></Row>
        {t.accepted_by_name && <Row label="Accepted"><span className="text-xs text-gray-600">{t.accepted_by_name}{t.accepted_at ? ` · ${relTime(t.accepted_at)}` : ''}</span></Row>}
      </div>

      {assignOpen && <AssignModal d={d} onClose={() => setAssignOpen(false)} onSaved={() => { setAssignOpen(false); onChange(); toast('Assignees updated'); }} />}
      {labelsOpen && <LabelsModal d={d} onClose={() => setLabelsOpen(false)} patch={patch} />}
    </SectionCard>
  );
}

function LabelChip({ l }: { l: LabelRef }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: `${l.color}22`, color: l.color }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: l.color }} />{l.name}
    </span>
  );
}

function AssignModal({ d, onClose, onSaved }: { d: TicketDetail; onClose: () => void; onSaved: () => void }) {
  const [sel, setSel] = useState<string[]>(d.assignees.map((a) => String(a.id)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [handoff, setHandoff] = useState({ done: '', left: '', branch: d.ticket.branch || '', gotchas: '' });
  // Taking someone off work that's in progress needs a handoff note (the server enforces it too).
  const needsHandoff = d.ticket.status === 'in_progress' && d.assignees.some((a) => !sel.includes(String(a.id)));
  async function save() {
    setBusy(true); setErr(null);
    try {
      await papi(`/api/tickets/${d.ticket.id}/assignees`, { method: 'PUT', body: { user_ids: sel.map(Number), handoff: needsHandoff ? handoff : undefined } });
      onSaved();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="Assign developers" size="sm"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn onClick={save} disabled={busy || (needsHandoff && (!handoff.done.trim() || !handoff.left.trim()))}>{busy ? 'Saving…' : 'Save'}</Btn></>}>
      {d.project_developers.length ? (
        <div className="space-y-1.5">
          {d.project_developers.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={sel.includes(String(p.id))}
                onChange={(e) => setSel(e.target.checked ? [...sel, String(p.id)] : sel.filter((x) => x !== String(p.id)))} />
              {p.name}{p.member_role === 'lead_developer' && <span className="text-xs text-gray-400">· lead</span>}
            </label>
          ))}
        </div>
      ) : <p className="text-sm text-gray-500">No developers on this project yet. HR can add them on the project’s People panel.</p>}
      {needsHandoff && <div className="mt-3"><HandoffFields value={handoff} onChange={setHandoff} /></div>}
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
    </Modal>
  );
}

const LABEL_COLORS = ['#64748b', '#ef4444', '#f59e0b', '#10b981', '#0ea5e9', '#6366f1', '#a855f7', '#ec4899'];

function LabelsModal({ d, onClose, patch }: { d: TicketDetail; onClose: () => void; patch: (b: Record<string, unknown>, ok?: string) => Promise<boolean> }) {
  const { data: labels, mutate } = usePapi<LabelRef[]>(`/api/projects/${d.project.id}/labels`);
  const toast = useToast();
  const [sel, setSel] = useState<number[]>(d.labels.map((l) => l.id));
  const [name, setName] = useState('');
  const [color, setColor] = useState(LABEL_COLORS[4]);
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!name.trim()) return;
    try {
      const l = await papi<LabelRef>(`/api/projects/${d.project.id}/labels`, { method: 'POST', body: { name: name.trim(), color } });
      setSel((s) => (s.includes(l.id) ? s : [...s, l.id]));
      setName('');
      mutate();
    } catch (e) { toast((e as Error).message, 'error'); }
  }
  async function save() {
    setBusy(true);
    if (await patch({ label_ids: sel }, 'Labels updated')) onClose();
    setBusy(false);
  }

  return (
    <Modal open onClose={onClose} title="Labels" size="sm"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Btn></>}>
      <div className="space-y-1.5">
        {(labels || []).map((l) => (
          <label key={l.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={sel.includes(l.id)} onChange={(e) => setSel(e.target.checked ? [...sel, l.id] : sel.filter((x) => x !== l.id))} />
            <LabelChip l={l} />{l.global && <span className="text-xs text-gray-400">company-wide</span>}
          </label>
        ))}
        {labels && !labels.length && <p className="text-sm text-gray-500">No labels yet — create one below.</p>}
      </div>
      {d.can.work && (
        <Field label="New label" htmlFor="new-label" className="mt-4">
          <div className="flex gap-2">
            <input id="new-label" className={inputCls} value={name} maxLength={50} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); create(); } }} />
            <Btn size="sm" variant="secondary" onClick={create} disabled={!name.trim()}><Plus className="h-4 w-4" />Add</Btn>
          </div>
          <div className="mt-2 flex gap-1.5" role="radiogroup" aria-label="Label colour">
            {LABEL_COLORS.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} onClick={() => setColor(c)}
                className={cn('h-5 w-5 rounded-full ring-offset-1', color === c && 'ring-2 ring-gray-700')} style={{ background: c }} />
            ))}
          </div>
        </Field>
      )}
    </Modal>
  );
}
