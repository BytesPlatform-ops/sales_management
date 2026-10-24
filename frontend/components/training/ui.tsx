'use client';

import { ReactNode } from 'react';
import Link from 'next/link';
import { AlertTriangle, Lock, CheckCircle2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PHASE_LABELS } from '@/lib/training/client';

export function PageHeader({ title, subtitle, actions, back }: { title: string; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-6">
      {back && (
        <Link href={back.href} className="inline-block mb-2 text-sm text-gray-500 hover:text-gray-700">← {back.label}</Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Panel({ children, className, title, action }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={cn('bg-white rounded-2xl border border-gray-200 shadow-sm', className)}>
      {title && (
        <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">{title}</h2>
          {action}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

/** B.11: every AI screen shows this and stays usable. */
export function StandardModeBanner({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{msg}</div>;
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-400">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

const PHASE_STYLE: Record<string, string> = {
  TRAINING: 'bg-violet-100 text-violet-700',
  SUPERVISED: 'bg-amber-100 text-amber-800',
  RAMP_50: 'bg-sky-100 text-sky-700',
  RAMP_75: 'bg-cyan-100 text-cyan-800',
  FULL: 'bg-emerald-100 text-emerald-700',
};

export function PhaseBadge({ phase, className }: { phase?: string | null; className?: string }) {
  const p = phase || 'FULL';
  return <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap', PHASE_STYLE[p] || 'bg-gray-100 text-gray-700', className)}>{PHASE_LABELS[p] || p}</span>;
}

export function Pill({ children, tone = 'gray', className }: { children: ReactNode; tone?: 'gray' | 'green' | 'amber' | 'red' | 'blue' | 'violet'; className?: string }) {
  const tones = {
    gray: 'bg-gray-100 text-gray-700', green: 'bg-emerald-100 text-emerald-700', amber: 'bg-amber-100 text-amber-800',
    red: 'bg-red-100 text-red-700', blue: 'bg-primary-100 text-primary-700', violet: 'bg-violet-100 text-violet-700',
  };
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', tones[tone], className)}>{children}</span>;
}

export function ProgressBar({ value, className, tone = 'primary' }: { value: number; className?: string; tone?: 'primary' | 'green' }) {
  const v = Math.max(0, Math.min(100, value || 0));
  return (
    <div className={cn('h-2 w-full rounded-full bg-gray-100 overflow-hidden', className)} role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn('h-full rounded-full transition-all', tone === 'green' ? 'bg-emerald-500' : 'bg-primary-500')} style={{ width: `${v}%` }} />
    </div>
  );
}

export function scoreTone(score: number | null | undefined) {
  if (score === null || score === undefined) return 'text-gray-400';
  return score >= 85 ? 'text-emerald-600' : score >= 70 ? 'text-primary-600' : score >= 55 ? 'text-amber-600' : 'text-red-600';
}

export function LockNote({ hint }: { hint?: string | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-gray-400">
      <Lock className="h-3.5 w-3.5" /> {hint || 'Locked'}
    </span>
  );
}

export function DoneMark() {
  return <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" aria-label="Completed" />;
}

export function Empty({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="text-center py-12 px-6">
      {icon && <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-400">{icon}</div>}
      <h3 className="font-semibold text-gray-900">{title}</h3>
      {body && <p className="mt-1 text-sm text-gray-500">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Btn({ children, onClick, variant = 'primary', disabled, type = 'button', className, size = 'md' }: {
  children: ReactNode; onClick?: () => void; variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
  disabled?: boolean; type?: 'button' | 'submit'; className?: string; size?: 'sm' | 'md';
}) {
  const v = {
    primary: 'bg-primary-600 text-white hover:bg-primary-700 disabled:bg-primary-300',
    secondary: 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 disabled:text-gray-400',
    ghost: 'text-gray-600 hover:bg-gray-100 disabled:text-gray-300',
    danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300',
    success: 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-300',
  }[variant];
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={cn('inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed',
        size === 'sm' ? 'px-3 py-1.5 text-sm' : 'px-4 py-2 text-sm', v, className)}>
      {children}
    </button>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-gray-400">{label}</div>
      <div className={cn('mt-1 text-2xl font-bold text-gray-900 tabular-nums', tone)}>{value}</div>
      {hint && <div className="text-xs text-gray-500 mt-0.5">{hint}</div>}
    </div>
  );
}

export interface ScoreCardData {
  rubric?: string;
  criteria: { id: string; criterion: string; max_points: number; points: number; evidence_quote?: string; tip?: string }[];
  auto_fail?: string[];
  total: number;
  passed?: boolean;
  excellent?: boolean;
  top_3_tips?: string[];
  summary?: string;
  engine?: 'ai' | 'script' | 'trainer';
}

const ENGINE_LABEL = { ai: 'AI-graded', script: 'Scripted (standard mode)', trainer: 'Trainer-graded' };

/** The 100-point scorecard, shared by roleplays, call reviews and the trainer queue. */
export function ScoreCardView({ card, compact = false }: { card: ScoreCardData | null | undefined; compact?: boolean }) {
  if (!card) return null;
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-400">Score</div>
          <div className={cn('text-4xl font-extrabold tabular-nums', scoreTone(card.total))}>{card.total}<span className="text-lg text-gray-400 font-semibold">/100</span></div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {card.engine && <Pill tone="gray">{ENGINE_LABEL[card.engine]}</Pill>}
          {card.excellent ? <Pill tone="green">Excellent</Pill> : card.passed ? <Pill tone="blue">Pass (≥70)</Pill> : <Pill tone="amber">Below 70</Pill>}
          {card.auto_fail?.length ? <Pill tone="red">Auto-fail: capped at 40</Pill> : null}
        </div>
      </div>
      {card.auto_fail?.length ? (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {card.auto_fail.map((f) => f.replace(/_/g, ' ')).join(' · ')}
        </div>
      ) : null}
      <div className="space-y-2.5">
        {card.criteria.map((c) => (
          <div key={c.id}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium text-gray-800">{c.criterion}</span>
              <span className="tabular-nums text-gray-600">{c.points}/{c.max_points}</span>
            </div>
            <ProgressBar value={(c.points / c.max_points) * 100} className="mt-1 h-1.5" />
            {!compact && (c.evidence_quote || c.tip) && (
              <div className="mt-1 text-xs text-gray-500 space-y-0.5">
                {c.evidence_quote && <div className="italic">“{c.evidence_quote}”</div>}
                {c.tip && <div>→ {c.tip}</div>}
              </div>
            )}
          </div>
        ))}
      </div>
      {card.top_3_tips?.length ? (
        <div className="mt-5 rounded-xl bg-primary-50 border border-primary-100 p-4">
          <div className="text-sm font-semibold text-primary-800 mb-2">Do this next time</div>
          <ol className="list-decimal pl-5 space-y-1 text-sm text-primary-900">
            {card.top_3_tips.map((t, i) => <li key={i}>{t}</li>)}
          </ol>
        </div>
      ) : null}
      {card.summary && !compact && <p className="mt-3 text-sm text-gray-600">{card.summary}</p>}
    </div>
  );
}

export const inputCls = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-50';
