'use client';

import Link from 'next/link';
import { RemindMeButton } from '@/components/reminders/Reminders';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, Printer, History, Eye, EyeOff, HelpCircle, GitPullRequestArrow, Pencil, Trash2, RotateCcw, Paperclip, X, CheckCircle2, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Btn, Pill, Empty, ErrorNote, Spinner, inputCls } from '@/components/training/ui';
import { Markdown } from '@/components/training/markdown';
import { Modal, Field, SectionCard, selectCls, useConfirm, useToast, Avatar, RoleBadge } from '@/components/projects/ui';
import { papi, usePapi, ProjectDetail, fmtInTz, PKT, sameId, relTime } from '@/components/projects/lib';
import { FileTile } from '@/components/tickets/Attachments';
import { MediaFile, fmtSize, uploadFile } from '@/components/tickets/lib';
import { MarkdownEditor } from '@/components/tickets/MarkdownEditor';
import { BRIEF_TYPES, BRIEF_TYPE_LABELS, BRIEF_TAG_LABELS, BriefType, briefEditMode } from '@/lib/brief/rules';

interface Mark { id: number; user_id: number | string; name: string | null; kind: 'seen' | 'need_clarification'; comment: string | null; created_at: string; resolved_at: string | null; resolution: string | null }
interface Entry {
  id: number; type: BriefType; body: string; tags: string[]; is_original: boolean; version: number; created_by: number | string;
  created_by_name: string | null; created_by_role: string | null; created_at: string; edited_at: string | null; edited_by_name: string | null;
  deleted_at: string | null; history_count: number; file_count: number; marks: Mark[]; ticket_key: string | null;
}
interface BriefList { entries: Entry[]; can: { add: boolean; mark: boolean; restore: boolean }; me: { id: number | string; role: string } }

const TYPE_TONE: Record<BriefType, 'blue' | 'violet' | 'amber' | 'green' | 'gray'> = {
  requirement: 'blue', content: 'violet', change: 'amber', feedback: 'green', clarification: 'gray',
};

