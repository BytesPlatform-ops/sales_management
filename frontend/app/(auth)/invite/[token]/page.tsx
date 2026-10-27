'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

/** Public page: set your password from a single-use invite link, then sign in (and set up 2-step). */
export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<{ username: string; full_name: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/auth/invite/${encodeURIComponent(token)}`).then((r) => r.json())
      .then((j) => (j.status === 'success' ? setInfo(j.data) : setErr(j.message || 'Invalid link')))
      .catch(() => setErr('Could not check this link'));
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw !== pw2) return setErr('The passwords don’t match');
    setErr(null); setBusy(true);
    try {
      const res = await fetch(`/api/auth/invite/${encodeURIComponent(token)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
      const j = await res.json();
      if (j.status !== 'success') throw new Error(j.message);
      setDone(true);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  const input = 'w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500';
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-50 to-pink-50 p-4">
      <div className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 shadow-xl">
        <h1 className="text-xl font-bold text-gray-900">Set your password</h1>
        {done ? (
          <p className="text-sm text-gray-700">Done. <Link href="/login" className="font-semibold text-indigo-600 underline">Sign in</Link> as <strong>{info?.username}</strong> — you’ll set up an authenticator app next.</p>
        ) : info ? (
          <form onSubmit={submit} className="space-y-3">
            <p className="text-sm text-gray-600">Hi {info.full_name}. Your username is <strong>{info.username}</strong>.</p>
            <input className={input} type="password" autoComplete="new-password" placeholder="New password (10+ characters)" value={pw} onChange={(e) => setPw(e.target.value)} minLength={10} required />
            <input className={input} type="password" autoComplete="new-password" placeholder="Repeat it" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
            <button type="submit" disabled={busy} className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">{busy ? 'Saving…' : 'Set password'}</button>
          </form>
        ) : !err ? <p className="text-sm text-gray-500">Checking link…</p> : null}
        {err && <p className="text-sm text-red-600">{err}</p>}
      </div>
    </div>
  );
}
