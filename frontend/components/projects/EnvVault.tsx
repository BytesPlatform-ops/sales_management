'use client';

import { useEffect, useRef, useState } from 'react';
import { KeyRound, Copy, Eye, EyeOff, Pencil, Trash2, Download, Upload, Plus, ClipboardPaste, Lock, ShieldCheck, History, Share2 } from 'lucide-react';
import { ShareDialog } from '@/components/collab/TicketCollab';
import { cn } from '@/lib/utils';
import { Btn, Pill, Empty, ErrorNote, Spinner, inputCls } from '@/components/training/ui';
import { Modal, Field, SectionCard, useConfirm, useToast } from './ui';
import { papi, usePapi, ProjectDetail, fmtDay } from './lib';

type Env = 'development' | 'staging' | 'production';
const ENVS: Env[] = ['development', 'staging', 'production'];
const ENV_LABELS: Record<Env, string> = { development: 'Development', staging: 'Staging', production: 'Production' };

interface Secret {
  id: number; key_name: string; note: string | null; created_at: string; updated_at: string;
  created_by_name: string | null; updated_by_name: string | null;
}
interface EnvList { environment: Env; access: Record<Env, boolean>; secrets: Secret[]; break_glass?: boolean; break_glass_code?: boolean; values_hidden?: boolean; read_only?: boolean }
/** CEO break-glass: a fresh authenticator code + a reason, sent with the value request. */
interface Glass { code: string; reason: string }
interface AuditRow { id: number; action: string; environment: string | null; key_name: string | null; user_name: string | null; created_at: string }
interface Form { id?: number; key: string; value: string; note: string; keepValue: boolean }
interface PlanRow { key: string; status: 'new' | 'changed' | 'same' }

const REVEAL_MS = 30_000;

