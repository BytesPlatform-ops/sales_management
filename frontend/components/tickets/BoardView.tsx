'use client';

import { useState } from 'react';
import { LayoutGrid, Plus, Settings2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Btn, Empty, inputCls } from '@/components/training/ui';
import { Modal, Field, useToast } from '@/components/projects/ui';
import { papi, usePapi } from '@/components/projects/lib';
import { dropIndex, dropNeighbours, laneGroups, Swimlane, WipLimits, wipState } from '@/lib/tickets/board';
import { TicketCard, TicketStatus, WORK_STATUSES, TICKET_STATUS_LABELS } from './lib';
import { TicketStatusPill } from './bits';
import { Card } from './Card';
import { useTicketPatch } from './actions';
import { TicketPerms } from './perms';

const WIP_STYLE = { none: 'text-gray-500', ok: 'text-gray-500', near: 'text-amber-600 font-bold', over: 'text-red-600 font-bold' } as const;

/**
 * Kanban: drag between columns (status) and within a column (order). Optional
 * swimlanes. WIP limits colour the column header but never block a move.
 */
export function BoardView({ pid, tickets, perms, swimlane, onChange }: {
  pid: number; tickets: TicketCard[]; perms: TicketPerms; swimlane: Swimlane; onChange: () => void;
}) {
  const patch = useTicketPatch(onChange);
  const toast = useToast();
  const { data: settings, mutate: mutateSettings } = usePapi<{ wip_limits: WipLimits }>(`/api/projects/${pid}/board-settings`);
  const wip = settings?.wip_limits || {};
  const [dragId, setDragId] = useState<number | null>(null);
  const [over, setOver] = useState<{ col: string; index: number } | null>(null);
  const [wipOpen, setWipOpen] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [quickTitle, setQuickTitle] = useState('');

  const lanes = laneGroups(tickets, swimlane);
  const colCount = (s: TicketStatus) => tickets.filter((t) => t.status === s).length;

  async function drop(status: TicketStatus, column: TicketCard[], index: number) {
    const id = dragId;
    setDragId(null); setOver(null);
    if (id == null) return;
    const t = tickets.find((x) => x.id === id);
    if (!t) return;
    const { after_id, before_id } = dropNeighbours(column.map((c) => c.id), id, index);
    const sameSpot = t.status === status && column.findIndex((c) => c.id === id) === index;
    if (sameSpot) return;
    await patch(id, { ...(t.status !== status ? { status } : {}), move: { after_id, before_id } });
  }

  async function quickAdd(status: TicketStatus) {
    const title = quickTitle.trim();
    if (!title) { setAdding(null); return; }
    try {
      const r = await papi<{ key: string; status: string }>(`/api/projects/${pid}/tickets`, { method: 'POST', body: { title, status: perms.work ? status : undefined } });
      setQuickTitle('');
      toast(r.status === 'triage' ? `${r.key} sent to Triage` : `${r.key} created`);
      onChange();
    } catch (e) { toast((e as Error).message, 'error'); }
  }

  if (!tickets.length && !perms.create) return <Empty icon={<LayoutGrid className="h-6 w-6" />} title="No tickets here yet" body="Check Triage for new requests." />;

  return (
    <div>
      {perms.work && (
        <div className="mb-2 flex justify-end">
          <button type="button" onClick={() => setWipOpen(true)} className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-800">
            <Settings2 className="h-3.5 w-3.5" />WIP limits
          </button>
        </div>
      )}
      <div className="-mx-1 overflow-x-auto px-1 pb-2">
        <div className="inline-flex min-w-full flex-col gap-4">
          {lanes.map((lane) => (
            <div key={lane.key}>
              {swimlane !== 'none' && <h3 className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{lane.label} · {lane.tickets.length}</h3>}
              <div className="flex gap-3">
                {WORK_STATUSES.map((s) => {
                  const column = lane.tickets.filter((t) => t.status === s);
                  const colKey = `${lane.key}:${s}`;
                  const state = wipState(colCount(s), wip[s]);
                  return (
                    <div key={s}
                      onDragOver={perms.work && dragId != null ? (e) => {
                        e.preventDefault();
                        // Hovering the empty area of a column = drop at the end.
                        if ((e.target as HTMLElement).dataset.colEnd !== undefined) setOver({ col: colKey, index: column.filter((c) => c.id !== dragId).length });
                      } : undefined}
                      onDrop={perms.work ? (e) => { e.preventDefault(); drop(s, column, over?.col === colKey ? over.index : column.filter((c) => c.id !== dragId).length); } : undefined}
                      className={cn('flex w-72 shrink-0 flex-col rounded-2xl bg-gray-50 p-2', over?.col === colKey && 'ring-2 ring-primary-400',
                        state === 'over' && 'bg-red-50/60', state === 'near' && 'bg-amber-50/60')}>
                      {lane === lanes[0] || swimlane !== 'none' ? (
                        <div className="mb-2 flex items-center justify-between px-1">
                          <TicketStatusPill status={s} />
                          <span className={cn('text-xs', WIP_STYLE[state])} title={wip[s] ? `WIP limit ${wip[s]}` : undefined}>
                            {colCount(s)}{wip[s] ? ` / ${wip[s]}` : ''}
                          </span>
                        </div>
                      ) : null}
                      <div className="flex min-h-[3rem] flex-1 flex-col gap-2">
                        {column.map((t) => {
                          const idxWithout = column.filter((c) => c.id !== dragId).findIndex((c) => c.id === t.id);
                          return (
                            <div key={t.id}
                              onDragOver={perms.work && dragId != null && dragId !== t.id ? (e) => {
                                e.preventDefault(); e.stopPropagation();
                                setOver({ col: colKey, index: dropIndex(idxWithout, e.clientY, e.currentTarget.getBoundingClientRect()) });
                              } : undefined}>
                              {over?.col === colKey && over.index === idxWithout && dragId !== t.id && <div className="mb-2 h-1 rounded bg-primary-400" />}
                              <Card t={t} draggable={perms.work} dragging={dragId === t.id}
                                onDragStart={(e) => { e.dataTransfer.setData('text/ticket-id', String(t.id)); e.dataTransfer.effectAllowed = 'move'; setDragId(t.id); }}
                                onDragEnd={() => { setDragId(null); setOver(null); }} />
                            </div>
                          );
                        })}
                        {over?.col === colKey && over.index >= column.filter((c) => c.id !== dragId).length && dragId != null && <div className="h-1 rounded bg-primary-400" />}
                        <div data-col-end className="min-h-[1.5rem] flex-1" />
                      </div>
                      {perms.create && (perms.work || s === 'open') && (
                        adding === colKey ? (
                          <form className="mt-2" onSubmit={(e) => { e.preventDefault(); quickAdd(s); }}>
                            <input autoFocus className={cn(inputCls, 'py-1.5 text-sm')} placeholder="Ticket title, Enter to add" value={quickTitle}
                              onChange={(e) => setQuickTitle(e.target.value)} onBlur={() => { if (!quickTitle.trim()) setAdding(null); }}
                              onKeyDown={(e) => { if (e.key === 'Escape') { setQuickTitle(''); setAdding(null); } }} aria-label={`New ticket in ${TICKET_STATUS_LABELS[s]}`} />
                            {!perms.work && <p className="mt-1 text-[11px] text-gray-500">Goes to Triage first.</p>}
                          </form>
                        ) : (
                          <button type="button" onClick={() => { setAdding(colKey); setQuickTitle(''); }}
                            className="mt-2 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-gray-500 hover:bg-white hover:text-gray-800">
                            <Plus className="h-3.5 w-3.5" />Add ticket
                          </button>
                        )
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      <WipModal open={wipOpen} onClose={() => setWipOpen(false)} pid={pid} limits={wip} onSaved={() => { setWipOpen(false); mutateSettings(); }} />
    </div>
  );
}

function WipModal({ open, onClose, pid, limits, onSaved }: { open: boolean; onClose: () => void; pid: number; limits: WipLimits; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState<Record<string, string>>({});
  const value = (s: string) => form[s] ?? (limits[s as TicketStatus] ? String(limits[s as TicketStatus]) : '');
  return (
    <Modal open={open} onClose={() => { setForm({}); onClose(); }} title="WIP limits" size="sm"
      footer={<>
        <Btn variant="secondary" onClick={() => { setForm({}); onClose(); }}>Cancel</Btn>
        <Btn onClick={async () => {
          const wip_limits = Object.fromEntries(WORK_STATUSES.map((s) => [s, Number(value(s)) || undefined]));
          try { await papi(`/api/projects/${pid}/board-settings`, { method: 'PUT', body: { wip_limits } }); setForm({}); onSaved(); }
          catch (e) { toast((e as Error).message, 'error'); }
        }}>Save</Btn>
      </>}>
      <p className="mb-3 text-sm text-gray-600">Columns turn amber at the limit and red above it. Limits only warn — they never stop a move. Leave blank for no limit.</p>
      <div className="grid grid-cols-2 gap-3">
        {WORK_STATUSES.map((s) => (
          <Field key={s} label={TICKET_STATUS_LABELS[s]} htmlFor={`wip-${s}`}>
            <input id={`wip-${s}`} type="number" min={1} max={999} className={inputCls} value={value(s)} onChange={(e) => setForm({ ...form, [s]: e.target.value })} />
          </Field>
        ))}
      </div>
    </Modal>
  );
}
