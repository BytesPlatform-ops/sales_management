'use client';

import Link from 'next/link';
import { CalendarDays, CheckSquare, GitBranch, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Pill } from '@/components/training/ui';
import { fmtDay, today } from '@/components/projects/lib';
import { TicketCard, ticketHref } from './lib';
import { TypeIcon, TicketPriority, BlockedBadge, KeyChip, Assignees } from './bits';

/** One ticket on the board / backlog. */
export function Card({ t, draggable, onDragStart, onDragEnd, dragging, compact }: {
  t: TicketCard; draggable?: boolean; dragging?: boolean; compact?: boolean;
  onDragStart?: (e: React.DragEvent) => void; onDragEnd?: (e: React.DragEvent) => void;
}) {
  const overdue = t.due_date && t.due_date < today() && !['done', 'closed'].includes(t.status);
  return (
    <Link href={ticketHref(t.project_id, t.key)} draggable={draggable} onDragStart={onDragStart} onDragEnd={onDragEnd} data-nav-item
      className={cn('block rounded-xl border border-gray-200 bg-white p-2.5 shadow-sm transition hover:border-primary-300 hover:shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
        draggable && 'cursor-grab active:cursor-grabbing', dragging && 'opacity-40')}>
      <div className="flex items-center gap-1.5">
        <TypeIcon type={t.type} />
        <KeyChip value={t.key} />
        <span className="ml-auto flex items-center gap-1">{t.blocked && <BlockedBadge />}<TicketPriority priority={t.priority} compact /></span>
      </div>
      <p className={cn('mt-1 text-sm font-medium text-gray-900', compact ? 'line-clamp-1' : 'line-clamp-3')}>{t.title}</p>
      {!compact && (t.epic_title || t.labels.length > 0) && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {t.epic_title && <span className="inline-flex items-center gap-1 rounded bg-gray-50 px-1.5 py-0.5 text-[11px] text-gray-600"><span className="h-2 w-2 rounded-full" style={{ background: t.epic_color || '#6366f1' }} />{t.epic_title}</span>}
          {t.labels.map((l) => <span key={l.id} className="rounded px-1.5 py-0.5 text-[11px] font-medium text-white" style={{ background: l.color }}>{l.name}</span>)}
        </div>
      )}
      <div className="mt-2 flex items-center gap-2 text-[11px] text-gray-500">
        {t.due_date && <span className={cn('inline-flex items-center gap-0.5', overdue && 'font-semibold text-red-600')}><CalendarDays className="h-3 w-3" />{fmtDay(t.due_date, { noYear: true })}</span>}
        {t.checklist_total > 0 && <span className="inline-flex items-center gap-0.5"><CheckSquare className="h-3 w-3" />{t.checklist_done}/{t.checklist_total}</span>}
        {t.subtask_total > 0 && <span className="inline-flex items-center gap-0.5"><GitBranch className="h-3 w-3" />{t.subtask_done}/{t.subtask_total}</span>}
        {t.comment_count > 0 && <span className="inline-flex items-center gap-0.5"><MessageSquare className="h-3 w-3" />{t.comment_count}</span>}
        {t.cr_status === 'pending' && <Pill tone="amber">CR pending</Pill>}
        <span className="ml-auto"><Assignees people={t.assignees} /></span>
      </div>
    </Link>
  );
}