/** Auth'd fetch for the .env download (papi only reads JSON). */
async function downloadEnv(projectId: number, env: Env, fallbackName: string, glass?: Glass) {
  const t = localStorage.getItem('token');
  const res = await fetch(`/api/projects/${projectId}/env/export?environment=${env}`, {
    headers: { ...(t ? { Authorization: `Bearer ${t}` } : {}), ...(glass ? { 'x-totp-code': glass.code, 'x-break-glass-reason': glass.reason } : {}) },
    cache: 'no-store',
  });
  if (!res.ok) {
    const j = await res.json().catch(() => null);
    throw new Error(j?.message || `Download failed (${res.status})`);
  }
  const name = res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function EnvVault({ d, className }: { d: ProjectDetail; className?: string }) {
  const p = d.project;
  const access = d.permissions.env;
  const isHr = d.permissions.role === 'hr';
  const confirm = useConfirm();
  const toast = useToast();
  const [env, setEnv] = useState<Env>('development');
  const { data, error, isLoading, mutate } = usePapi<EnvList>(access?.[env] ? `/api/projects/${p.id}/env?environment=${env}` : null, { refreshInterval: 30_000 });
  const [revealed, setRevealed] = useState<Record<number, string>>({});
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const [form, setForm] = useState<Form | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [sharing, setSharing] = useState<Secret | null>(null);
  const [showLog, setShowLog] = useState(false);
  // CEO break-glass prompt: resolves with code + reason, or null if cancelled.
  const [glassAsk, setGlassAsk] = useState<{ what: string; resolve: (g: Glass | null) => void } | null>(null);
  const askGlass = (what: string) => new Promise<Glass | null>((resolve) => setGlassAsk({ what, resolve }));

  // Hide revealed values when switching environment or leaving the page.
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);
  useEffect(() => { hideAll(); }, [env]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!access || !Object.values(access).some(Boolean)) return null;

  function hideAll() {
    Object.values(timers.current).forEach(clearTimeout);
    timers.current = {};
    setRevealed({});
  }
  function hide(id: number) {
    clearTimeout(timers.current[id]);
    delete timers.current[id];
    setRevealed((r) => { const n = { ...r }; delete n[id]; return n; });
  }

  async function fetchValue(s: Secret, action: 'copy' | 'reveal') {
    let glass: Glass | null = null;
    if (data?.break_glass) {
      glass = await askGlass(s.key_name);
      if (!glass) throw new Error('Cancelled');
    }
    const body = glass ? { action, totp_code: glass.code, reason: glass.reason } : { action };
    return (await papi<{ value: string }>(`/api/projects/${p.id}/env/${s.id}/value`, { method: 'POST', body })).value;
  }

  async function copy(s: Secret) {
    try {
      await navigator.clipboard.writeText(await fetchValue(s, 'copy'));
      toast(`Copied ${s.key_name}`);
    } catch (e) { if ((e as Error).message !== 'Cancelled') toast((e as Error).message || 'Copy failed', 'error'); }
  }

  async function reveal(s: Secret) {
    if (revealed[s.id] !== undefined) return hide(s.id);
    try {
      const v = await fetchValue(s, 'reveal');
      setRevealed((r) => ({ ...r, [s.id]: v }));
      timers.current[s.id] = setTimeout(() => hide(s.id), REVEAL_MS);
    } catch (e) { toast((e as Error).message, 'error'); }
  }

  async function remove(s: Secret) {
    const ok = await confirm({ title: `Delete ${s.key_name}?`, body: `It will be removed from ${ENV_LABELS[env]} for everyone on this project.`, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await papi(`/api/projects/${p.id}/env/${s.id}`, { method: 'DELETE' });
      hide(s.id);
      mutate();
      toast(`Deleted ${s.key_name}`);
    } catch (e) { toast((e as Error).message, 'error'); }
  }

  async function save() {
    if (!form) return;
    setFormErr(null);
    setSaving(true);
    try {
      if (form.id) {
        const body: Record<string, unknown> = { key: form.key.trim(), note: form.note };
        if (!form.keepValue) body.value = form.value;
        await papi(`/api/projects/${p.id}/env/${form.id}`, { method: 'PATCH', body });
        hide(form.id);
      } else {
        await papi(`/api/projects/${p.id}/env`, { method: 'POST', body: { environment: env, key: form.key.trim(), value: form.value, note: form.note } });
      }
      toast(`${form.key.trim()} saved`);
      setForm(null);
      mutate();
    } catch (e) { setFormErr((e as Error).message); } finally { setSaving(false); }
  }

  async function download() {
    try {
      let glass: Glass | undefined;
      if (data?.break_glass) {
        const g = await askGlass(`the whole ${ENV_LABELS[env]} .env file`);
        if (!g) return;
        glass = g;
      }
      await downloadEnv(p.id, env, `${p.ticket_no}.${env}.env`, glass);
    } catch (e) { toast((e as Error).message, 'error'); }
  }

  const secrets = data?.secrets || [];
  const readOnly = !!data?.read_only;

  return (
    <SectionCard className={className} title={<span className="inline-flex items-center gap-1.5"><KeyRound className="h-4 w-4" />Environment variables</span>}
      action={<span className="inline-flex items-center gap-1 text-xs text-gray-500"><ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />Encrypted · every view is logged</span>}>

      {/* Environment switch + actions */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Environment" className="inline-flex gap-1 rounded-xl bg-gray-100 p-1">
          {ENVS.map((e) => (
            <button key={e} role="tab" aria-selected={env === e} disabled={!access[e]} onClick={() => setEnv(e)}
              title={access[e] ? undefined : 'Production is limited to HR and the project’s lead developer'}
              className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                env === e ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900',
                !access[e] && 'cursor-not-allowed text-gray-400 hover:text-gray-400')}>
              {!access[e] && <Lock className="h-3 w-3" />}{ENV_LABELS[e]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {!readOnly && <Btn size="sm" variant="secondary" onClick={() => setImportOpen(true)}><ClipboardPaste className="h-4 w-4" />Paste .env</Btn>}
          {!data?.values_hidden && <Btn size="sm" variant="secondary" onClick={download} disabled={!secrets.length}><Download className="h-4 w-4" />Download .env</Btn>}
          {!readOnly && <Btn size="sm" onClick={() => { setFormErr(null); setForm({ key: '', value: '', note: '', keepValue: false }); }}><Plus className="h-4 w-4" />Add variable</Btn>}
        </div>
      </div>

      {readOnly && <p className="mb-3 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900">Read-only: these were shared with you for a limited time. You can copy values but not change them.</p>}
      {error && <ErrorNote error={error} />}
      {isLoading && !data && <Spinner label="Loading variables…" />}
      {data && !secrets.length && (
        <Empty icon={<KeyRound className="h-6 w-6" />} title={`No ${ENV_LABELS[env]} variables yet`}
          body="Add one, or paste a whole .env file. Only HR and this project’s developers can see them." />
      )}

      {secrets.length > 0 && (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
          {secrets.map((s) => {
            const shown = revealed[s.id];
            return (
              <li key={s.id} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-start sm:gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-mono text-sm font-semibold text-gray-900 break-all">{s.key_name}</span>
                    {shown === undefined
                      ? <span className="font-mono text-sm tracking-widest text-gray-400" aria-label="hidden value">••••••••</span>
                      : <span className="font-mono text-sm text-gray-800 whitespace-pre-wrap break-all rounded bg-amber-50 px-1">{shown || <em className="text-gray-400">(empty)</em>}</span>}
                  </div>
                  {s.note && <p className="mt-0.5 text-xs text-gray-500 break-words">{s.note}</p>}
                  <p className="mt-0.5 text-[11px] text-gray-400">Updated {fmtDay(s.updated_at)}{s.updated_by_name ? ` by ${s.updated_by_name}` : ''}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {!data?.values_hidden && <>
                    <IconBtn label={`Copy ${s.key_name}`} onClick={() => copy(s)}><Copy className="h-4 w-4" /></IconBtn>
                    <IconBtn label={shown === undefined ? `Show ${s.key_name}` : `Hide ${s.key_name}`} onClick={() => reveal(s)}>
                      {shown === undefined ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                    </IconBtn>
                  </>}
                  {!readOnly && <>
                    <IconBtn label={`Share ${s.key_name}`} onClick={() => setSharing(s)}><Share2 className="h-4 w-4" /></IconBtn>
                    <IconBtn label={`Edit ${s.key_name}`} onClick={() => { setFormErr(null); setForm({ id: s.id, key: s.key_name, value: '', note: s.note || '', keepValue: true }); }}><Pencil className="h-4 w-4" /></IconBtn>
                    <IconBtn label={`Delete ${s.key_name}`} onClick={() => remove(s)} danger><Trash2 className="h-4 w-4" /></IconBtn>
                  </>}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {isHr && (
        <div className="mt-4">
          <button onClick={() => setShowLog((x) => !x)} className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:underline">
            <History className="h-3.5 w-3.5" />{showLog ? 'Hide access log' : 'Show access log'}
          </button>
          {showLog && <AccessLog projectId={p.id} />}
        </div>
      )}

      {/* Add / edit */}
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? `Edit ${form.key}` : `Add variable · ${ENV_LABELS[env]}`}
        footer={<>
          <Btn variant="secondary" onClick={() => setForm(null)}>Cancel</Btn>
          <Btn onClick={save} disabled={saving || !form?.key.trim()}>{saving ? 'Saving…' : 'Save'}</Btn>
        </>}>
        {form && (
          <div className="space-y-3">
            <Field label="Key" htmlFor="env-key" hint="e.g. DATABASE_URL — letters, numbers, _ . -">
              <input id="env-key" className={cn(inputCls, 'font-mono')} value={form.key} autoComplete="off" spellCheck={false}
                onChange={(e) => setForm({ ...form, key: e.target.value })} />
            </Field>
            {form.id && form.keepValue ? (
              <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
                Value unchanged
                <button className="text-xs font-medium text-primary-600 hover:underline" onClick={() => setForm({ ...form, keepValue: false })}>Replace value</button>
              </div>
            ) : (
              <Field label="Value" htmlFor="env-value">
                <textarea id="env-value" rows={3} className={cn(inputCls, 'font-mono')} value={form.value} autoComplete="off" spellCheck={false}
                  onChange={(e) => setForm({ ...form, value: e.target.value })} />
              </Field>
            )}
            <Field label="Note (optional)" htmlFor="env-note" hint="Notes are not encrypted — never put the secret itself here.">
              <input id="env-note" className={inputCls} value={form.note} maxLength={500} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </Field>
            {formErr && <p className="text-sm text-red-600">{formErr}</p>}
          </div>
        )}
      </Modal>

      <BreakGlassModal ask={glassAsk} needCode={!!data?.break_glass_code} onDone={(g) => { glassAsk?.resolve(g); setGlassAsk(null); }} />

      {sharing && <ShareDialog resourceType="vault_item" resourceId={sharing.id} label={sharing.key_name} onClose={() => setSharing(null)}
        note={env === 'production' ? 'Production shares need HR approval before they work (unless you are HR).' : 'They can read and copy this one value, nothing else in the Env.'} />}
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} projectId={p.id} env={env}
        onDone={(msg) => { setImportOpen(false); hideAll(); mutate(); toast(msg); }} />
    </SectionCard>
  );
}

function IconBtn({ children, label, onClick, danger }: { children: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}
      className={cn('rounded-lg p-1.5 text-gray-500 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
        danger ? 'hover:bg-red-50 hover:text-red-600' : 'hover:bg-gray-100 hover:text-gray-800')}>
      {children}
    </button>
  );
}

function ImportModal({ open, onClose, projectId, env, onDone }: {
  open: boolean; onClose: () => void; projectId: number; env: Env; onDone: (msg: string) => void;
}) {
  const [text, setText] = useState('');
  const [plan, setPlan] = useState<PlanRow[] | null>(null);
  const [warnings, setWarnings] = useState<{ line: number; message: string }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!open) { setText(''); setPlan(null); setWarnings([]); setErr(null); } }, [open]);

  async function preview() {
    setErr(null); setBusy(true);
    try {
      const r = await papi<{ plan: PlanRow[]; errors: { line: number; message: string }[] }>(`/api/projects/${projectId}/env`,
        { method: 'POST', body: { environment: env, dotenv: text, dry_run: true } });
      setPlan(r.plan); setWarnings(r.errors);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  async function apply() {
    setErr(null); setBusy(true);
    try {
      const r = await papi<{ created: number; updated: number; unchanged: number }>(`/api/projects/${projectId}/env`,
        { method: 'POST', body: { environment: env, dotenv: text } });
      onDone(`Imported: ${r.created} added, ${r.updated} updated, ${r.unchanged} unchanged`);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  const changes = plan?.filter((r) => r.status !== 'same').length ?? 0;

  return (
    <Modal open={open} onClose={onClose} size="lg" title={`Paste .env · ${ENV_LABELS[env]}`}
      footer={plan ? <>
        <Btn variant="secondary" onClick={() => setPlan(null)}>Back</Btn>
        <Btn onClick={apply} disabled={busy || !changes}>{busy ? 'Importing…' : changes ? `Import ${changes} change${changes === 1 ? '' : 's'}` : 'Nothing to change'}</Btn>
      </> : <>
        <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
        <Btn onClick={preview} disabled={busy || !text.trim()}>{busy ? 'Checking…' : 'Preview'}</Btn>
      </>}>
      {!plan ? (
        <div className="space-y-3">
          <textarea rows={10} className={cn(inputCls, 'font-mono text-xs')} placeholder={'DATABASE_URL=postgres://…\nSTRIPE_SECRET_KEY=sk_test_…'}
            value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" spellCheck={false} aria-label=".env contents" />
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-gray-500">Existing keys with the same name are overwritten. Nothing is saved until you confirm.</p>
            <input ref={fileRef} type="file" className="hidden" accept=".env,text/plain,*/*"
              onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); e.target.value = ''; }} />
            <Btn size="sm" variant="secondary" onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" />Choose file</Btn>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <ul className="max-h-72 divide-y divide-gray-100 overflow-y-auto rounded-xl border border-gray-200">
            {plan.map((r) => (
              <li key={r.key} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="font-mono text-sm text-gray-900 break-all">{r.key}</span>
                <Pill tone={r.status === 'new' ? 'green' : r.status === 'changed' ? 'amber' : 'gray'}>
                  {r.status === 'new' ? 'New' : r.status === 'changed' ? 'Will overwrite' : 'Same'}
                </Pill>
              </li>
            ))}
          </ul>
          {warnings.length > 0 && (
            <p className="text-xs text-amber-700">Skipped {warnings.length} line{warnings.length === 1 ? '' : 's'}: {warnings.slice(0, 5).map((w) => `line ${w.line} (${w.message.toLowerCase()})`).join(', ')}{warnings.length > 5 ? '…' : ''}</p>
          )}
        </div>
      )}
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
    </Modal>
  );
}

const ACTION_LABELS: Record<string, string> = {
  create: 'added', update: 'updated', delete: 'deleted', reveal: 'viewed', copy: 'copied', download: 'downloaded .env', import: 'imported .env',
};

function AccessLog({ projectId }: { projectId: number }) {
  const { data, error, isLoading } = usePapi<AuditRow[]>(`/api/hr/vault-audit?project_id=${projectId}&limit=100`);
  if (error) return <div className="mt-2"><ErrorNote error={error} /></div>;
  if (isLoading || !data) return <div className="mt-2"><Spinner label="Loading log…" /></div>;
  if (!data.length) return <p className="mt-2 text-xs text-gray-500">No activity yet.</p>;
  return (
    <ul className="mt-2 max-h-64 overflow-y-auto divide-y divide-gray-100 rounded-xl border border-gray-200 text-xs">
      {data.map((a) => (
        <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-1.5">
          <span className="text-gray-700">
            <span className="font-medium text-gray-900">{a.user_name || 'Unknown'}</span> {ACTION_LABELS[a.action] || a.action}
            {a.key_name && <> <span className="font-mono">{a.key_name}</span></>}
            {a.environment && <span className="text-gray-400"> · {ENV_LABELS[a.environment as Env] || a.environment}</span>}
          </span>
          <time className="text-gray-400" dateTime={a.created_at}>{new Date(a.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time>
        </li>
      ))}
    </ul>
  );
}

/** CEO-only: confirm a secret reveal with an authenticator code and a reason (logged; the lead developer is told). */
function BreakGlassModal({ ask, needCode, onDone }: { ask: { what: string } | null; needCode: boolean; onDone: (g: Glass | null) => void }) {
  const [code, setCode] = useState('');
  const [reason, setReason] = useState('');
  useEffect(() => { if (ask) { setCode(''); setReason(''); } }, [ask]);
  return (
    <Modal open={!!ask} onClose={() => onDone(null)} title="Break glass" size="sm"
      footer={<>
        <Btn variant="secondary" onClick={() => onDone(null)}>Cancel</Btn>
        <Btn variant="danger" disabled={(needCode && code.length !== 6) || reason.trim().length < 5} onClick={() => onDone({ code, reason: reason.trim() })}>Reveal</Btn>
      </>}>
      <div className="space-y-3 text-sm">
        <p className="text-gray-600">You’re about to see <strong>{ask?.what}</strong>. This is logged, and the project’s lead developer is notified.</p>
        <Field label="Why do you need it?" htmlFor="bg-reason">
          <input id="bg-reason" className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Client outage, developer unavailable" autoFocus />
        </Field>
        {needCode && (
          <Field label="Authenticator code" htmlFor="bg-code">
            <input id="bg-code" className={cn(inputCls, 'font-mono tracking-widest')} inputMode="numeric" autoComplete="one-time-code" maxLength={6}
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          </Field>
        )}
      </div>
    </Modal>
  );
}
