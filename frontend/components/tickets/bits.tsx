'use client';

import { useState } from 'react';
import { Bug, Sparkles, CheckSquare, GitPullRequestArrow, FileText, ShieldCheck, FlaskConical, HelpCircle, Copy, Check, Ban } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/projects/ui';
import { TicketStatus, TicketType, Priority, TICKET_STATUS_LABELS, TYPE_LABELS, TICKET_PRIORITY_LABELS, PersonRef, slaLabel } from './lib';

const TYPE_ICON: Record<TicketType, typeof Bug> = {
  feature: Sparkles, bug: Bug, task: CheckSquare, change_request: GitPullRequestArrow, content: FileText,
  qa: ShieldCheck, spike: FlaskConical, question: HelpCircle,
};
const TYPE_COLOR: Record<TicketType, string> = {
  feature: 'text-indigo-600', bug: 'text-red-600', task: 'text-sky-600', change_request: 'text-amber-600',
  content: 'text-teal-600', qa: 'text-emerald-600', spike: 'text-violet-600', question: 'text-gray-500',
};

export function TypeIcon({ type, className }: { type: TicketType; className?: string }) {
  const I = TYPE_ICON[type] || CheckSquare;
  return <I className={cn('h-4 w-4 shrink-0', TYPE_COLOR[type], className)} aria-label={TYPE_LABELS[type]} />;
}

export function TypeBadge({ type }: { type: TicketType }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-700">
      <TypeIcon type={type} className="h-3.5 w-3.5" />{TYPE_LABELS[type]}
    </span>
  );
}

const STATUS_STYLE: Record<TicketStatus, string> = {
  triage: 'bg-orange-100 text-orange-800', open: 'bg-gray-100 text-gray-700', in_progress: 'bg-primary-100 text-primary-700',
  in_review: 'bg-violet-100 text-violet-700', in_qa: 'bg-teal-100 text-teal-800', done: 'bg-emerald-100 text-emerald-700',
  closed: 'bg-gray-200 text-gray-600', declined: 'bg-red-100 text-red-700',
};

export function TicketStatusPill({ status, className }: { status: TicketStatus; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap', STATUS_STYLE[status], className)}>
      {TICKET_STATUS_LABELS[status]}
    </span>
  );
}

const PRIORITY_STYLE: Record<Priority, string> = {
  urgent: 'bg-red-600 text-white', high: 'bg-amber-100 text-amber-800', normal: 'bg-gray-100 text-gray-600', low: 'bg-gray-50 text-gray-400',
};

export function TicketPriority({ priority, compact }: { priority: Priority; compact?: boolean }) {
  if (compact && priority === 'normal') return null;
  return <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide', PRIORITY_STYLE[priority])}>{TICKET_PRIORITY_LABELS[priority]}</span>;
}

export function BlockedBadge() {
  return <span className="inline-flex items-center gap-0.5 rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-700"><Ban className="h-3 w-3" />Blocked</span>;
}

export function SlaTimer({ due, className }: { due: string | null; className?: string }) {
  const s = slaLabel(due);
  if (!s) return null;
  return <span className={cn('text-[11px] font-semibold', s.late ? 'text-red-600' : 'text-orange-600', className)} title="Time left to triage">⏱ {s.text}</span>;
}

/** The ticket key with a copy button. */
export function KeyChip({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" title="Copy" onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }); }}
      className={cn('group inline-flex items-center gap-1 rounded font-mono text-xs font-semibold text-gray-500 hover:text-gray-800', className)}>
      {value}
      {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3 opacity-0 group-hover:opacity-100" />}
    </button>
  );
}

export function Assignees({ people, max = 3 }: { people: PersonRef[]; max?: number }) {
  if (!people.length) return <span className="text-xs text-gray-400">Unassigned</span>;
  return (
    <span className="flex -space-x-1.5" title={people.map((p) => p.name).join(', ')}>
      {people.slice(0, max).map((p) => <Avatar key={p.id} name={p.name} size="sm" className="ring-2 ring-white" />)}
      {people.length > max && <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-200 text-[10px] font-semibold text-gray-600 ring-2 ring-white">+{people.length - max}</span>}
    </span>
  );
}
