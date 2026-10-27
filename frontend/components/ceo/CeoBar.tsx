'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldAlert, ShieldCheck, Eye, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';

function token() {
  try { return localStorage.getItem('token'); } catch { return null; }
}

async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const t = token();
  const res = await fetch(path, {
    method, cache: 'no-store',
    headers: { ...(t ? { Authorization: `Bearer ${t}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const j = await res.json().catch(() => null);
  if (!res.ok || j?.status === 'error') throw new Error(j?.message || `Request failed (${res.status})`);
  return j.data as T;
}

const HOME: Record<string, string> = { agent: '/agent', developer: '/projects', hr: '/hr' };

/** Top-right bar for CEOs: Admin mode switch (30 min, password) and "View as". */
export function CeoBar() {
  const { user, applyToken } = useAuth();
  const router = useRouter();
  const [now, setNow] = useState(Date.now());
  const [askPw, setAskPw] = useState(false);
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (!user?.isCeo) return null;

  const until = user.admin_until ? user.admin_until * 1000 : 0;
  const left = Math.max(0, until - now);
  const on = left > 0;
  const mmss = `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`;

  async function turnOn(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      const r = await api<{ token: string }>('/api/auth/admin-mode', 'POST', { password: pw });
      await applyToken(r.token);
      setAskPw(false); setPw('');
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function turnOff() {
    try { const r = await api<{ token: string }>('/api/auth/admin-mode', 'DELETE'); await applyToken(r.token); } catch { /* token still fine */ }
  }

  return (
    <>
      <div className="fixed right-4 top-3 z-30 flex items-center gap-2">
        <button type="button" onClick={() => setPicker(true)}
          className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm hover:bg-gray-50">
          <Eye className="h-3.5 w-3.5" />View as…
        </button>
        {on ? (
          <button type="button" onClick={turnOff} title="Turn Admin mode off"
            className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-red-700">
            <ShieldAlert className="h-3.5 w-3.5" />Admin mode ON · {mmss}
          </button>
        ) : (
          <button type="button" onClick={() => { setAskPw(true); setErr(null); }}
            className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm hover:bg-gray-50">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />View only · Admin mode off
          </button>
        )}
      </div>

      {askPw && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setAskPw(false); }}>
          <form onSubmit={turnOn} role="dialog" aria-modal="true" aria-label="Turn on Admin mode" className="w-full max-w-sm space-y-3 rounded-2xl bg-white p-5 shadow-xl">
            <h2 className="text-base font-semibold text-gray-900">Turn on Admin mode</h2>
            <p className="text-sm text-gray-600">For 30 minutes you can change anything HR can, plus CEO settings. Every change is logged as made by you.</p>
            <input type="password" autoFocus autoComplete="current-password" placeholder="Your password" value={pw} onChange={(e) => setPw(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
            {err && <p className="text-sm text-red-600">{err}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setAskPw(false)} className="rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
              <button type="submit" disabled={busy || !pw} className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60">{busy ? 'Checking…' : 'Turn on'}</button>
            </div>
          </form>
        </div>
      )}

      {picker && <ViewAsPicker onClose={() => setPicker(false)} onPick={async (id) => {
        try {
          const r = await api<{ token: string; user: { role: string } }>('/api/ceo/view-as', 'POST', { user_id: id });
          try { localStorage.setItem('ceo_token', token() || ''); } catch {}
          await applyToken(r.token);
          setPicker(false);
          router.push(HOME[r.user.role] || '/projects');
        } catch (e) { alertInline((e as Error).message); }
      }} />}
    </>
  );
}

function alertInline(msg: string) {
  console.error('[view-as]', msg);
}

function ViewAsPicker({ onClose, onPick }: { onClose: () => void; onPick: (id: number) => void }) {
  const [q, setQ] = useState('');
  const [people, setPeople] = useState<{ id: number; full_name: string; username: string; role: string }[]>([]);
  useEffect(() => {
    const t = setTimeout(() => { api<typeof people>(`/api/ceo/people?q=${encodeURIComponent(q)}`).then(setPeople).catch(() => setPeople([])); }, 200);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-24" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="View as" className="w-full max-w-md rounded-2xl bg-white shadow-xl">
        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
          <Search className="h-4 w-4 text-gray-400" />
          <input autoFocus placeholder="View the app as… (name or username)" value={q} onChange={(e) => setQ(e.target.value)} className="flex-1 text-sm outline-none" />
          <button type="button" aria-label="Close" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>
        <ul className="max-h-80 overflow-y-auto py-1">
          {people.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => onPick(Number(p.id))} className="flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-gray-50">
                <span className="font-medium text-gray-900">{p.full_name}</span>
                <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase', p.role === 'hr' ? 'bg-amber-100 text-amber-800' : p.role === 'developer' ? 'bg-violet-100 text-violet-700' : 'bg-sky-100 text-sky-800')}>{p.role}</span>
              </button>
            </li>
          ))}
          {!people.length && <li className="px-4 py-3 text-sm text-gray-500">No one found.</li>}
        </ul>
        <p className="border-t border-gray-100 px-4 py-2 text-xs text-gray-500">Read-only for 1 hour. Logged in the CEO access log.</p>
      </div>
    </div>
  );
}

/** Fixed banner while a CEO is viewing the app as someone else. */
export function ViewAsBanner() {
  const { user, applyToken } = useAuth();
  const router = useRouter();
  if (!user?.view_as) return null;
  async function exit() {
    let back: string | null = null;
    try { back = localStorage.getItem('ceo_token'); localStorage.removeItem('ceo_token'); } catch {}
    await applyToken(back || null);
    router.push(back ? '/ceo' : '/login');
  }
  return (
    <div className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-3 bg-amber-500 px-4 py-1.5 text-sm font-semibold text-amber-950 shadow">
      <Eye className="h-4 w-4" />
      Viewing as {user.full_name} (read-only)
      <button type="button" onClick={exit} className="rounded-full bg-amber-950/90 px-3 py-0.5 text-xs font-semibold text-amber-50 hover:bg-amber-950">Exit</button>
    </div>
  );
}

/** One-time company notices (e.g. "work chats are visible to management") until acknowledged. */
export function StaffNotices() {
  const { user } = useAuth();
  const [items, setItems] = useState<{ id: number; title: string; body: string }[]>([]);
  useEffect(() => {
    if (!user || user.view_as) return;
    api<typeof items>('/api/notices').then(setItems).catch(() => {});
  }, [user]);
  const n = items[0];
  if (!n) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
      <div role="alertdialog" aria-modal="true" aria-labelledby="notice-title" className="w-full max-w-md space-y-3 rounded-2xl bg-white p-5 shadow-xl">
        <h2 id="notice-title" className="text-base font-semibold text-gray-900">{n.title}</h2>
        <p className="text-sm text-gray-700">{n.body}</p>
        <div className="flex justify-end">
          <button type="button" autoFocus onClick={() => api('/api/notices', 'POST', { id: n.id }).finally(() => setItems((x) => x.slice(1)))}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700">I understand</button>
        </div>
      </div>
    </div>
  );
}
