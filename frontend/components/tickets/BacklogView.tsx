'use client';

import { useState } from 'react';
import { GripVertical, ListOrdered } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Empty } from '@/components/training/ui';
import { dropIndex, dropNeighbours } from '@/lib/tickets/board';
import { TicketCard } from './lib';
import { Card } from './Card';
import { useTicketPatch } from './actions';
import { TicketPerms } from './perms';

/**
 * Ranked backlog of accepted, unfinished top-level tickets. Developers/HR drag to
 * reorder; grouping by epic shows each epic's slice of the same ranking.
 */
export function BacklogView({ tickets, perms, byEpic, onChange }: { tickets: TicketCard[]; perms: TicketPerms; byEpic: boolean; onChange: () => void }) {
  const patch = useTicketPatch(onChange);
  const [dragId, setDragId] = useState<number | null>(null);
  const [over, setOver] = useState<{ group: string; index: number } | null>(null);

  if (!tickets.length) return <Empty icon={<ListOrdered className="h-6 w-6" />} title="Backlog is empty" body="Accepted tickets that aren’t done yet appear here, top = most important." />;

  const groups: { key: string; label: string; color?: string; items: TicketCard[] }[] = [];
  if (byEpic) {
    for (const t of tickets) {
      const key = t.epic_id ? `e${t.epic_id}` : 'none';
      let g = groups.find((x) => x.key === key);
      if (!g) { g = { key, label: t.epic_title || 'No epic', color: t.epic_color || undefined, items: [] }; groups.push(g); }
      g.items.push(t);
    }
    groups.sort((a, b) => (a.key === 'none' ? 1 : b.key === 'none' ? -1 : 0));
  } else groups.push({ key: 'all', label: '', items: tickets });

  async function drop(group: { key: string; items: TicketCard[] }, index: number) {
    const id = dragId;
    setDragId(null); setOver(null);
    if (id == null) return;
    // Rank is global: neighbours come from the full ranked list around the drop point in this group.
    const { after_id, before_id } = dropNeighbours(group.items.map((t) => t.id), id, index);
    if (after_id === id || before_id === id) return;
    const t = tickets.find((x) => x.id === id);
    if (!t) return;
    const body: Record<string, unknown> = { move: { after_id, before_id } };
    // Dropping into another epic's group moves it to that epic.
    if (byEpic && group.key !== (t.epic_id ? `e${t.epic_id}` : 'none')) body.epic_id = group.key === 'none' ? null : Number(group.key.slice(1));
    await patch(id, body);
  }

  return (
    <div className="space-y-4">
      {groups.map((g) => {
        const without = g.items.filter((t) => t.id !== dragId);
        return (
          <section key={g.key}
            onDragOver={perms.work && dragId != null ? (e) => { e.preventDefault(); if ((e.target as HTMLElement).dataset.groupEnd !== undefined) setOver({ group: g.key, index: without.length }); } : undefined}
            onDrop={perms.work ? (e) => { e.preventDefault(); drop(g, over?.group === g.key ? over.index : without.length); } : undefined}
            className={cn('rounded-xl', over?.group === g.key && 'ring-2 ring-primary-300')}>
            {byEpic && (
              <h3 className="mb-1.5 flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                {g.color && <span className="h-2.5 w-2.5 rounded-full" style={{ background: g.color }} />}{g.label} · {g.items.length}
              </h3>
            )}
            <ol className="space-y-1.5">
              {g.items.map((t) => {
                const idx = without.findIndex((x) => x.id === t.id);
                const rankNo = tickets.findIndex((x) => x.id === t.id) + 1;
                return (
                  <li key={t.id}
                    onDragOver={perms.work && dragId != null && dragId !== t.id ? (e) => { e.preventDefault(); e.stopPropagation(); setOver({ group: g.key, index: dropIndex(idx, e.clientY, e.currentTarget.getBoundingClientRect()) }); } : undefined}>
                    {over?.group === g.key && over.index === idx && dragId !== t.id && <div className="mb-1.5 h-1 rounded bg-primary-400" />}
                    <div className="flex items-center gap-2">
                      <span className="w-6 shrink-0 text-right text-xs tabular-nums text-gray-400">{rankNo}</span>
                      {perms.work && <GripVertical className="h-4 w-4 shrink-0 text-gray-300" aria-hidden />}
                      <div className="min-w-0 flex-1">
                        <Card t={t} compact draggable={perms.work} dragging={dragId === t.id}
                          onDragStart={(e) => { e.dataTransfer.setData('text/ticket-id', String(t.id)); e.dataTransfer.effectAllowed = 'move'; setDragId(t.id); }}
                          onDragEnd={() => { setDragId(null); setOver(null); }} />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
            {over?.group === g.key && over.index >= without.length && dragId != null && <div className="mt-1.5 h-1 rounded bg-primary-400" />}
            <div data-group-end className="h-4" />
          </section>
        );
      })}
    </div>
  );
}
