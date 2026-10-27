'use client';

import { useState } from 'react';
import { LifeBuoy, GitPullRequest, Share2, Clock, Palmtree, ArrowRightLeft, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Btn, Pill, inputCls } from '@/components/training/ui';
import { Modal, Field, SectionCard, selectCls, useConfirm, useToast } from '@/components/projects/ui';
import { papi, usePapi, relTime, fmtDay, sameId } from '@/components/projects/lib';
import type { TicketDetail } from '@/components/tickets/lib';

export interface Collab {
  handoffs: { id: number; done: string; left_todo: string; branch: string | null; gotchas: string | null; created_at: string; created_by_name: string | null; from_names: string | null; to_names: string | null }[];
  help_requests: { id: number; status: string; skills: string[]; message: string; created_at: string; expires_at: string | null; requested_by: number | string; accepted_by: number | string | null; requested_by_name: string | null; accepted_by_name: string | null; asked: number }[];
  reviews: { id: number; status: string; pr_url: string | null; checklist: { item: string; done: boolean }[]; comments: string | null; created_at: string; decided_at: string | null; requested_by: number | string; reviewer_id: number | string; requested_by_name: string | null; reviewer_name: string | null }[];
  out_of_office: { id: number; name: string; until: string; note: string | null }[];
  access: { via: 'own' } | { via: 'grant'; level: 'view' | 'comment' | 'edit' };
}

export function useCollab(ticketId: number) {
  return usePapi<Collab>(`/api/tickets/${ticketId}/collab`, { refreshInterval: 30_000 });
}

interface Dev { id: number | string; name: string; skills: string[]; is_guest: boolean; out_until: string | null }

/** Banners at the top of a ticket: temporary access, assignees out of office, the latest handoff note (pinned). */
export function CollabBanners({ collab }: { collab: Collab | undefined }) {
  if (!collab) return null;
  const last = collab.handoffs[0];
  return (
    <>
      {collab.access.via === 'grant' && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900" role="status">
          <Clock className="mt-0.5 h-4 w-4 shrink-0" />
          <span>You’re here through {collab.access.level === 'view' ? 'view-only' : collab.access.level === 'comment' ? 'read + comment' : 'edit'} access that was shared with you. It ends automatically.</span>
        </div>
      )}
      {collab.out_of_office.map((o) => (
        <div key={o.id} className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">
          <Palmtree className="mt-0.5 h-4 w-4 shrink-0" />
          <span><strong>{o.name}</strong> is out of office until {fmtDay(o.until)}{o.note ? ` (${o.note})` : ''}.</span>
        </div>
      ))}
      {last && (
        <section className="mb-4 rounded-2xl border border-violet-200 bg-violet-50 p-4" aria-label="Latest handoff note">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-violet-900"><ArrowRightLeft className="h-4 w-4" />Handoff from {last.from_names || 'previous assignee'} to {last.to_names || 'new assignee'}</h2>
          <dl className="mt-2 grid gap-2 text-sm text-violet-950 sm:grid-cols-2">
            <div><dt className="text-xs font-semibold uppercase text-violet-700">Done</dt><dd className="whitespace-pre-wrap">{last.done}</dd></div>
            <div><dt className="text-xs font-semibold uppercase text-violet-700">Left</dt><dd className="whitespace-pre-wrap">{last.left_todo}</dd></div>
            {last.branch && <div><dt className="text-xs font-semibold uppercase text-violet-700">Branch</dt><dd className="font-mono text-xs">{last.branch}</dd></div>}
            {last.gotchas && <div><dt className="text-xs font-semibold uppercase text-violet-700">Gotchas</dt><dd className="whitespace-pre-wrap">{last.gotchas}</dd></div>}
          </dl>
          <p className="mt-2 text-xs text-violet-700">{last.created_by_name} · {relTime(last.created_at)}</p>
        </section>
      )}
    </>
  );
}

/** Header buttons: Request help, Request review, Share. */
export function CollabActions({ d, onChange }: { d: TicketDetail; onChange: () => void }) {
  const [open, setOpen] = useState<'help' | 'review' | 'share' | null>(null);
  const own = d.can.work && d.viewer_role !== 'agent';
  return (
    <>
      {own && <Btn size="sm" variant="ghost" onClick={() => setOpen('help')}><LifeBuoy className="h-4 w-4" />Help</Btn>}
      {own && <Btn size="sm" variant="ghost" onClick={() => setOpen('review')}><GitPullRequest className="h-4 w-4" />Review</Btn>}
      {d.viewer_role !== 'agent' && <Btn size="sm" variant="ghost" onClick={() => setOpen('share')}><Share2 className="h-4 w-4" />Share</Btn>}
      {open === 'help' && <HelpModal d={d} onClose={() => setOpen(null)} onDone={() => { setOpen(null); onChange(); }} />}
      {open === 'review' && <ReviewModal d={d} onClose={() => setOpen(null)} onDone={() => { setOpen(null); onChange(); }} />}
      {open === 'share' && <ShareDialog resourceType="ticket" resourceId={d.ticket.id} label={`${d.ticket.key} ${d.ticket.title}`}
        levels={d.can.edit ? ['view', 'comment', 'edit'] : ['view']} onClose={() => setOpen(null)} />}
    </>
  );
}

