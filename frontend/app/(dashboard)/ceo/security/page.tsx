'use client';

import { useState } from 'react';
import { LogOut, ShieldCheck, Ban, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader, Panel, Btn, Spinner, ErrorNote, inputCls } from '@/components/training/ui';
import { papi, usePapi, relTime } from '@/components/projects/lib';
import { CeoOnly } from '@/components/ceo/guard';
import { useAuth } from '@/hooks/use-auth';

interface Session { id: string; created_at: string; last_seen_at: string; expires_at: string; ip: string | null; user_agent: string | null; revoked_at: string | null; current: boolean }
interface AccessRow { id: number; ceo_name: string; kind: string; target: string; reason: string | null; created_at: string }
interface AuditRow { id: number; ceo_name: string; method: string; path: string; target: string | null; created_at: string }
interface Revocation { id: number; user_name: string; user_role: string; ticket_no: string | null; reason: string | null; revoked_by_name: string; created_at: string }

const KIND: Record<string, string> = { vault_reveal: 'Revealed a secret', payroll_person: 'Opened someone’s pay', one_on_one: 'Read 1:1 notes', dm: 'Read a private chat', view_as: 'Viewed as' };

function browser(ua: string | null) {
  const u = ua || '';
  const b = u.match(/(Edg|OPR|Firefox|Chrome|Safari)\/[\d.]+/)?.[1] || 'Browser';
  const os = u.match(/(Windows|Mac OS X|Android|iPhone|iPad|Linux)/)?.[1] || '';
  return `${b === 'Edg' ? 'Edge' : b === 'OPR' ? 'Opera' : b}${os ? ` on ${os.replace('Mac OS X', 'macOS')}` : ''}`;
}

export default function SecurityPage() {
  const { logout } = useAuth();
  const sessions = usePapi<Session[]>('/api/auth/sessions');
  const [tab, setTab] = useState<'access' | 'audit'>('access');
  const log = usePapi<(AccessRow | AuditRow)[]>(`/api/ceo/access-log?type=${tab}`);
  const revs = usePapi<Revocation[]>('/api/ceo/vault-revocations');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [rev, setRev] = useState({ user: '', project: '', reason: '' });
  const people = usePapi<{ id: number; full_name: string; role: string }[]>('/api/ceo/people?q=');

  async function signOutEverywhere() {
    if (!window.confirm('Sign out of every session, including this one?')) return;
    setBusy(true);
    try { await papi('/api/auth/sessions', { method: 'POST', body: { all: true } }); logout(); } finally { setBusy(false); }
  }
  async function revoke(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      await papi('/api/ceo/vault-revocations', { method: 'POST', body: { user_id: Number(rev.user), project_id: rev.project ? Number(rev.project) : null, reason: rev.reason } });
      setRev({ user: '', project: '', reason: '' }); revs.mutate(); setMsg('Access revoked.');
    } catch (err) { setMsg((err as Error).message); }
  }

  return (
    <CeoOnly>
      <PageHeader title="Security" subtitle="Your sessions, who looked at what, and Env access." />
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Your sessions" action={<Btn size="sm" variant="danger" onClick={signOutEverywhere} disabled={busy}><LogOut className="h-4 w-4" />Sign out everywhere</Btn>}>
          {sessions.error && <ErrorNote error={sessions.error} />}
          {!sessions.data ? <Spinner /> : (
            <ul className="divide-y divide-gray-100 text-sm">
              {sessions.data.map((s) => {
                const live = !s.revoked_at && new Date(s.expires_at).getTime() > Date.now();
                return (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      <span className="font-medium text-gray-900">{browser(s.user_agent)}</span>
                      <span className="text-gray-500"> · {s.ip || 'unknown IP'} · signed in {relTime(s.created_at)}</span>
                      {s.current && <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700">This device</span>}
                    </span>
                    <span className={cn('text-xs', live ? 'text-emerald-700' : 'text-gray-400')}>{live ? `active, last seen ${relTime(s.last_seen_at)}` : s.revoked_at ? 'signed out' : 'expired'}</span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-3 flex items-center gap-1.5 text-xs text-gray-500"><ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />Two-step sign-in is on for your account. Sessions last 12 hours; new devices trigger an email.</p>
        </Panel>

        <Panel title="Revoke Env (secrets) access">
          <form onSubmit={revoke} className="grid gap-2 sm:grid-cols-2">
            <select className={inputCls} value={rev.user} onChange={(e) => setRev({ ...rev, user: e.target.value })} required aria-label="Person">
              <option value="">Person…</option>
              {(people.data || []).map((p) => <option key={p.id} value={p.id}>{p.full_name} ({p.role})</option>)}
            </select>
            <input className={inputCls} placeholder="Project id (blank = all projects)" value={rev.project} onChange={(e) => setRev({ ...rev, project: e.target.value.replace(/\D/g, '') })} />
            <input className={cn(inputCls, 'sm:col-span-2')} placeholder="Reason" value={rev.reason} onChange={(e) => setRev({ ...rev, reason: e.target.value })} />
            <div className="sm:col-span-2 flex items-center justify-between gap-2">
              <span className="text-xs text-gray-500">Takes effect immediately. Restoring needs Admin mode.</span>
              <Btn size="sm" variant="danger" type="submit" disabled={!rev.user}><Ban className="h-4 w-4" />Revoke</Btn>
            </div>
            {msg && <p className="sm:col-span-2 text-sm text-gray-700">{msg}</p>}
          </form>
          <ul className="mt-3 divide-y divide-gray-100 text-sm">
            {(revs.data || []).map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                <span><span className="font-medium">{r.user_name}</span> <span className="text-gray-500">· {r.ticket_no || 'all projects'} · by {r.revoked_by_name} {relTime(r.created_at)}{r.reason ? ` · ${r.reason}` : ''}</span></span>
                <Btn size="sm" variant="ghost" onClick={async () => { try { await papi(`/api/ceo/vault-revocations?id=${r.id}`, { method: 'DELETE' }); revs.mutate(); } catch (e) { setMsg((e as Error).message); } }}><RotateCcw className="h-4 w-4" />Restore</Btn>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel className="xl:col-span-2" title={
          <span className="inline-flex gap-1 rounded-lg bg-gray-100 p-1">
            {(['access', 'audit'] as const).map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)} className={cn('rounded-md px-2.5 py-1 text-xs font-semibold', tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600')}>
                {t === 'access' ? 'What CEOs looked at' : 'Admin-mode changes'}
              </button>
            ))}
          </span>
        }>
          {!log.data ? <Spinner /> : !log.data.length ? <p className="text-sm text-gray-500">Nothing yet.</p> : (
            <ul className="divide-y divide-gray-100 text-sm">
              {log.data.map((r: any) => (
                <li key={r.id} className="flex flex-wrap justify-between gap-2 py-2">
                  <span>
                    <span className="font-medium text-gray-900">{r.ceo_name}</span>{' '}
                    {tab === 'access' ? <>{KIND[r.kind] || r.kind}: {r.target}{r.reason ? <span className="text-gray-500"> — “{r.reason}”</span> : null}</>
                      : <span className="font-mono text-xs">{r.method} {r.path}{r.target || ''}</span>}
                  </span>
                  <time className="text-xs text-gray-400">{new Date(r.created_at).toLocaleString('en-GB', { timeZone: 'Asia/Karachi', dateStyle: 'medium', timeStyle: 'short' })} PKT</time>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </CeoOnly>
  );
}
