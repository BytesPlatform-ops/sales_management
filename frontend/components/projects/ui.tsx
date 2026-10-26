'use client';

import { ReactNode, useCallback, useEffect, useRef, useState, createContext, useContext } from 'react';
import { X, Repeat, CheckCircle2, AlertCircle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Btn, Pill } from '@/components/training/ui';
import { STATUS_LABELS, PRIORITY_LABELS, ROLE_LABELS, RECURRENCE_LABELS, Status } from './lib';

export function ProjectsPage({ children, className }: { children: ReactNode; className?: string }) {
  // pt-10 leaves room for the mobile menu button (fixed top-left).
  return <div className={cn('pt-10 lg:pt-0 pb-10 max-w-[1400px] mx-auto min-w-0', className)}>{children}</div>;
}

const STATUS_STYLE: Record<Status, string> = {
  new: 'bg-sky-100 text-sky-800',
  in_progress: 'bg-primary-100 text-primary-700',
  review: 'bg-violet-100 text-violet-700',
  delivered: 'bg-emerald-100 text-emerald-700',
  on_hold: 'bg-amber-100 text-amber-800',
  closed: 'bg-gray-200 text-gray-700',
  cancelled: 'bg-red-100 text-red-700',
};

export function StatusPill({ status, className }: { status: Status; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap', STATUS_STYLE[status] || 'bg-gray-100 text-gray-700', className)}>
      {STATUS_LABELS[status] || status}
    </span>
  );
}

export function PriorityPill({ priority }: { priority: string }) {
  if (priority === 'normal') return <Pill tone="gray">Normal</Pill>;
  const tone = priority === 'urgent' ? 'red' : priority === 'high' ? 'amber' : 'gray';
  return <Pill tone={tone}>{priority === 'urgent' ? '!! ' : priority === 'high' ? '! ' : ''}{PRIORITY_LABELS[priority] || priority}</Pill>;
}

export function TypePill({ type, recurrence, cycleNo }: { type: string; recurrence?: string | null; cycleNo?: number | null }) {
  if (type !== 'recurring') return <Pill tone="gray">One-time</Pill>;
  return (
    <Pill tone="violet">
      <Repeat className="h-3 w-3" aria-hidden />
      {RECURRENCE_LABELS[recurrence || ''] || 'Recurring'}{cycleNo ? ` · cycle ${cycleNo}` : ''}
    </Pill>
  );
}

export function RoleBadge({ role }: { role: string | null | undefined }) {
  if (!role) return null;
  const tone = role === 'hr' ? 'bg-amber-100 text-amber-800' : role === 'developer' ? 'bg-violet-100 text-violet-700' : 'bg-sky-100 text-sky-800';
  return <span className={cn('rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide', tone)}>{ROLE_LABELS[role] || role}</span>;
}

const AVATAR_COLORS = ['bg-sky-500', 'bg-violet-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-indigo-500', 'bg-teal-500'];
export function initials(name: string | null | undefined) {
  const parts = String(name || '?').trim().split(/\s+/);
  return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
export function Avatar({ name, size = 'md', className }: { name: string | null | undefined; size?: 'sm' | 'md'; className?: string }) {
  const n = String(name || '?');
  const color = AVATAR_COLORS[n.split("").reduce((s, c) => s + c.charCodeAt(0), 0) % AVATAR_COLORS.length];
  return (
    <span title={n} className={cn('inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-2 ring-white', color,
      size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-8 w-8 text-xs', className)}>
      {initials(n)}
    </span>
  );
}
export function AvatarStack({ people, max = 4 }: { people: { name: string }[]; max?: number }) {
  if (!people.length) return <span className="text-xs text-gray-400">No one assigned</span>;
  return (
    <span className="flex -space-x-1.5" aria-label={`Team: ${people.map((p) => p.name).join(', ')}`}>
      {people.slice(0, max).map((p, i) => <Avatar key={i} name={p.name} size="sm" />)}
      {people.length > max && <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-gray-200 text-[10px] font-semibold text-gray-600 ring-2 ring-white">+{people.length - max}</span>}
    </span>
  );
}

export function Field({ label, htmlFor, hint, children, className }: { label: ReactNode; htmlFor?: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ modal

export function Modal({ open, onClose, title, children, footer, size = 'md' }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg';
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const t = setTimeout(() => {
      const el = ref.current?.querySelector<HTMLElement>('[data-autofocus], input:not([type=hidden]), textarea, select, button');
      el?.focus();
    }, 20);
    return () => { document.removeEventListener('keydown', onKey); clearTimeout(t); prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}
        className={cn('w-full max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white shadow-xl',
          size === 'sm' ? 'sm:max-w-md' : size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-lg')}>
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-gray-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/** Promise-based confirm dialog: `const ok = await confirm({...})`. */
interface ConfirmOpts { title: string; body?: ReactNode; confirmLabel?: string; danger?: boolean }
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);

type ToastTone = 'success' | 'error' | 'info';
const ToastCtx = createContext<(msg: string, tone?: ToastTone) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ProjectsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), []);
  const close = (v: boolean) => { state?.resolve(v); setState(null); };

  const [toasts, setToasts] = useState<{ id: number; msg: string; tone: ToastTone }[]>([]);
  const toast = useCallback((msg: string, tone: ToastTone = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 6000 : 3500);
  }, []);

  return (
    <ConfirmCtx.Provider value={confirm}>
      <ToastCtx.Provider value={toast}>
        {children}
        <Modal open={!!state} onClose={() => close(false)} title={state?.title || ''} size="sm"
          footer={<>
            <Btn variant="secondary" onClick={() => close(false)}>Keep it</Btn>
            <Btn variant={state?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>{state?.confirmLabel || 'Confirm'}</Btn>
          </>}>
          <div className="text-sm text-gray-600">{state?.body}</div>
        </Modal>
        <div className="fixed bottom-4 right-4 left-4 sm:left-auto z-[60] flex flex-col items-end gap-2 pointer-events-none" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={cn('pointer-events-auto flex max-w-sm items-start gap-2 rounded-xl px-4 py-3 text-sm shadow-lg',
              t.tone === 'error' ? 'bg-red-600 text-white' : t.tone === 'info' ? 'bg-gray-900 text-white' : 'bg-emerald-600 text-white')}>
              {t.tone === 'error' ? <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /> : t.tone === 'info' ? <Info className="h-4 w-4 mt-0.5 shrink-0" /> : <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />}
              <span>{t.msg}</span>
            </div>
          ))}
        </div>
      </ToastCtx.Provider>
    </ConfirmCtx.Provider>
  );
}

export function SectionCard({ title, action, children, className, id }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cn('bg-white rounded-2xl border border-gray-200 shadow-sm min-w-0', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-5 pt-4 pb-3 border-b border-gray-100">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">{title}</h2>
        {action}
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

export const selectCls = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-50';
