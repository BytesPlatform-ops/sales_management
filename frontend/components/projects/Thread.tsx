'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Send, Reply, Pencil, X, Loader2, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Btn, ErrorNote } from '@/components/training/ui';
import { Avatar, RoleBadge, useToast } from './ui';
import { papi, Message, relTime, fmtExact, sameId, fmtDay } from './lib';

const POLL_MS = 5000;

/**
 * Project chat: loads the whole thread, then polls `?after=<lastId>` every 5 s
 * while the tab is visible. `onSystemMessage` fires when someone else's
 * automatic entry arrives (status/dates changed) so the page can refresh.
 */
export function Thread({ projectId, meId, onSystemMessage, className, refreshKey }: {
  projectId: number; meId: string | number | undefined; onSystemMessage?: () => void; className?: string; refreshKey?: number;
}) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [sending, setSending] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const lastId = useRef(0);
  const stickToBottom = useRef(true);
  const busy = useRef(false);
  const toast = useToast();
  const onSys = useRef(onSystemMessage);
  onSys.current = onSystemMessage;

  const merge = useCallback((rows: Message[]) => {
    if (!rows.length) return;
    setMessages((prev) => {
      const map = new Map((prev || []).map((m) => [m.id, m]));
      for (const r of rows) map.set(r.id, r);
      return Array.from(map.values()).sort((a, b) => a.id - b.id);
    });
    lastId.current = Math.max(lastId.current, ...rows.map((r) => r.id));
  }, []);

  const poll = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const first = lastId.current === 0;
      const rows = await papi<Message[]>(`/api/projects/${projectId}/messages${first ? '' : `?after=${lastId.current}`}`);
      if (first) {
        setMessages(rows);
        lastId.current = rows.length ? rows[rows.length - 1].id : 0;
        if (!rows.length) lastId.current = 0;
      } else {
        merge(rows);
        if (rows.some((r) => r.kind === 'system' && !sameId(r.user_id, meId))) onSys.current?.();
      }
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
      setMessages((m) => m || []);
    } finally {
      busy.current = false;
    }
  }, [projectId, meId, merge]);

  // Initial load + polling (paused while the tab is hidden).
  useEffect(() => {
    lastId.current = 0;
    setMessages(null);
    poll();
    const t = setInterval(() => { if (!document.hidden) poll(); }, POLL_MS);
    const vis = () => { if (!document.hidden) poll(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, [poll]);

  // Parent changed something (status, dates…) → fetch the new system entry now.
  useEffect(() => { if (refreshKey) poll(); }, [refreshKey, poll]);

  // Auto-scroll to newest when already near the bottom (or on first load / own message).
  const count = messages?.length || 0;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [count]);
  const onScroll = () => {
    const el = scroller.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const send = async () => {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      if (editing) {
        const row = await papi<Message>(`/api/projects/${projectId}/messages`, { method: 'PATCH', body: { id: editing.id, body: text } });
        merge([row]);
        setEditing(null);
      } else {
        const row = await papi<Message>(`/api/projects/${projectId}/messages`, { body: { body: text, reply_to: replyTo?.id } });
        stickToBottom.current = true;
        merge([row]);
        setReplyTo(null);
      }
      setBody('');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSending(false);
      input.current?.focus();
    }
  };

  const startEdit = (m: Message) => { setReplyTo(null); setEditing(m); setBody(m.body); setTimeout(() => input.current?.focus(), 0); };
  const startReply = (m: Message) => { setEditing(null); setReplyTo(m); setTimeout(() => input.current?.focus(), 0); };
  const cancelCompose = () => { setEditing(null); setReplyTo(null); setBody(''); };

  // Group by day for date separators.
  let lastDay = '';

  return (
    <div className={cn('flex flex-col bg-white rounded-2xl border border-gray-200 shadow-sm min-w-0', className)}>
      <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 sm:px-5 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Thread</h2>
        <span className="text-xs text-gray-400">Updates every few seconds</span>
      </div>

      <div ref={scroller} onScroll={onScroll} className="flex-1 min-h-[320px] max-h-[62vh] lg:max-h-none lg:h-[560px] overflow-y-auto px-3 sm:px-5 py-4 space-y-3" aria-live="polite" aria-label="Project messages">
        {messages === null ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading thread…</div>
        ) : messages.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-500">
            <MessageSquare className="mx-auto mb-2 h-6 w-6 text-gray-300" />No messages yet. Say hello to the team.
          </div>
        ) : messages.map((m) => {
          const day = new Date(m.created_at).toDateString();
          const sep = day !== lastDay ? (lastDay = day, <DaySep key={`d${m.id}`} iso={m.created_at} />) : null;
          if (m.kind === 'system') {
            return (
              <div key={m.id}>
                {sep}
                <div className="flex justify-center">
                  <p className="max-w-[90%] text-center text-xs text-gray-500 bg-gray-50 rounded-full px-3 py-1" title={fmtExact(m.created_at)}>
                    {m.body} <span className="text-gray-400">· {relTime(m.created_at)}</span>
                  </p>
                </div>
              </div>
            );
          }
          const mine = sameId(m.user_id, meId);
          return (
            <div key={m.id}>
              {sep}
              <div className={cn('group flex items-end gap-2', mine && 'flex-row-reverse')}>
                {!mine && <Avatar name={m.author} size="sm" className="mb-1" />}
                <div className={cn('flex min-w-0 max-w-[85%] sm:max-w-[75%] flex-col', mine ? 'items-end' : 'items-start')}>
                  <div className={cn('mb-0.5 flex flex-wrap items-center gap-1.5 text-xs', mine && 'justify-end')}>
                    <span className="font-medium text-gray-700">{mine ? 'You' : m.author || 'Someone'}</span>
                    <RoleBadge role={m.author_role} />
                    <time dateTime={m.created_at} title={fmtExact(m.created_at)} className="text-gray-400">{relTime(m.created_at)}</time>
                    {m.edited_at && <span className="text-gray-400" title={`Edited ${fmtExact(m.edited_at)}`}>(edited)</span>}
                  </div>
                  <div className={cn('rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere]',
                    mine ? 'bg-primary-600 text-white rounded-br-md' : 'bg-gray-100 text-gray-900 rounded-bl-md',
                    editing?.id === m.id && 'ring-2 ring-amber-400')}>
                    {m.reply_to && (
                      <div className={cn('mb-1.5 rounded-lg border-l-2 px-2 py-1 text-xs', mine ? 'border-white/60 bg-white/10 text-white/90' : 'border-gray-400 bg-white/70 text-gray-600')}>
                        <span className="font-semibold">{m.reply_author || 'Message'}</span>: {(m.reply_body || 'Original message removed').slice(0, 140)}{(m.reply_body || '').length > 140 ? '…' : ''}
                      </div>
                    )}
                    {m.body}
                  </div>
                  <div className={cn('mt-0.5 flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity', mine && 'justify-end')}>
                    <button type="button" onClick={() => startReply(m)} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
                      <Reply className="h-3 w-3" /> Reply
                    </button>
                    {mine && (
                      <button type="button" onClick={() => startEdit(m)} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
                        <Pencil className="h-3 w-3" /> Edit
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-gray-100 p-3 sm:p-4">
        {loadError && <ErrorNote error={`Couldn’t refresh the thread: ${loadError}`} />}
        {(replyTo || editing) && (
          <div className="mb-2 flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
            {editing ? <Pencil className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-600" /> : <Reply className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary-600" />}
            <div className="min-w-0 flex-1 truncate">
              {editing ? 'Editing your message' : <>Replying to <strong>{replyTo?.author}</strong>: {replyTo?.body}</>}
            </div>
            <button type="button" onClick={cancelCompose} className="rounded p-0.5 hover:bg-gray-200" aria-label={editing ? 'Cancel edit' : 'Cancel reply'}><X className="h-3.5 w-3.5" /></button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <label htmlFor={`composer-${projectId}`} className="sr-only">Write a message</label>
          <textarea id={`composer-${projectId}`} ref={input} rows={2} value={body} onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
              if (e.key === 'Escape' && (editing || replyTo)) cancelCompose();
            }}
            placeholder={editing ? 'Edit your message…' : 'Write a message…'}
            className="min-h-[44px] max-h-40 flex-1 resize-y rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
          <Btn onClick={send} disabled={sending || !body.trim()} className="h-11 shrink-0">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            <span className="hidden sm:inline">{editing ? 'Save' : 'Send'}</span>
          </Btn>
        </div>
        <p className="mt-1 hidden sm:block text-[11px] text-gray-400">Enter to send · Shift+Enter for a new line</p>
      </div>
    </div>
  );
}

function DaySep({ iso }: { iso: string }) {
  const d = new Date(iso);
  const t = new Date();
  const y = new Date(); y.setDate(t.getDate() - 1);
  const label = d.toDateString() === t.toDateString() ? 'Today' : d.toDateString() === y.toDateString() ? 'Yesterday' : fmtDay(iso, { weekday: true });
  return (
    <div className="flex items-center gap-3 py-1" role="separator">
      <div className="h-px flex-1 bg-gray-100" /><span className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{label}</span><div className="h-px flex-1 bg-gray-100" />
    </div>
  );
}
