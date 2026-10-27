'use client';

import { useState } from 'react';
import { Github, ExternalLink, Activity, GitMerge, GitBranch, GitPullRequest, Rocket, MonitorPlay, CheckCircle2, PenLine, Upload, X, Link2, Unlink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Btn, Empty, ErrorNote, Spinner, inputCls } from '@/components/training/ui';
import { Modal, Field, SectionCard, selectCls, useConfirm, useToast } from './ui';
import { papi, usePapi, ProjectDetail, relTime, fmtExact } from './lib';
import { Markdown } from '@/components/training/markdown';
import { Attachments } from '@/components/tickets/Attachments';
import { uploadFile, TicketCard, TICKET_STATUS_LABELS, WORK_STATUSES, fmtSize } from '@/components/tickets/lib';

// ------------------------------------------------------------------ health

const HEALTH_STYLE = {
  green: 'bg-emerald-100 text-emerald-800',
  yellow: 'bg-amber-100 text-amber-800',
  red: 'bg-red-100 text-red-700',
} as const;
const HEALTH_LABEL = { green: 'On track', yellow: 'Quiet 3+ days', red: 'At risk' } as const;
const HEALTH_HINT = {
  green: 'Activity in the last 3 days',
  yellow: 'No activity for 3–6 days',
  red: 'No activity for 7+ days, or past its deadline',
} as const;

export function HealthPill({ health, className }: { health?: 'green' | 'yellow' | 'red' | null; className?: string }) {
  if (!health) return null;
  return (
    <span title={HEALTH_HINT[health]} className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap', HEALTH_STYLE[health], className)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', health === 'green' ? 'bg-emerald-500' : health === 'yellow' ? 'bg-amber-500' : 'bg-red-500')} aria-hidden />
      {HEALTH_LABEL[health]}
    </span>
  );
}

// ------------------------------------------------------------------ feed

export interface ActivityRow {
  id: number; project_id: number; ticket_id: number | null; ticket_key: string | null; actor_name: string | null; github_login: string | null;
  kind: string; summary: string; url: string | null; occurred_at: string; source: string;
}

const KIND_ICON: Record<string, typeof Activity> = {
  push: GitBranch, branch: GitBranch, pr_opened: GitPullRequest, pr_merged: GitMerge, deploy_production: Rocket,
  deploy_staging: MonitorPlay, work_update: PenLine, ticket_done: CheckCircle2,
};