function HelpModal({ d, onClose, onDone }: { d: TicketDetail; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { data: devs } = usePapi<Dev[]>('/api/developers');
  const [mode, setMode] = useState<'skills' | 'people'>('skills');
  const [skills, setSkills] = useState('');
  const [people, setPeople] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const allSkills = Array.from(new Set((devs || []).flatMap((x) => x.skills))).sort();

  async function send() {
    setBusy(true); setErr(null);
    try {
      const body: Record<string, unknown> = { message };
      if (mode === 'skills') body.skills = skills.split(',').map((s) => s.trim()).filter(Boolean);
      else body.user_ids = people.map(Number);
      const r = await papi<{ asked: number[] }>(`/api/tickets/${d.ticket.id}/help`, { method: 'POST', body });
      toast(`Asked ${r.asked.length} developer${r.asked.length === 1 ? '' : 's'} for help`);
      onDone();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title={`Ask for help on ${d.ticket.key}`}
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn onClick={send} disabled={busy || !message.trim()}>{busy ? 'Sending…' : 'Ask'}</Btn></>}>
      <div className="space-y-3">
        <p className="text-sm text-gray-600">Whoever accepts can read this project, comment, and use its <strong>Development</strong> secrets for 3 days. The lead or HR can extend it.</p>
        <div role="radiogroup" className="inline-flex gap-1 rounded-xl bg-gray-100 p-1 text-sm">
          {(['skills', 'people'] as const).map((m) => (
            <button key={m} role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
              className={cn('rounded-lg px-3 py-1', mode === m ? 'bg-white shadow-sm' : 'text-gray-600')}>{m === 'skills' ? 'By skill' : 'Specific people'}</button>
          ))}
        </div>
        {mode === 'skills' ? (
          <Field label="Skills (comma separated)" htmlFor="help-skills" hint={allSkills.length ? `Known: ${allSkills.join(', ')}` : undefined}>
            <input id="help-skills" className={inputCls} value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="react, wordpress" />
          </Field>
        ) : (
          <fieldset className="max-h-48 space-y-1 overflow-y-auto">
            <legend className="mb-1 text-sm font-medium text-gray-700">Ask</legend>
            {(devs || []).map((x) => (
              <label key={x.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={people.includes(String(x.id))} onChange={(e) => setPeople(e.target.checked ? [...people, String(x.id)] : people.filter((p) => p !== String(x.id)))} />
                {x.name}{x.skills.length > 0 && <span className="text-xs text-gray-400">· {x.skills.join(', ')}</span>}
                {x.out_until && <Pill tone="amber">Out until {fmtDay(x.out_until)}</Pill>}
              </label>
            ))}
          </fieldset>
        )}
        <Field label="What do you need?" htmlFor="help-msg">
          <textarea id="help-msg" rows={3} className={inputCls} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} />
        </Field>
        {err && <p className="text-sm text-red-600">{err}</p>}
      </div>
    </Modal>
  );
}

function ReviewModal({ d, onClose, onDone }: { d: TicketDetail; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reviewer, setReviewer] = useState('');
  const [pr, setPr] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function send() {
    setBusy(true); setErr(null);
    try {
      const r = await papi<{ reviewer_id: number; moved_to_review: boolean }>(`/api/tickets/${d.ticket.id}/reviews`, {
        method: 'POST', body: { reviewer_id: reviewer || undefined, pr_url: pr || undefined },
      });
      const name = d.project_developers.find((x) => sameId(x.id, r.reviewer_id))?.name || 'a reviewer';
      toast(`Review requested from ${name}${r.moved_to_review ? ' — moved to In review' : ''}`);
      onDone();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title={`Request a review of ${d.ticket.key}`} size="sm"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn onClick={send} disabled={busy}>{busy ? 'Requesting…' : 'Request review'}</Btn></>}>
      <div className="space-y-3">
        <Field label="Reviewer" htmlFor="rv-who">
          <select id="rv-who" className={selectCls} value={reviewer} onChange={(e) => setReviewer(e.target.value)}>
            <option value="">Next in rotation (skips you and anyone out of office)</option>
            {d.project_developers.map((x) => <option key={x.id} value={String(x.id)}>{x.name}</option>)}
          </select>
        </Field>
        <Field label="Pull request link (optional)" htmlFor="rv-pr">
          <input id="rv-pr" className={inputCls} value={pr} onChange={(e) => setPr(e.target.value)} placeholder="https://github.com/…/pull/12" />
        </Field>
        {err && <p className="text-sm text-red-600">{err}</p>}
      </div>
    </Modal>
  );
}

/** Generic "share with a developer" dialog (tickets, files, saved views, Env variables). */
export function ShareDialog({ resourceType, resourceId, label, levels = ['view'], onClose, note }: {
  resourceType: 'ticket' | 'file' | 'saved_view' | 'vault_item'; resourceId: number | string; label: string;
  levels?: ('view' | 'comment' | 'edit')[]; onClose: () => void; note?: string;
}) {
  const toast = useToast();
  const { data: devs } = usePapi<Dev[]>('/api/developers');
  const [who, setWho] = useState('');
  const [level, setLevel] = useState(levels[0]);
  const [until, setUntil] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save() {
    setBusy(true); setErr(null);
    try {
      const r = await papi<{ scope: { pending_approval?: boolean } }>('/api/shares', {
        method: 'POST', body: { resource_type: resourceType, resource_id: resourceId, grantee_id: Number(who), level, expires_at: until ? new Date(until + 'T23:59:59').toISOString() : undefined },
      });
      toast(r.scope?.pending_approval ? 'Sent to HR for approval' : 'Shared');
      onClose();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title={`Share ${label}`} size="sm"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn onClick={save} disabled={busy || !who}>{busy ? 'Sharing…' : 'Share'}</Btn></>}>
      <div className="space-y-3">
        {note && <p className="text-sm text-gray-600">{note}</p>}
        <Field label="Developer" htmlFor="sh-who">
          <select id="sh-who" className={selectCls} value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">Pick someone…</option>
            {(devs || []).map((x) => <option key={x.id} value={String(x.id)}>{x.name}{x.is_guest ? ' (guest)' : ''}</option>)}
          </select>
        </Field>
        {levels.length > 1 && (
          <Field label="They can" htmlFor="sh-level">
            <select id="sh-level" className={selectCls} value={level} onChange={(e) => setLevel(e.target.value as any)}>
              {levels.map((l) => <option key={l} value={l}>{l === 'view' ? 'View' : l === 'comment' ? 'View and comment' : 'Edit'}</option>)}
            </select>
          </Field>
        )}
        <Field label="Until (optional)" htmlFor="sh-until" hint="Leave empty to keep it until you end it.">
          <input id="sh-until" type="date" className={inputCls} value={until} onChange={(e) => setUntil(e.target.value)} />
        </Field>
        {err && <p className="text-sm text-red-600">{err}</p>}
      </div>
    </Modal>
  );
}

/** Sidebar panel: reviews (decide / cancel) and help requests (extend / cancel). */
export function CollabPanel({ d, collab, meId, onChange }: { d: TicketDetail; collab: Collab | undefined; meId: number | undefined; onChange: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [deciding, setDeciding] = useState<{ id: number; action: 'approve' | 'request_changes' } | null>(null);
  const [comments, setComments] = useState('');
  if (!collab || (!collab.reviews.length && !collab.help_requests.length)) return null;
  const isHr = d.viewer_role === 'hr';
  const isLead = d.project_developers.some((p) => sameId(p.id, meId) && p.member_role === 'lead_developer');

  async function act(url: string, body: Record<string, unknown>, ok: string) {
    try { await papi(url, { method: 'POST', body }); toast(ok); onChange(); } catch (e) { toast((e as Error).message, 'error'); }
  }

  return (
    <SectionCard title="Reviews & help">
      <ul className="space-y-3 text-sm">
        {collab.reviews.map((r) => (
          <li key={`r${r.id}`} className="rounded-lg border border-gray-200 p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-gray-800"><GitPullRequest className="mr-1 inline h-3.5 w-3.5" />Review by {r.reviewer_name}</span>
              <Pill tone={r.status === 'approved' ? 'green' : r.status === 'changes_requested' ? 'amber' : r.status === 'cancelled' ? 'gray' : 'blue'}>
                {r.status.replace('_', ' ')}
              </Pill>
            </div>
            {r.pr_url && <a href={r.pr_url} target="_blank" rel="noreferrer" className="mt-1 block truncate text-xs text-primary-600 hover:underline">{r.pr_url}</a>}
            {r.comments && <p className="mt-1 whitespace-pre-wrap text-xs text-gray-600">{r.comments}</p>}
            {r.status === 'requested' && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(sameId(r.reviewer_id, meId) || isHr) && <>
                  <Btn size="sm" variant="success" onClick={() => { setComments(''); setDeciding({ id: r.id, action: 'approve' }); }}><Check className="h-3.5 w-3.5" />Approve</Btn>
                  <Btn size="sm" variant="secondary" onClick={() => { setComments(''); setDeciding({ id: r.id, action: 'request_changes' }); }}>Request changes</Btn>
                </>}
                {(sameId(r.requested_by, meId) || isHr) && <Btn size="sm" variant="ghost" onClick={() => act(`/api/reviews/${r.id}`, { action: 'cancel' }, 'Review cancelled')}>Cancel</Btn>}
              </div>
            )}
          </li>
        ))}
        {collab.help_requests.map((h) => (
          <li key={`h${h.id}`} className="rounded-lg border border-gray-200 p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-gray-800"><LifeBuoy className="mr-1 inline h-3.5 w-3.5" />Help {h.accepted_by_name ? `from ${h.accepted_by_name}` : 'asked'}</span>
              <Pill tone={h.status === 'accepted' ? 'green' : h.status === 'open' ? 'blue' : 'gray'}>{h.status}</Pill>
            </div>
            <p className="mt-1 text-xs text-gray-600">{h.message}</p>
            {h.expires_at && h.status === 'accepted' && <p className="mt-1 text-xs text-gray-500">Access until {fmtDay(h.expires_at.slice(0, 10))}</p>}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {h.status === 'accepted' && (isLead || isHr) && <Btn size="sm" variant="secondary" onClick={() => act(`/api/help-requests/${h.id}`, { action: 'extend', days: 3 }, 'Extended by 3 days')}>Extend 3 days</Btn>}
              {(h.status === 'open' || h.status === 'accepted') && (sameId(h.requested_by, meId) || isHr) && (
                <Btn size="sm" variant="ghost" onClick={async () => {
                  if (await confirm({ title: 'End this help request?', body: h.status === 'accepted' ? 'The helper loses access now.' : undefined, confirmLabel: 'End it', danger: true })) {
                    act(`/api/help-requests/${h.id}`, { action: 'cancel' }, 'Help request ended');
                  }
                }}><X className="h-3.5 w-3.5" />End</Btn>
              )}
            </div>
          </li>
        ))}
      </ul>
      <Modal open={!!deciding} onClose={() => setDeciding(null)} title={deciding?.action === 'approve' ? 'Approve' : 'Request changes'} size="sm"
        footer={<>
          <Btn variant="secondary" onClick={() => setDeciding(null)}>Cancel</Btn>
          <Btn disabled={deciding?.action === 'request_changes' && !comments.trim()}
            onClick={async () => { const x = deciding!; setDeciding(null); await act(`/api/reviews/${x.id}`, { action: x.action, comments: comments || undefined }, x.action === 'approve' ? 'Approved' : 'Changes requested'); }}>
            {deciding?.action === 'approve' ? 'Approve' : 'Send back'}
          </Btn>
        </>}>
        <Field label={deciding?.action === 'approve' ? 'Comment (optional)' : 'What needs to change?'} htmlFor="rv-comments">
          <textarea id="rv-comments" rows={4} className={inputCls} value={comments} onChange={(e) => setComments(e.target.value)} />
        </Field>
      </Modal>
    </SectionCard>
  );
}