export function BriefTab({ d, meId }: { d: ProjectDetail; meId?: number | string }) {
  const pid = d.project.id;
  const tz = d.project.client_timezone || 'America/New_York';
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const [qd, setQd] = useState('');
  const [view, setView] = useState<'timeline' | 'current'>('timeline');
  const [adding, setAdding] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  useEffect(() => { const t = setTimeout(() => setQd(q.trim()), 300); return () => clearTimeout(t); }, [q]);

  const qs = new URLSearchParams();
  if (type && view === 'timeline') qs.set('type', type);
  if (qd && view === 'timeline') qs.set('q', qd);
  const { data, error, isLoading, mutate } = usePapi<BriefList>(`/api/projects/${pid}/brief?${qs}`, { refreshInterval: 30_000 });
  const { data: files, mutate: mutateFiles } = usePapi<MediaFile[]>(`/api/media?project_id=${pid}&entity_types=brief_entry`, { refreshInterval: 30_000 });
  const byEntry = useMemo(() => {
    const m = new Map<string, MediaFile[]>();
    for (const f of files || []) m.set(f.entity_id, [...(m.get(f.entity_id) || []), f]);
    return m;
  }, [files]);
  const refresh = () => { mutate(); mutateFiles(); };

  // Jump to #brief-<id> links from notifications and search.
  useEffect(() => {
    const m = /#brief-(\d+)/.exec(window.location.hash);
    if (m && data) document.getElementById(`brief-${m[1]}`)?.scrollIntoView({ block: 'center' });
  }, [data]);

  const entries = data?.entries || [];
  const chronological = [...entries].sort((a, b) => (a.is_original ? -1 : b.is_original ? 1 : a.created_at.localeCompare(b.created_at)));

  return (
    <SectionCard title="Brief"
      action={<div className="flex flex-wrap gap-2">
        <div role="tablist" aria-label="Brief view" className="inline-flex gap-1 rounded-xl bg-gray-100 p-1">
          {(['timeline', 'current'] as const).map((v) => (
            <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}
              className={cn('rounded-lg px-3 py-1 text-sm font-medium', view === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900')}>
              {v === 'timeline' ? 'Timeline' : 'Current brief'}
            </button>
          ))}
        </div>
        {data?.can.add && <Btn size="sm" onClick={() => setAdding(true)}><Plus className="h-4 w-4" />Add brief update</Btn>}
      </div>}>
      {error && <ErrorNote error={error} />}
      {isLoading && !data && <Spinner label="Loading brief…" />}

      {data && view === 'timeline' && (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            <label className="relative min-w-[12rem] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input className={cn(inputCls, 'py-1.5 pl-8')} placeholder="Search text and file descriptions" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the brief" />
            </label>
            <select className={cn(selectCls, 'w-auto py-1.5')} value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
              <option value="">All types</option>
              {BRIEF_TYPES.map((t) => <option key={t} value={t}>{BRIEF_TYPE_LABELS[t]}</option>)}
            </select>
          </div>
          {!entries.length ? (
            <Empty icon={<Paperclip className="h-6 w-6" />} title="Nothing here" body={data.can.add ? 'Add the client’s requirements, assets and changes as they come in.' : 'The agent adds the client’s requirements here.'} />
          ) : (
            <ol className="space-y-3">
              {entries.map((e) => (
                <EntryCard key={e.id} e={e} pid={pid} tz={tz} meId={meId} list={data} files={byEntry.get(String(e.id)) || []} onChange={refresh} />
              ))}
            </ol>
          )}
          {data.can.restore && (
            <div className="mt-4">
              <button type="button" className="text-xs font-medium text-primary-600 hover:underline" onClick={() => setShowDeleted((x) => !x)}>
                {showDeleted ? 'Hide deleted updates' : 'Show deleted updates'}
              </button>
              {showDeleted && <DeletedEntries pid={pid} onRestored={refresh} />}
            </div>
          )}
        </>
      )}

      {data && view === 'current' && <CurrentBrief entries={chronological} files={byEntry} tz={tz} title={`${d.project.ticket_no} · ${d.project.title}`} client={d.project.client_name} />}

      <AddEntryModal open={adding} pid={pid} onClose={() => setAdding(false)} onDone={() => { setAdding(false); refresh(); }} />
    </SectionCard>
  );
}

function When({ iso, tz }: { iso: string; tz: string }) {
  return (
    <span title={new Date(iso).toLocaleString()}>
      {fmtInTz(iso, PKT, { date: true, zone: true })}
      <span className="text-gray-400"> · client {fmtInTz(iso, tz, { zone: true })}</span>
    </span>
  );
}

// ------------------------------------------------------------------ one entry

function EntryCard({ e, pid, tz, meId, list, files, onChange }: {
  e: Entry; pid: number; tz: string; meId?: number | string; list: BriefList; files: MediaFile[]; onChange: () => void;
}) {
  const confirm = useConfirm();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [history, setHistory] = useState(false);
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState('');
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const mine = sameId(e.created_by, meId);
  const canEdit = list.me.role === 'hr' || (mine && list.can.add);
  const seen = e.marks.filter((m) => m.kind === 'seen');
  const iSaw = seen.some((m) => sameId(m.user_id, meId));
  const questions = e.marks.filter((m) => m.kind === 'need_clarification');

  async function post(path: string, body: unknown, ok?: string) {
    try { await papi(path, { method: 'POST', body }); onChange(); if (ok) toast(ok); } catch (err) { toast((err as Error).message, 'error'); }
  }

  return (
    <li id={`brief-${e.id}`} className={cn('rounded-xl border p-3 sm:p-4', e.is_original ? 'border-primary-200 bg-primary-50/40' : 'border-gray-200')}>
      <div className="flex flex-wrap items-center gap-2">
        {e.is_original ? <Pill tone="blue">Original brief</Pill> : <Pill tone={TYPE_TONE[e.type]}>{BRIEF_TYPE_LABELS[e.type]}</Pill>}
        {e.tags.map((t) => <Pill key={t} tone="amber"><Clock className="h-3 w-3" />{BRIEF_TAG_LABELS[t] || t}</Pill>)}
        {e.version > 1 && <span className="text-xs text-gray-500">v{e.version}</span>}
        {e.ticket_key && <Link href={`/tickets/${e.ticket_key}`} className="text-xs font-medium text-primary-600 hover:underline">→ {e.ticket_key}</Link>}
        <span className="ml-auto flex items-center gap-1">
          <RemindMeButton entityType="brief_entry" entityId={e.id} variant="icon"
            defaultTitle={`Brief: ${(e.body.split('\n').find((l: string) => l.trim()) || 'brief update').replace(/[#*_`>]/g, '').trim().slice(0, 150)}`} />
          {e.history_count > 0 && <IconBtn label="History" onClick={() => setHistory(true)}><History className="h-4 w-4" /></IconBtn>}
          {canEdit && <IconBtn label="Edit" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" /></IconBtn>}
          {canEdit && !e.is_original && (
            <IconBtn label="Delete" danger onClick={async () => {
              if (!(await confirm({ title: 'Delete this brief update?', body: 'HR can restore it later.', confirmLabel: 'Delete', danger: true }))) return;
              try { await papi(`/api/brief/${e.id}`, { method: 'DELETE' }); onChange(); } catch (err) { toast((err as Error).message, 'error'); }
            }}><Trash2 className="h-4 w-4" /></IconBtn>
          )}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
        <Avatar name={e.created_by_name} size="sm" /><span className="font-medium text-gray-700">{e.created_by_name || 'Someone'}</span>
        <RoleBadge role={e.created_by_role} /><When iso={e.created_at} tz={tz} />
        {e.edited_at && <span>· edited {relTime(e.edited_at)}{e.edited_by_name ? ` by ${e.edited_by_name}` : ''}</span>}
      </div>
      <div className="mt-2 text-sm text-gray-900">
        {e.body.trim() ? <Markdown source={e.body} /> : <p className="text-gray-400">No text.</p>}
      </div>
      {files.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {files.map((f) => <FileTile key={f.id} f={f} canDelete={list.me.role === 'hr' || sameId(f.uploaded_by, meId)} onChanged={onChange} />)}
        </div>
      )}

      {/* Questions from developers, and answers */}
      {questions.length > 0 && (
        <ul className="mt-3 space-y-2">
          {questions.map((m) => (
            <li key={m.id} className={cn('rounded-lg px-3 py-2 text-sm', m.resolved_at ? 'bg-gray-50' : 'bg-amber-50')}>
              <p className="text-gray-800"><HelpCircle className="mr-1 inline h-3.5 w-3.5 text-amber-600" /><strong>{m.name}</strong> needs clarification: {m.comment}</p>
              {m.resolved_at ? (
                <p className="mt-1 text-gray-600"><CheckCircle2 className="mr-1 inline h-3.5 w-3.5 text-emerald-600" />{m.resolution}</p>
              ) : list.can.add && (
                <div className="mt-1.5 flex gap-2">
                  <input className={cn(inputCls, 'py-1.5')} placeholder="Answer…" value={answers[m.id] || ''} onChange={(ev) => setAnswers({ ...answers, [m.id]: ev.target.value })} aria-label="Answer" />
                  <Btn size="sm" disabled={!answers[m.id]?.trim()} onClick={() => post(`/api/brief/${e.id}/marks`, { kind: 'resolve', mark_id: m.id, resolution: answers[m.id] }, 'Answered')}>Answer</Btn>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2.5 text-xs">
        <span className="text-gray-500">{seen.length ? `Seen by ${seen.map((m) => m.name).join(', ')}` : 'Not seen by developers yet'}</span>
        <span className="ml-auto flex flex-wrap gap-1.5">
          {list.can.mark && (iSaw
            ? <Btn size="sm" variant="ghost" onClick={async () => { try { await papi(`/api/brief/${e.id}/marks`, { method: 'DELETE' }); onChange(); } catch (err) { toast((err as Error).message, 'error'); } }}><EyeOff className="h-4 w-4" />Unmark</Btn>
            : <Btn size="sm" variant="secondary" onClick={() => post(`/api/brief/${e.id}/marks`, { kind: 'seen' })}><Eye className="h-4 w-4" />Mark seen</Btn>)}
          {list.can.mark && <Btn size="sm" variant="secondary" onClick={() => setAsking(true)}><HelpCircle className="h-4 w-4" />Need clarification</Btn>}
          {list.can.add && e.type === 'change' && !e.ticket_key && !e.is_original && (
            <Btn size="sm" variant="secondary" onClick={() => post(`/api/brief/${e.id}/convert`, {}, 'Change request created in Triage')}><GitPullRequestArrow className="h-4 w-4" />Convert to change request</Btn>
          )}
        </span>
      </div>

      <Modal open={asking} onClose={() => setAsking(false)} title="Ask for clarification" size="sm"
        footer={<>
          <Btn variant="secondary" onClick={() => setAsking(false)}>Cancel</Btn>
          <Btn disabled={!question.trim()} onClick={async () => { await post(`/api/brief/${e.id}/marks`, { kind: 'need_clarification', comment: question }, 'The agent was notified'); setAsking(false); setQuestion(''); }}>Send</Btn>
        </>}>
        <Field label="What's unclear?" htmlFor={`q-${e.id}`}><textarea id={`q-${e.id}`} rows={3} className={inputCls} value={question} onChange={(ev) => setQuestion(ev.target.value)} /></Field>
      </Modal>
      {editing && <EditEntryModal e={e} onClose={() => setEditing(false)} onDone={() => { setEditing(false); onChange(); }} />}
      {history && <HistoryModal e={e} onClose={() => setHistory(false)} />}
    </li>
  );
}

function IconBtn({ children, label, onClick, danger }: { children: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}
      className={cn('rounded-lg p-1.5 text-gray-500', danger ? 'hover:bg-red-50 hover:text-red-600' : 'hover:bg-gray-100 hover:text-gray-800')}>
      {children}
    </button>
  );
}

// ------------------------------------------------------------------ add / edit / history

interface QueuedFile { key: string; file: File; description: string; progress: number; error?: string; done?: boolean }

function AddEntryModal({ open, pid, onClose, onDone }: { open: boolean; pid: number; onClose: () => void; onDone: () => void }) {
  const [type, setType] = useState<BriefType>('requirement');
  const [body, setBody] = useState('');
  const [waiting, setWaiting] = useState(false);
  const [files, setFiles] = useState<QueuedFile[]>([]);
  const [entryId, setEntryId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) { setType('requirement'); setBody(''); setWaiting(false); setFiles([]); setEntryId(null); setErr(null); } }, [open]);

  const add = (list: FileList | File[]) => setFiles((cur) => [...cur, ...Array.from(list).filter((f) => f.size > 0 && f.size <= 50 * 1024 * 1024)
    .map((file) => ({ key: `${file.name}-${Math.random()}`, file, description: '', progress: 0 }))]);

  useEffect(() => {
    if (!open) return;
    const onPaste = (ev: ClipboardEvent) => {
      const pasted = Array.from(ev.clipboardData?.files || []);
      if (!pasted.length) return;
      ev.preventDefault();
      add(pasted.map((f, i) => (f.name === 'image.png' ? new File([f], `screenshot-${Date.now()}${i ? `-${i}` : ''}.png`, { type: f.type }) : f)));
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [open]);

  async function save() {
    setErr(null);
    if (files.some((f) => !f.description.trim())) { setErr('Add a short description for each file'); return; }
    if (!body.trim() && !files.length) { setErr('Write something or attach a file'); return; }
    setBusy(true);
    try {
      let id = entryId;
      if (!id) {
        id = (await papi<{ id: number }>(`/api/projects/${pid}/brief`, { body: { type, body, tags: waiting ? ['waiting_on_client'] : [], allow_empty: files.length > 0 } })).id;
        setEntryId(id);
      }
      let failed = 0;
      for (const f of files) {
        if (f.done) continue;
        try {
          await uploadFile({ entity_type: 'brief_entry', entity_id: id }, f.file, f.description.trim(),
            (p) => setFiles((cur) => cur.map((x) => (x.key === f.key ? { ...x, progress: p, error: undefined } : x))));
          f.done = true;
          setFiles((cur) => cur.map((x) => (x.key === f.key ? { ...x, done: true, progress: 1 } : x)));
        } catch (e) {
          failed++;
          setFiles((cur) => cur.map((x) => (x.key === f.key ? { ...x, error: (e as Error).message } : x)));
        }
      }
      if (failed) { setErr(`The update was saved, but ${failed} file${failed > 1 ? 's' : ''} didn’t upload. Retry or remove them.`); return; }
      onDone();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={entryId ? onDone : onClose} title="Add brief update" size="lg"
      footer={<>
        <Btn variant="secondary" onClick={entryId ? onDone : onClose}>{entryId ? 'Close' : 'Cancel'}</Btn>
        <Btn onClick={save} disabled={busy}>{busy ? 'Saving…' : entryId ? 'Retry uploads' : 'Add update'}</Btn>
      </>}>
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Type" htmlFor="be-type">
            <select id="be-type" className={selectCls} value={type} disabled={!!entryId} onChange={(e) => setType(e.target.value as BriefType)}>
              {BRIEF_TYPES.map((t) => <option key={t} value={t}>{BRIEF_TYPE_LABELS[t]}</option>)}
            </select>
          </Field>
          <label className="flex items-end gap-2 pb-2 text-sm text-gray-700">
            <input type="checkbox" checked={waiting} disabled={!!entryId} onChange={(e) => setWaiting(e.target.checked)} />Waiting on client
          </label>
        </div>
        <Field label="What the client sent or asked for" htmlFor="be-body">
          <MarkdownEditor id="be-body" value={body} onChange={setBody} rows={6} placeholder="Requirements, content, links, feedback…" />
        </Field>
        <div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">Files</span>
            <Btn size="sm" variant="secondary" onClick={() => picker.current?.click()}><Paperclip className="h-4 w-4" />Attach files</Btn>
            <input ref={picker} type="file" multiple className="hidden" onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = ''; }} />
          </div>
          <p className="mt-0.5 text-xs text-gray-500">Any type, up to 50 MB each. You can also paste screenshots.</p>
          <ul className="mt-2 space-y-2">
            {files.map((f) => (
              <li key={f.key} className="rounded-lg border border-gray-200 p-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">{f.file.name}</span>
                  <span className="text-xs text-gray-400">{fmtSize(f.file.size)}</span>
                  {!busy && !f.done && <button type="button" aria-label={`Remove ${f.file.name}`} onClick={() => setFiles((c) => c.filter((x) => x.key !== f.key))} className="rounded p-0.5 text-gray-400 hover:bg-gray-100"><X className="h-4 w-4" /></button>}
                </div>
                <input className={cn(inputCls, 'mt-1.5 py-1.5')} placeholder="What is this file? (required)" value={f.description} disabled={busy || f.done}
                  onChange={(e) => setFiles((c) => c.map((x) => (x.key === f.key ? { ...x, description: e.target.value } : x)))} />
                {(busy || f.progress > 0) && (
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-100"><div className={cn('h-full rounded-full', f.error ? 'bg-red-500' : 'bg-primary-500')} style={{ width: `${Math.round(f.progress * 100)}%` }} /></div>
                )}
                {f.error && <p className="mt-1 text-xs text-red-600">{f.error}</p>}
              </li>
            ))}
          </ul>
        </div>
        {err && <p className="text-sm text-red-600" role="alert">{err}</p>}
      </div>
    </Modal>
  );
}

function EditEntryModal({ e, onClose, onDone }: { e: Entry; onClose: () => void; onDone: () => void }) {
  const [body, setBody] = useState(e.body);
  const [type, setType] = useState<BriefType>(e.type);
  const [waiting, setWaiting] = useState(e.tags.includes('waiting_on_client'));
  const [err, setErr] = useState<string | null>(null);
  const mode = briefEditMode(e.created_at);
  return (
    <Modal open onClose={onClose} title={e.is_original ? 'Edit original brief' : 'Edit brief update'} size="lg"
      footer={<>
        <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
        <Btn onClick={async () => {
          try { await papi(`/api/brief/${e.id}`, { method: 'PATCH', body: { body, type, tags: waiting ? ['waiting_on_client'] : [] } }); onDone(); }
          catch (er) { setErr((er as Error).message); }
        }}>Save</Btn>
      </>}>
      <div className="space-y-3">
        <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
          {mode === 'in_place' ? 'Added less than 24 hours ago: your change replaces the text (the old text stays in History).' : 'Older than 24 hours: saving creates a new version; earlier versions stay in History.'}
        </p>
        {!e.is_original && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Type" htmlFor={`ee-type-${e.id}`}>
              <select id={`ee-type-${e.id}`} className={selectCls} value={type} onChange={(ev) => setType(ev.target.value as BriefType)}>
                {BRIEF_TYPES.map((t) => <option key={t} value={t}>{BRIEF_TYPE_LABELS[t]}</option>)}
              </select>
            </Field>
            <label className="flex items-end gap-2 pb-2 text-sm text-gray-700"><input type="checkbox" checked={waiting} onChange={(ev) => setWaiting(ev.target.checked)} />Waiting on client</label>
          </div>
        )}
        <MarkdownEditor value={body} onChange={setBody} rows={8} />
        {err && <p className="text-sm text-red-600">{err}</p>}
      </div>
    </Modal>
  );
}

function HistoryModal({ e, onClose }: { e: Entry; onClose: () => void }) {
  const { data } = usePapi<{ id: number; version: number; type: BriefType; body: string; created_at: string; edited_by_name: string | null }[]>(`/api/brief/${e.id}/versions`);
  return (
    <Modal open onClose={onClose} title="Brief history" size="lg">
      {!data ? <Spinner /> : (
        <ol className="space-y-3">
          <li className="rounded-lg border border-primary-200 bg-primary-50/40 p-3">
            <p className="mb-1 text-xs font-semibold text-primary-700">Current · v{e.version}</p>
            <Markdown source={e.body || '_No text_'} />
          </li>
          {data.map((v) => (
            <li key={v.id} className="rounded-lg border border-gray-200 p-3">
              <p className="mb-1 text-xs text-gray-500">v{v.version} · replaced {relTime(v.created_at)}{v.edited_by_name ? ` by ${v.edited_by_name}` : ''}</p>
              <Markdown source={v.body || '_No text_'} />
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}

function DeletedEntries({ pid, onRestored }: { pid: number; onRestored: () => void }) {
  const { data, mutate } = usePapi<BriefList>(`/api/projects/${pid}/brief?deleted=1`);
  const toast = useToast();
  if (!data) return <Spinner />;
  if (!data.entries.length) return <p className="mt-2 text-sm text-gray-500">No deleted updates.</p>;
  return (
    <ul className="mt-2 divide-y divide-gray-100 rounded-xl border border-gray-200">
      {data.entries.map((e) => (
        <li key={e.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
          <span className="min-w-0 truncate">{BRIEF_TYPE_LABELS[e.type]}: {e.body.slice(0, 80) || 'No text'}</span>
          <Btn size="sm" variant="secondary" onClick={async () => {
            try { await papi(`/api/brief/${e.id}/restore`, { method: 'POST' }); mutate(); onRestored(); toast('Restored'); } catch (er) { toast((er as Error).message, 'error'); }
          }}><RotateCcw className="h-4 w-4" />Restore</Btn>
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ current brief (printable)

function CurrentBrief({ entries, files, tz, title, client }: { entries: Entry[]; files: Map<string, MediaFile[]>; tz: string; title: string; client: string }) {
  return (
    <div>
      <style>{`@media print {
        body * { visibility: hidden !important; }
        #brief-print, #brief-print * { visibility: visible !important; }
        #brief-print { position: absolute; left: 0; top: 0; width: 100%; padding: 24px; }
        #brief-print .no-print { display: none !important; }
      }`}</style>
      <div className="mb-3 flex justify-end"><Btn size="sm" variant="secondary" onClick={() => window.print()}><Printer className="h-4 w-4" />Print / save as PDF</Btn></div>
      <article id="brief-print" className="space-y-5">
        <header className="border-b border-gray-200 pb-3">
          <h2 className="text-lg font-bold text-gray-900">{title}</h2>
          <p className="text-sm text-gray-500">Client: {client} · Current brief as of {fmtInTz(new Date().toISOString(), PKT, { date: true, zone: true })}</p>
        </header>
        {entries.map((e) => {
          const fs = files.get(String(e.id)) || [];
          return (
            <section key={e.id} className="break-inside-avoid">
              <h3 className="text-sm font-semibold text-gray-800">
                {e.is_original ? 'Original brief' : BRIEF_TYPE_LABELS[e.type]}
                <span className="font-normal text-gray-500"> · {e.created_by_name || 'Someone'} · <When iso={e.created_at} tz={tz} /></span>
              </h3>
              <div className="mt-1 text-sm text-gray-900">{e.body.trim() ? <Markdown source={e.body} /> : <p className="text-gray-400">No text.</p>}</div>
              {fs.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-xs text-gray-600">
                  {fs.map((f) => <li key={f.id}>{f.file_name}{f.description ? ` — ${f.description}` : ''}</li>)}
                </ul>
              )}
            </section>
          );
        })}
      </article>
    </div>
  );
}
