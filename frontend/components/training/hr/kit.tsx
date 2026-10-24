'use client';

/**
 * Shared building blocks for the trainer / admin (HR) training screens:
 * the sub-nav, page shell, dialogs, toasts, form fields, tables and a JSON editor.
 * Builds on components/training/ui.tsx (which stays untouched).
 */
import { ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CheckCircle2, AlertTriangle, X, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader, Btn, inputCls } from '@/components/training/ui';

// ------------------------------------------------------------------ nav + shell

export const TRAINER_NAV = [
  { href: '/hr/training', label: 'Cohort', exact: true, also: ['/hr/training/rep'] },
  { href: '/hr/training/reviews', label: 'Review queue' },
  { href: '/hr/training/content', label: 'Content' },
  { href: '/hr/training/assign', label: 'Assign' },
  { href: '/hr/training/digest', label: 'Digest' },
  { href: '/hr/training/ai', label: 'AI usage' },
  { href: '/hr/training/settings', label: 'Settings' },
];

export function TrainerNav() {
  const pathname = usePathname() || '';
  return (
    <nav aria-label="Training sections" className="-mx-1 mb-5 overflow-x-auto">
      <div className="flex min-w-max gap-1 px-1 border-b border-gray-200">
        {TRAINER_NAV.map((item) => {
          const active = item.exact
            ? pathname === item.href || (item.also || []).some((p) => pathname.startsWith(p))
            : pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded-t',
                active ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** Page wrapper: leaves room for the mobile sidebar button, then sub-nav + header. */
export function TrainerPage({ title, subtitle, actions, back, children }: {
  title: string; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string }; children: ReactNode;
}) {
  return (
    <div className="pt-10 lg:pt-0 pb-10 max-w-[1400px]">
      <TrainerNav />
      <PageHeader title={title} subtitle={subtitle} actions={actions} back={back} />
      {children}
    </div>
  );
}

// ------------------------------------------------------------------ toast

type ToastTone = 'success' | 'error' | 'info';

/** Small toast: `const toast = useToast(); toast.show('Saved'); … {toast.node}` */
export function useToast() {
  const [state, setState] = useState<{ msg: ReactNode; tone: ToastTone; id: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const show = useCallback((msg: ReactNode, tone: ToastTone = 'success', ms = 4000) => {
    clearTimeout(timer.current);
    const id = Date.now();
    setState({ msg, tone, id });
    timer.current = setTimeout(() => setState((s) => (s?.id === id ? null : s)), ms);
  }, []);
  const error = useCallback((err: unknown) => show(err instanceof Error ? err.message : String(err), 'error', 7000), [show]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const node = state ? (
    <div role="status" aria-live="polite" className="fixed bottom-4 right-4 left-4 sm:left-auto z-[70] flex justify-end pointer-events-none">
      <div className={cn(
        'pointer-events-auto flex max-w-md items-start gap-2 rounded-xl border px-4 py-3 text-sm shadow-lg',
        state.tone === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-800',
        state.tone === 'error' && 'border-red-200 bg-red-50 text-red-700',
        state.tone === 'info' && 'border-primary-200 bg-primary-50 text-primary-800'
      )}>
        {state.tone === 'success' ? <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> : state.tone === 'error' ? <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> : <Info className="h-4 w-4 mt-0.5 shrink-0" />}
        <div className="min-w-0">{state.msg}</div>
        <button onClick={() => setState(null)} className="ml-1 text-current/60 hover:opacity-70" aria-label="Dismiss"><X className="h-4 w-4" /></button>
      </div>
    </div>
  ) : null;
  return useMemo(() => ({ show, error, node }), [show, error, node]);
}

// ------------------------------------------------------------------ modal + confirm

export function Modal({ open, onClose, title, children, footer, wide }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => {
      const el = ref.current?.querySelector<HTMLElement>('[data-autofocus], .modal-body textarea, .modal-body input, .modal-body select, .modal-body button, button');
      el?.focus();
    }, 10);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className={cn('w-full max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white shadow-xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}>
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <h2 id={titleId} className="text-base font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <div className="modal-body px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-gray-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  tone?: 'danger' | 'primary';
  /** Ask for a reason; `true` = required. */
  reason?: boolean | 'required';
  reasonLabel?: string;
}

/**
 * Promise-based confirm dialog:
 *   const confirm = useConfirm();  const r = await confirm.ask({...});  if (r === null) return;
 * Resolves to the reason text ('' when no reason asked) or null when cancelled.
 */
export function useConfirm() {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [reason, setReason] = useState('');
  const resolver = useRef<(v: string | null) => void>();
  const ask = useCallback((o: ConfirmOptions) => {
    setOpts(o);
    setReason('');
    return new Promise<string | null>((resolve) => { resolver.current = resolve; });
  }, []);
  const close = useCallback((v: string | null) => {
    resolver.current?.(v);
    resolver.current = undefined;
    setOpts(null);
  }, []);
  const needReason = opts?.reason === 'required';
  const node = (
    <Modal open={!!opts} onClose={() => close(null)} title={opts?.title}
      footer={<>
        <Btn variant="secondary" onClick={() => close(null)}>Cancel</Btn>
        <Btn variant={opts?.tone === 'primary' ? 'primary' : 'danger'} disabled={needReason && !reason.trim()} onClick={() => close(reason.trim())}>
          {opts?.confirmLabel || 'Confirm'}
        </Btn>
      </>}>
      {opts?.body && <div className="text-sm text-gray-600 space-y-2">{opts.body}</div>}
      {opts?.reason && (
        <label className="mt-4 block">
          <span className="text-sm font-medium text-gray-700">{opts.reasonLabel || 'Reason'}{needReason ? ' (required)' : ' (optional)'}</span>
          <textarea data-autofocus rows={3} className={cn(inputCls, 'mt-1')} value={reason} onChange={(e) => setReason(e.target.value)} />
          <span className="mt-1 block text-xs text-gray-400">Saved in the history and shown to the rep where relevant.</span>
        </label>
      )}
    </Modal>
  );
  return { ask, node };
}

// ------------------------------------------------------------------ fields

export function Field({ label, help, children, className, htmlFor }: { label: ReactNode; help?: ReactNode; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-gray-700">{label}</label>
      <div className="mt-1">{children}</div>
      {help && <p className="mt-1 text-xs text-gray-500">{help}</p>}
    </div>
  );
}

export function Toggle({ checked, onChange, label, help, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; help?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <button id={id} type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
        className={cn('relative mt-0.5 inline-flex h-5 w-9 shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 disabled:opacity-50',
          checked ? 'bg-primary-600' : 'bg-gray-300')}>
        <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-4' : 'translate-x-0.5')} />
      </button>
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium text-gray-800 cursor-pointer">{label}</label>
        {help && <p className="text-xs text-gray-500 mt-0.5">{help}</p>}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div role="tablist" className={cn('flex flex-wrap gap-1 rounded-xl bg-gray-100 p-1', className)}>
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={cn('rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
            value === t.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800')}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Comma/Enter separated list editor rendered as chips. */
export function ChipInput({ value, onChange, placeholder, suggestions }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; suggestions?: string[] }) {
  const [text, setText] = useState('');
  const add = (raw: string) => {
    const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    onChange(Array.from(new Set([...value, ...parts])));
    setText('');
  };
  return (
    <div>
      <div className="flex flex-wrap gap-1.5 rounded-lg border border-gray-300 px-2 py-1.5 focus-within:ring-2 focus-within:ring-primary-500">
        {value.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-800">
            {v}
            <button type="button" onClick={() => onChange(value.filter((x) => x !== v))} aria-label={`Remove ${v}`} className="hover:text-red-600"><X className="h-3 w-3" /></button>
          </span>
        ))}
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={value.length ? '' : placeholder}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(text); } else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1)); }}
          onBlur={() => add(text)}
          className="min-w-[8rem] flex-1 border-0 p-0.5 text-sm focus:outline-none focus:ring-0" />
      </div>
      {suggestions && suggestions.filter((s) => !value.includes(s)).length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {suggestions.filter((s) => !value.includes(s)).map((s) => (
            <button key={s} type="button" onClick={() => onChange([...value, s])} className="rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-xs text-gray-500 hover:border-primary-400 hover:text-primary-700">+ {s}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ tables

export const th = 'px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 whitespace-nowrap';
export const td = 'px-3 py-2.5 text-sm text-gray-700 align-top';

export function TableWrap({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('-mx-5 overflow-x-auto', className)}>
      <table className="min-w-full divide-y divide-gray-100">{children}</table>
    </div>
  );
}

// ------------------------------------------------------------------ JSON editor

export interface JsonCheck { ok: boolean; value?: any; error?: string }

export function parseJson(text: string): JsonCheck {
  if (!text.trim()) return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Textarea for JSON with live parse errors plus optional semantic checks. */
export function JsonEditor({ value, onChange, rows = 10, validate, label, help, id }: {
  value: string; onChange: (v: string) => void; rows?: number; validate?: (v: any) => string[]; label?: ReactNode; help?: ReactNode; id?: string;
}) {
  const parsed = parseJson(value);
  const problems = parsed.ok && validate && parsed.value !== null ? validate(parsed.value) : [];
  const autoId = useId();
  const fid = id || autoId;
  return (
    <div>
      {label && <label htmlFor={fid} className="block text-sm font-medium text-gray-700 mb-1">{label}</label>}
      <textarea id={fid} rows={rows} spellCheck={false} value={value} onChange={(e) => onChange(e.target.value)}
        aria-invalid={!parsed.ok || problems.length > 0}
        className={cn(inputCls, 'font-mono text-xs leading-5', (!parsed.ok || problems.length) && 'border-red-300 focus:ring-red-400')} />
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs">
        {!parsed.ok ? <span className="text-red-600">JSON error: {parsed.error}</span>
          : problems.length ? <span className="text-red-600">{problems.length} problem{problems.length > 1 ? 's' : ''} found</span>
          : <span className="text-emerald-600">Valid JSON</span>}
        {parsed.ok && parsed.value !== null && (
          <button type="button" className="text-primary-600 hover:underline" onClick={() => onChange(JSON.stringify(parsed.value, null, 2))}>Tidy formatting</button>
        )}
      </div>
      {problems.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-xs text-red-600 space-y-0.5">{problems.slice(0, 12).map((p, i) => <li key={i}>{p}</li>)}</ul>
      )}
      {help && <div className="mt-1 text-xs text-gray-500">{help}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ formatting

export function fmtUsd(n: number | string | null | undefined, digits = 2) {
  if (n === null || n === undefined || n === '') return '—';
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: v !== 0 && Math.abs(v) < 0.01 ? 4 : digits })}`;
}

export function fmtNum(n: number | string | null | undefined) {
  if (n === null || n === undefined || n === '') return '—';
  const v = Number(n);
  return Number.isFinite(v) ? v.toLocaleString('en-US') : '—';
}

export function ago(d: string | Date | null | undefined) {
  if (!d) return '—';
  const ms = Date.now() - new Date(d).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} days`;
}

export function thisMonth() {
  return new Date().toISOString().slice(0, 7);
}

/** Muted inline explanation box. */
export function Help({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600 leading-relaxed [overflow-wrap:anywhere]', className)}>{children}</div>;
}

export function PayNote({ children }: { children: ReactNode }) {
  return (
    <div className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-1.5 text-xs text-amber-800">
      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" /><span>{children}</span>
    </div>
  );
}
