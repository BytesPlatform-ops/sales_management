'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Btn } from '@/components/training/ui';
import { ChatThread } from '@/components/chat/ChatThread';
import { ChatAdapter, ChatMessage, ChatPoll } from '@/components/chat/types';
import { BRIEF_TYPES, BRIEF_TYPE_LABELS } from '@/lib/brief/rules';
import { Modal, Field, selectCls, useToast } from './ui';
import { ReminderModal } from '@/components/reminders/Reminders';
import { papi, usePapi, Role } from './lib';

/**
 * The project thread: the shared chat engine (components/chat) pointed at
 * /api/projects/{id}/messages, plus project-only actions (forward, add to the
 * brief timeline, create a ticket).
 */
export function Thread({ projectId, meId, role, canBrief, canCreateTicket, active = true, onSystemMessage, className, refreshKey }: {
  projectId: number; meId: string | number | undefined; role: Role; canBrief?: boolean; canCreateTicket?: boolean; active?: boolean;
  onSystemMessage?: () => void; className?: string; refreshKey?: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [forwarding, setForwarding] = useState<ChatMessage | null>(null);
  const [briefing, setBriefing] = useState<ChatMessage | null>(null);
  const [reminding, setReminding] = useState<ChatMessage | null>(null);
  const base = `/api/projects/${projectId}/messages`;

  const adapter = useMemo<ChatAdapter>(() => ({
    key: `project-${projectId}`,
    poll: (after, since) => papi<ChatPoll>(`${base}${after ? `?after=${after}${since ? `&since=${encodeURIComponent(since)}` : ''}` : ''}`),
    send: (body, replyTo) => papi<ChatMessage>(base, { body: { body, reply_to: replyTo } }),
    createDraft: ({ kind, body, replyTo, meta }) => papi<{ id: number }>(base, { body: { kind, body, reply_to: replyTo, meta, draft: true } }),
    attachTarget: (id) => ({ entity_type: 'message', entity_id: id }),
    publish: (id) => papi<ChatMessage>(`${base}/${id}/publish`, { method: 'POST', body: {} }),
    discard: async (id) => { await papi(`${base}/${id}`, { method: 'DELETE' }); },
    edit: (id, body) => papi<ChatMessage>(`${base}/${id}`, { method: 'PATCH', body: { body } }),
    remove: async (id) => { await papi(`${base}/${id}`, { method: 'DELETE' }); },
    pin: (id, pinned) => papi<ChatMessage>(`${base}/${id}/pin`, { method: 'POST', body: { pinned } }),
    pinned: () => papi<ChatMessage[]>(`${base}/pinned`),
    mediaUrl: `/api/media?project_id=${projectId}&entity_types=message`,
    actions: [
      { label: 'Forward to project…', show: () => role === 'hr', run: (m) => setForwarding(m) },
      { label: 'Add to brief timeline', show: (m) => !!canBrief && m.kind !== 'system', run: (m) => setBriefing(m) },
      { label: 'Remind me', show: (m) => m.kind !== 'system', run: (m) => setReminding(m) },
      {
        label: 'Create ticket', show: (m) => !!canCreateTicket && m.kind !== 'system',
        run: async (m) => {
          const first = (m.body.split('\n').find((l) => l.trim()) || (m.kind === 'voice' ? 'Voice note from the thread' : 'From the project thread')).trim();
          const t = await papi<{ key: string; status: string }>(`/api/projects/${projectId}/tickets`, {
            body: { title: first.slice(0, 300), description: `${m.body}\n\n_From the project thread — ${m.author || 'someone'}, ${new Date(m.created_at).toLocaleString()}._` },
          });
          toast(t.status === 'triage' ? `${t.key} sent to Triage` : `${t.key} created`);
          router.push(`/projects/${projectId}/tickets/${t.key}`);
        },
      },
    ],
  }), [projectId, base, role, canBrief, canCreateTicket, router, toast]);

  return (
    <>
      <ChatThread adapter={adapter} me={{ id: meId, role }} active={active} onSystemMessage={onSystemMessage} refreshKey={refreshKey} className={className} />
      <ForwardModal msg={forwarding} projectId={projectId} onClose={() => setForwarding(null)} />
      <BriefModal msg={briefing} projectId={projectId} onClose={() => setBriefing(null)} />
      {reminding && (
        <ReminderModal entityType="message" entityId={reminding.id} onClose={() => setReminding(null)}
          defaultTitle={(reminding.body.split('\n').find((l) => l.trim()) || 'Message in the project thread').trim().slice(0, 200)} />
      )}
    </>
  );
}

function ForwardModal({ msg, projectId, onClose }: { msg: ChatMessage | null; projectId: number; onClose: () => void }) {
  const { data } = usePapi<{ projects: { id: number; ticket_no: string; title: string; client_name: string }[] } | any[]>(msg ? '/api/projects?view=all' : null);
  const list = (Array.isArray(data) ? data : data?.projects || []).filter((p: any) => p.id !== projectId);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <Modal open={!!msg} onClose={onClose} title="Forward message" size="sm"
      footer={<>
        <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
        <Btn disabled={!target || busy} onClick={async () => {
          setBusy(true);
          try { await papi(`/api/projects/${projectId}/messages/${msg!.id}/forward`, { method: 'POST', body: { project_id: Number(target) } }); toast('Forwarded'); onClose(); }
          catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
        }}>Forward</Btn>
      </>}>
      <Field label="To project" htmlFor="fwd-project">
        <select id="fwd-project" className={selectCls} value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">Choose…</option>
          {list.map((p: any) => <option key={p.id} value={p.id}>{p.ticket_no} · {p.title} ({p.client_name})</option>)}
        </select>
      </Field>
    </Modal>
  );
}

function BriefModal({ msg, projectId, onClose }: { msg: ChatMessage | null; projectId: number; onClose: () => void }) {
  const [type, setType] = useState('feedback');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <Modal open={!!msg} onClose={onClose} title="Add to brief timeline" size="sm"
      footer={<>
        <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
        <Btn disabled={busy} onClick={async () => {
          setBusy(true);
          try { await papi(`/api/projects/${projectId}/messages/${msg!.id}/brief`, { method: 'POST', body: { type } }); toast('Added to the brief'); onClose(); }
          catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
        }}>Add</Btn>
      </>}>
      <p className={cn('mb-3 rounded-lg bg-gray-50 p-2 text-sm text-gray-700 line-clamp-4')}>{msg?.body || 'Files / voice note'}</p>
      <Field label="Type" htmlFor="brief-type">
        <select id="brief-type" className={selectCls} value={type} onChange={(e) => setType(e.target.value)}>
          {BRIEF_TYPES.map((t) => <option key={t} value={t}>{BRIEF_TYPE_LABELS[t]}</option>)}
        </select>
      </Field>
      <p className="mt-2 text-xs text-gray-500">Its files are copied to the brief update too.</p>
    </Modal>
  );
}