/** Fields for a handoff note (shown when reassigning work that's in progress). */
export function HandoffFields({ value, onChange }: { value: { done: string; left: string; branch: string; gotchas: string }; onChange: (v: { done: string; left: string; branch: string; gotchas: string }) => void }) {
  return (
    <div className="space-y-2 rounded-xl border border-violet-200 bg-violet-50 p-3">
      <p className="text-sm font-medium text-violet-900">Handoff note — this ticket is in progress</p>
      <Field label="What’s done" htmlFor="ho-done"><textarea id="ho-done" rows={2} className={inputCls} value={value.done} onChange={(e) => onChange({ ...value, done: e.target.value })} /></Field>
      <Field label="What’s left" htmlFor="ho-left"><textarea id="ho-left" rows={2} className={inputCls} value={value.left} onChange={(e) => onChange({ ...value, left: e.target.value })} /></Field>
      <Field label="Branch" htmlFor="ho-branch"><input id="ho-branch" className={cn(inputCls, 'font-mono text-xs')} value={value.branch} onChange={(e) => onChange({ ...value, branch: e.target.value })} /></Field>
      <Field label="Gotchas" htmlFor="ho-gotchas"><textarea id="ho-gotchas" rows={2} className={inputCls} value={value.gotchas} onChange={(e) => onChange({ ...value, gotchas: e.target.value })} /></Field>
    </div>
  );
}
