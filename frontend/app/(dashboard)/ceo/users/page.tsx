'use client';

import { useState } from 'react';
import { UserPlus, Copy, Check } from 'lucide-react';
import { PageHeader, Panel, Btn, Spinner, ErrorNote, inputCls } from '@/components/training/ui';
import { papi, usePapi } from '@/components/projects/lib';
import { CeoOnly } from '@/components/ceo/guard';
import { useAuth } from '@/hooks/use-auth';

interface CeoUser { id: number; username: string; full_name: string; email: string | null; is_active: boolean; totp_enabled_at: string | null; invite_pending: boolean }

export default function CeoUsersPage() {
  const { user } = useAuth();
  const { data, error, mutate } = usePapi<CeoUser[]>('/api/ceo/users');
  const [f, setF] = useState({ username: '', full_name: '', email: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const admin = !!user?.admin_until && user.admin_until * 1000 > Date.now();

  async function run(fn: () => Promise<unknown>) {
    setMsg(null);
    try { await fn(); mutate(); } catch (e) { setMsg((e as Error).message); }
  }

  return (
    <CeoOnly>
      <PageHeader title="CEO accounts" subtitle="Only CEOs can see or change these. HR can’t." />
      {!admin && <p className="mb-4 rounded-xl bg-amber-50 px-4 py-2 text-sm text-amber-800">Turn on Admin mode (top right) to add, remove or re-invite CEO accounts.</p>}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel title="Accounts">
          {error && <ErrorNote error={error} />}
          {!data ? <Spinner /> : (
            <ul className="divide-y divide-gray-100 text-sm">
              {data.map((u) => (
                <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span>
                    <span className="font-medium text-gray-900">{u.full_name}</span> <span className="text-gray-500">@{u.username} · {u.email || 'no email'}</span>
                    <span className="ml-2 text-xs text-gray-500">{!u.is_active ? 'deactivated' : u.invite_pending ? 'invite pending' : u.totp_enabled_at ? '2-step on' : 'not signed in yet'}</span>
                  </span>
                  {admin && u.is_active && Number(u.id) !== Number(user?.id) && (
                    <span className="flex gap-1.5">
                      <Btn size="sm" variant="secondary" onClick={() => run(async () => setLink((await papi<{ invite_url: string }>(`/api/ceo/users/${u.id}/invite`, { method: 'POST' })).invite_url))}>New invite</Btn>
                      <Btn size="sm" variant="danger" onClick={() => window.confirm(`Deactivate ${u.full_name}?`) && run(() => papi(`/api/ceo/users/${u.id}`, { method: 'DELETE' }))}>Deactivate</Btn>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Add a CEO">
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); run(async () => {
            const r = await papi<{ invite_url: string }>('/api/ceo/users', { method: 'POST', body: f });
            setLink(r.invite_url); setF({ username: '', full_name: '', email: '' });
          }); }}>
            <input className={inputCls} placeholder="Full name" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} disabled={!admin} />
            <input className={inputCls} placeholder="Username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} disabled={!admin} />
            <input className={inputCls} type="email" placeholder="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} disabled={!admin} />
            <Btn type="submit" disabled={!admin || !f.username || !f.email}><UserPlus className="h-4 w-4" />Create and invite</Btn>
            <p className="text-xs text-gray-500">They get a single-use link (72 hours) to set a password, then set up an authenticator app.</p>
          </form>
          {link && (
            <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-2 text-xs">
              <p className="mb-1 text-gray-600">Invite link (also emailed if email is set up):</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all">{link}</code>
                <button type="button" aria-label="Copy link" onClick={() => navigator.clipboard.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); })} className="rounded p-1 hover:bg-white">
                  {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
            </div>
          )}
          {msg && <p className="mt-2 text-sm text-red-600">{msg}</p>}
        </Panel>
      </div>
    </CeoOnly>
  );
}
