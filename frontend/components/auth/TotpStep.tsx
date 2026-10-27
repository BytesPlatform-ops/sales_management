'use client';

import { useState } from 'react';
import { ShieldCheck, KeyRound, Copy, Check } from 'lucide-react';
import type { TotpChallenge } from '@/hooks/use-auth';

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => null);
  if (!res.ok || j?.status === 'error') throw new Error(j?.message || `Request failed (${res.status})`);
  return j.data as T;
}

/**
 * Second sign-in step for CEO accounts: set up an authenticator app (first time),
 * then enter the 6-digit code.
 */
export function TotpStep({ challenge, onDone, onCancel }: { challenge: TotpChallenge; onDone: (token: string) => void; onCancel: () => void }) {
  const [enrol, setEnrol] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function start() {
    setErr(null); setBusy(true);
    try { setEnrol(await post('/api/auth/totp/enroll', { challenge: challenge.challenge })); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      const r = await post<{ token: string }>('/api/auth/totp', { challenge: challenge.challenge, code });
      onDone(r.token);
    } catch (e) { setErr((e as Error).message); setCode(''); } finally { setBusy(false); }
  }

  const needsSetup = !challenge.enrolled && !enrol;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-gray-800">
        <ShieldCheck className="h-5 w-5 text-indigo-600" />
        <h2 className="font-semibold">Two-step sign-in</h2>
      </div>
      {needsSetup ? (
        <>
          <p className="text-sm text-gray-600">Executive accounts need an authenticator app (Google Authenticator, 1Password, Authy…). Set it up once — it takes a minute.</p>
          <button type="button" onClick={start} disabled={busy}
            className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
            {busy ? 'Preparing…' : 'Set up authenticator'}
          </button>
        </>
      ) : (
        <form onSubmit={verify} className="space-y-3">
          {enrol && (
            <div className="space-y-2 rounded-xl border border-indigo-100 bg-indigo-50/60 p-3 text-sm">
              <p className="text-gray-700">In your authenticator app, add an account with this key (or open the link on your phone):</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded bg-white px-2 py-1.5 font-mono text-xs text-gray-900">{enrol.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
                <button type="button" aria-label="Copy key" onClick={() => navigator.clipboard.writeText(enrol.secret).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); })}
                  className="rounded p-1.5 text-gray-500 hover:bg-white">{copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}</button>
              </div>
              <a href={enrol.uri} className="inline-flex items-center gap-1 text-xs font-medium text-indigo-700 underline"><KeyRound className="h-3.5 w-3.5" />Open in authenticator app</a>
              <p className="text-xs text-gray-500">This key is shown once. Then enter the 6-digit code below.</p>
            </div>
          )}
          <label className="block text-sm font-medium text-gray-700" htmlFor="totp-code">Authenticator code</label>
          <input id="totp-code" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6} pattern="\d{6}"
            value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            className="w-full rounded-xl border border-gray-200 bg-white/80 px-4 py-3 text-center font-mono text-2xl tracking-[0.4em] outline-none focus:border-transparent focus:ring-2 focus:ring-indigo-500" />
          <button type="submit" disabled={busy || code.length !== 6}
            className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
            {busy ? 'Checking…' : 'Verify and sign in'}
          </button>
        </form>
      )}
      {err && <p className="text-sm text-red-600">{err}</p>}
      <button type="button" onClick={onCancel} className="w-full text-center text-xs text-gray-500 hover:text-gray-700">Back to password</button>
    </div>
  );
}