export function ActivityFeed({ rows, empty }: { rows: ActivityRow[]; empty?: string }) {
  if (!rows.length) return <p className="text-sm text-gray-500">{empty || 'Nothing yet.'}</p>;
  return (
    <ol className="space-y-3">
      {rows.map((a) => {
        const I = KIND_ICON[a.kind] || Activity;
        const external = a.url && /^https?:\/\//.test(a.url);
        return (
          <li key={a.id} className="flex gap-3">
            <span className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
              a.kind === 'deploy_production' ? 'bg-emerald-100 text-emerald-700' : a.kind === 'pr_merged' ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-600')}>
              <I className="h-3.5 w-3.5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-gray-800 break-words">
                {a.url ? <a href={a.url} target={external ? '_blank' : undefined} rel="noreferrer" className="hover:underline">{a.summary}</a> : a.summary}
                {external && <ExternalLink className="ml-1 inline h-3 w-3 text-gray-400" aria-hidden />}
              </p>
              <p className="text-xs text-gray-400" title={fmtExact(a.occurred_at)}>
                {relTime(a.occurred_at)}{a.ticket_key ? ` · ${a.ticket_key}` : ''}{a.source === 'github' ? ' · GitHub' : ''}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Activity for one ticket (ticket page). */
export function TicketActivity({ projectId, ticketId }: { projectId: number; ticketId: number }) {
  const { data } = usePapi<ActivityRow[]>(`/api/projects/${projectId}/activity?ticket_id=${ticketId}&limit=30`, { refreshInterval: 30_000 });
  if (!data?.length) return null;
  return <SectionCard title="Activity"><ActivityFeed rows={data} /></SectionCard>;
}

// ------------------------------------------------------------------ tab

interface RepoInfo {
  repo: { full_name: string; html_url: string | null; default_branch: string; linked_at: string } | null;
  access: { user_id: number; name: string | null; github_login: string; permission: string }[];
  tracking_source: 'github' | 'manual'; production_env_name: string; staging_url: string | null; ready_to_deliver_at: string | null;
  github_configured: boolean; suggested_name: string;
}
interface WorkUpdate {
  id: number; user_id: number | string; user_name: string | null; body: string; created_at: string;
  tickets: { id: number; key: string; title: string }[];
}

export function ActivityTab({ d, meId }: { d: ProjectDetail; meId: number | string | undefined }) {
  const p = d.project;
  const isHr = d.permissions.role === 'hr';
  const { data: repo, mutate: mutateRepo } = usePapi<RepoInfo>(`/api/projects/${p.id}/repo`, { refreshInterval: 60_000 });
  const { data: feed, error, mutate: mutateFeed } = usePapi<ActivityRow[]>(`/api/projects/${p.id}/activity?limit=100`, { refreshInterval: 30_000 });
  const { data: wu, mutate: mutateWu } = usePapi<{ updates: WorkUpdate[]; can_post: boolean }>(`/api/projects/${p.id}/work-updates`, { refreshInterval: 30_000 });
  const manual = (repo?.tracking_source || p.tracking_source) !== 'github';
  const refresh = () => { mutateFeed(); mutateWu(); mutateRepo(); };

  return (
    <div className="space-y-4">
      <SectionCard title={<span className="inline-flex items-center gap-1.5"><Activity className="h-4 w-4" />Tracking</span>}
        action={<HealthPill health={p.health} />}>
        {!repo ? <Spinner label="Loading…" /> : <TrackingPanel p={d} info={repo} isHr={isHr} onChange={refresh} />}
      </SectionCard>

      {manual && wu?.can_post && <WorkUpdateComposer d={d} onPosted={refresh} />}

      {manual && wu && wu.updates.length > 0 && (
        <SectionCard title="Work updates">
          <ul className="space-y-4">
            {wu.updates.map((w) => <WorkUpdateItem key={w.id} w={w} d={d} meId={meId} isHr={isHr} onChange={refresh} />)}
          </ul>
        </SectionCard>
      )}

      <SectionCard title="What happened">
        {error && <ErrorNote error={error} />}
        {!feed ? <Spinner label="Loading activity…" /> : (
          <ActivityFeed rows={feed} empty={manual ? 'No activity yet. Work updates and finished tickets show up here.' : 'No activity yet. Pushes, pull requests and deploys show up here automatically.'} />
        )}
      </SectionCard>
    </div>
  );
}

function TrackingPanel({ p, info, isHr, onChange }: { p: ProjectDetail; info: RepoInfo; isHr: boolean; onChange: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [linkOpen, setLinkOpen] = useState(false);
  const [fullName, setFullName] = useState('');
  const [busy, setBusy] = useState(false);
  const [envName, setEnvName] = useState(info.production_env_name);

  async function run(fn: () => Promise<unknown>, msg: string) {
    setBusy(true);
    try { await fn(); toast(msg); onChange(); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-3 text-sm">
      {info.repo ? (
        <div className="flex flex-wrap items-center gap-2">
          <Github className="h-4 w-4 text-gray-700" aria-hidden />
          <a href={info.repo.html_url || '#'} target="_blank" rel="noreferrer" className="font-medium text-gray-900 hover:underline">{info.repo.full_name}</a>
          <span className="text-xs text-gray-500">· tracked automatically from GitHub</span>
        </div>
      ) : (
        <p className="text-gray-600">
          {info.tracking_source === 'manual'
            ? 'Manual tracking — developers post a short work update each day they work on it.'
            : 'GitHub tracking is on, but no repo is linked yet.'}
        </p>
      )}
      {info.staging_url && (
        <p className="flex items-center gap-1.5"><MonitorPlay className="h-4 w-4 text-gray-500" aria-hidden />Latest staging preview:{' '}
          <a href={info.staging_url} target="_blank" rel="noreferrer" className="break-all text-primary-700 hover:underline">{info.staging_url}</a></p>
      )}
      {info.ready_to_deliver_at && !['delivered', 'closed'].includes(p.project.status) && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800">Deployed to production {relTime(info.ready_to_deliver_at)} — ready to deliver.</p>
      )}

      {isHr && (
        <div className="flex flex-wrap items-end gap-2 border-t border-gray-100 pt-3">
          {!info.repo ? (
            <>
              <Btn size="sm" disabled={busy || !info.github_configured} onClick={() => run(() => papi(`/api/projects/${p.project.id}/repo`, { method: 'POST', body: { action: 'create' } }), 'Repo created')}>
                <Github className="h-4 w-4" />Create repo {info.suggested_name}
              </Btn>
              <Btn size="sm" variant="secondary" disabled={busy || !info.github_configured} onClick={() => setLinkOpen(true)}><Link2 className="h-4 w-4" />Link existing repo</Btn>
              <Btn size="sm" variant="ghost" disabled={busy} onClick={() => run(() => papi(`/api/projects/${p.project.id}/tracking`, { method: 'PATCH', body: { tracking_source: info.tracking_source === 'manual' ? 'github' : 'manual' } }), 'Tracking updated')}>
                Switch to {info.tracking_source === 'manual' ? 'GitHub' : 'manual'} tracking
              </Btn>
              {!info.github_configured && <span className="text-xs text-gray-500">GitHub isn’t configured on the server yet.</span>}
            </>
          ) : (
            <Btn size="sm" variant="ghost" disabled={busy} onClick={async () => {
              if (await confirm({ title: 'Unlink the repo?', body: 'Tracking switches to manual. The repo on GitHub is not deleted.', confirmLabel: 'Unlink', danger: true })) {
                run(() => papi(`/api/projects/${p.project.id}/repo`, { method: 'DELETE' }), 'Repo unlinked');
              }
            }}><Unlink className="h-4 w-4" />Unlink repo</Btn>
          )}
          <label className="ml-auto flex items-center gap-2 text-xs text-gray-600">
            Production environment
            <input className={cn(inputCls, 'w-36 py-1 text-sm')} value={envName} onChange={(e) => setEnvName(e.target.value)}
              onBlur={() => envName.trim() && envName !== info.production_env_name && run(() => papi(`/api/projects/${p.project.id}/tracking`, { method: 'PATCH', body: { production_env_name: envName } }), 'Saved')} />
          </label>
        </div>
      )}
      {isHr && info.access.length > 0 && (
        <p className="text-xs text-gray-500">Repo access: {info.access.map((a) => `${a.name || a.github_login} (${a.permission === 'push' ? 'write' : 'read'})`).join(', ')}</p>
      )}

      <Modal open={linkOpen} onClose={() => setLinkOpen(false)} title="Link an existing repo" size="sm"
        footer={<>
          <Btn variant="secondary" onClick={() => setLinkOpen(false)}>Cancel</Btn>
          <Btn disabled={busy || !fullName.trim()} onClick={() => { setLinkOpen(false); run(() => papi(`/api/projects/${p.project.id}/repo`, { method: 'POST', body: { full_name: fullName.trim() } }), 'Repo linked'); }}>Link</Btn>
        </>}>
        <Field label="Repository (owner/name)" htmlFor="repo-full" hint="Recurring clients can reuse their old repo.">
          <input id="repo-full" className={inputCls} value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="bytesplatform/PRJ-0012-acme-dental" />
        </Field>
      </Modal>
    </div>
  );
}

function WorkUpdateComposer({ d, onPosted }: { d: ProjectDetail; onPosted: () => void }) {
  const toast = useToast();
  const { data: tickets } = usePapi<TicketCard[]>(`/api/projects/${d.project.id}/tickets?view=work`);
  const [body, setBody] = useState('');
  const [picked, setPicked] = useState<Record<number, string>>({}); // ticket id → new status ('' = no change)
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);

  async function post() {
    setBusy(true);
    try {
      const ids = Object.keys(picked).map(Number);
      const moves = ids.filter((id) => picked[id]).map((id) => ({ ticket_id: id, status: picked[id], confirm_blocked: true }));
      const r = await papi<{ id: number; moves: { ticket_id: number; ok: boolean; error?: string }[] }>(`/api/projects/${d.project.id}/work-updates`,
        { method: 'POST', body: { body, ticket_ids: ids, status_moves: moves } });
      for (const f of files) await uploadFile({ entity_type: 'work_update', entity_id: r.id }, f, '');
      const failed = r.moves.filter((m) => !m.ok);
      toast(failed.length ? `Posted. ${failed.length} status change${failed.length > 1 ? 's' : ''} failed: ${failed[0].error}` : 'Update posted', failed.length ? 'error' : 'success');
      setBody(''); setPicked({}); setFiles([]);
      onPosted();
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }

  return (
    <SectionCard title={<span className="inline-flex items-center gap-1.5"><PenLine className="h-4 w-4" />Post today’s work update</span>}>
      <div className="space-y-3">
        <textarea className={inputCls} rows={4} value={body} onChange={(e) => setBody(e.target.value)} aria-label="Work update"
          placeholder="What did you do today? e.g. Built the booking page, waiting on the client's logo." />
        {!!tickets?.length && (
          <details className="rounded-lg border border-gray-200 p-2">
            <summary className="cursor-pointer text-sm text-gray-700">Link tickets {Object.keys(picked).length ? `(${Object.keys(picked).length})` : ''}</summary>
            <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
              {tickets.map((t) => {
                const on = t.id in picked;
                return (
                  <li key={t.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <label className="flex min-w-0 flex-1 items-center gap-2">
                      <input type="checkbox" checked={on} onChange={() => setPicked((x) => { const n = { ...x }; on ? delete n[t.id] : (n[t.id] = ''); return n; })} />
                      <span className="font-mono text-xs text-gray-500">{t.key}</span><span className="truncate">{t.title}</span>
                    </label>
                    {on && (
                      <select className={cn(selectCls, 'w-auto py-1 text-xs')} value={picked[t.id]} aria-label={`New status for ${t.key}`}
                        onChange={(e) => setPicked((x) => ({ ...x, [t.id]: e.target.value }))}>
                        <option value="">No status change ({TICKET_STATUS_LABELS[t.status]})</option>
                        {WORK_STATUSES.filter((s) => s !== t.status).map((s) => <option key={s} value={s}>→ {TICKET_STATUS_LABELS[s]}</option>)}
                      </select>
                    )}
                  </li>
                );
              })}
            </ul>
          </details>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
            <Upload className="h-4 w-4" />Add files
            <input type="file" multiple className="hidden" onChange={(e) => { setFiles((f) => [...f, ...Array.from(e.target.files || [])]); e.target.value = ''; }} />
          </label>
          {files.map((f, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-0.5 text-xs">
              {f.name} · {fmtSize(f.size)}
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}><X className="h-3 w-3" /></button>
            </span>
          ))}
          <Btn className="ml-auto" disabled={busy || !body.trim()} onClick={post}>{busy ? 'Posting…' : 'Post update'}</Btn>
        </div>
      </div>
    </SectionCard>
  );
}

function WorkUpdateItem({ w, d, meId, isHr, onChange }: { w: WorkUpdate; d: ProjectDetail; meId: number | string | undefined; isHr: boolean; onChange: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const mine = String(w.user_id) === String(meId);
  return (
    <li className="border-b border-gray-100 pb-4 last:border-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-gray-900">{w.user_name || 'Someone'} <span className="font-normal text-gray-400" title={fmtExact(w.created_at)}>· {relTime(w.created_at)}</span></p>
        {(mine || isHr) && (
          <button className="text-xs text-gray-400 hover:text-red-600" onClick={async () => {
            if (!(await confirm({ title: 'Delete this update?', confirmLabel: 'Delete', danger: true }))) return;
            try { await papi(`/api/work-updates/${w.id}`, { method: 'DELETE' }); onChange(); } catch (e) { toast((e as Error).message, 'error'); }
          }}>Delete</button>
        )}
      </div>
      <div className="mt-1 text-sm text-gray-700"><Markdown source={w.body} /></div>
      {w.tickets.length > 0 && (
        <p className="mt-1 flex flex-wrap gap-1.5 text-xs">
          {w.tickets.map((t) => <a key={t.id} href={`/projects/${d.project.id}/tickets/${t.key}`} className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-gray-700 hover:bg-gray-200">{t.key}</a>)}
        </p>
      )}
      <Attachments target={{ entity_type: 'work_update', entity_id: w.id }} meId={meId} isHr={isHr} canUpload={false} requireDescription={false} className="mt-2" />
    </li>
  );
}
