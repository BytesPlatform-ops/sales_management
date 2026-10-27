'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Send, Reply, Pencil, X, Loader2, MessageSquare, Paperclip, MoreHorizontal, Copy, Trash2, Pin, PinOff, Eye, Check, CheckCheck,
  ArrowDown, Forward, Link2, RotateCcw, Image as ImageIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Btn, ErrorNote } from '@/components/training/ui';
import { Avatar, RoleBadge, useConfirm, useToast } from '@/components/projects/ui';
import { relTime, fmtExact, sameId, fmtDay, usePapi } from '@/components/projects/lib';
import { FileTile } from '@/components/tickets/Attachments';
import { fmtSize, MediaFile } from '@/components/tickets/lib';
import { MAX_MB } from '@/components/tickets/Attachments';
import { canDeleteMessage, canEditMessage, linksIn, readStatus, seenBy } from '@/lib/chat/rules';
import { ChatAdapter, ChatMessage, ChatRead } from './types';
import { MessageMedia } from './MessageMedia';
import { VoiceRecorder, Recording } from './Voice';
import { uploadToTarget } from './upload';

const ACTIVE_POLL = 5000;
const BACKGROUND_POLL = 30000;

interface PendingFile { key: string; file: File; progress: number; error?: string; mediaId?: string }

/**
 * A WhatsApp-style message stream. Everything stream-specific (URLs, extra actions)
 * comes from the adapter, so project threads and team channels share this.
 */
export function ChatThread({ adapter, me, title = 'Thread', active = true, onSystemMessage, refreshKey, className }: {
  adapter: ChatAdapter;
  me: { id: number | string | undefined; role: 'hr' | 'agent' | 'developer' };
  title?: string;
  active?: boolean;
  onSystemMessage?: () => void;
  refreshKey?: number;
  className?: string;
}) {
  const [tab, setTab] = useState<'chat' | 'media' | 'pinned'>('chat');
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [reads, setReads] = useState<ChatRead[]>([]);
  const [participants, setParticipants] = useState<number[]>([]);
  const [firstUnread, setFirstUnread] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hideSystem, setHideSystem] = useState(false);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [showJump, setShowJump] = useState(false);
  const lastId = useRef(0);
  const since = useRef<string | null>(null);
  const busy = useRef(false);
  const stick = useRef(true);
  const scroller = useRef<HTMLDivElement>(null);
  const onSys = useRef(onSystemMessage);
  onSys.current = onSystemMessage;
  const meNum = me.id !== undefined ? Number(me.id) : -1;
  const hideKey = `chat-hide-system:${adapter.key}`;

  useEffect(() => { try { setHideSystem(localStorage.getItem(hideKey) === '1'); } catch { /* private mode */ } }, [hideKey]);

  const merge = useCallback((rows: ChatMessage[]) => {
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
      const first = lastId.current === 0 && since.current === null;
      const r = await adapter.poll(lastId.current, since.current);
      since.current = r.now;
      setReads(r.reads);
      setParticipants(r.participants.map(Number));
      if (first) {
        setMessages(r.messages);
        lastId.current = r.messages.length ? r.messages[r.messages.length - 1].id : 0;
        const fu = r.messages.find((m) => m.id > r.last_read && Number(m.user_id) !== meNum && m.kind !== 'system');
        setFirstUnread(fu ? fu.id : null);
        if (fu) stick.current = false;
      } else {
        merge([...r.changed, ...r.messages]);
        if (r.messages.some((m) => m.kind === 'system' && Number(m.user_id) !== meNum)) onSys.current?.();
      }
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
      setMessages((m) => m || []);
    } finally {
      busy.current = false;
    }
  }, [adapter, merge, meNum]);

  // Load, then poll: every 5 s while this thread is on screen, every 30 s otherwise.
  useEffect(() => {
    lastId.current = 0;
    since.current = null;
    setMessages(null);
    poll();
  }, [poll]);
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) poll(); }, active ? ACTIVE_POLL : BACKGROUND_POLL);
    const vis = () => { if (!document.hidden) poll(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, [poll, active]);
  useEffect(() => { if (refreshKey) poll(); }, [refreshKey, poll]);

  const scrollTo = useCallback((id: number) => {
    setTab('chat');
    setTimeout(() => {
      const el = document.getElementById(`${adapter.key}-m-${id}`);
      if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); setHighlight(id); setTimeout(() => setHighlight(null), 1800); }
    }, 30);
  }, [adapter.key]);

  // First load: jump to a #m-<id> link, else to the first unread, else the bottom.
  const loaded = messages !== null;
  useLayoutEffect(() => {
    if (!loaded) return;
    const hash = typeof window !== 'undefined' ? /#m-(\d+)/.exec(window.location.hash) : null;
    if (hash) { scrollTo(Number(hash[1])); return; }
    if (firstUnread) {
      document.getElementById(`${adapter.key}-unread`)?.scrollIntoView({ block: 'start' });
    } else if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const count = messages?.length || 0;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [count]);
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setShowJump(!stick.current);
  };

  const readMap = useMemo(() => new Map(reads.map((r) => [Number(r.user_id), Number(r.last_read)])), [reads]);
  const names = useMemo(() => new Map(reads.map((r) => [Number(r.user_id), r.name])), [reads]);

  const visible = (messages || []).filter((m) => !(hideSystem && m.kind === 'system'));
  let lastDay = '';

  return (
    <div className={cn('flex flex-col rounded-2xl border border-gray-200 bg-white shadow-sm min-w-0', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-2.5 sm:px-5">
        <div role="tablist" aria-label={`${title} sections`} className="inline-flex gap-1 rounded-xl bg-gray-100 p-1">
          {(['chat', 'media', 'pinned'] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
              className={cn('rounded-lg px-3 py-1 text-sm font-medium', tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900')}>
              {t === 'chat' ? title : t === 'media' ? 'Media' : 'Pinned'}
            </button>
          ))}
        </div>
        {tab === 'chat' && (
          <label className="inline-flex items-center gap-1.5 text-xs text-gray-500">
            <input type="checkbox" checked={hideSystem} onChange={(e) => { setHideSystem(e.target.checked); try { localStorage.setItem(hideKey, e.target.checked ? '1' : '0'); } catch { /* ignore */ } }} />
            Hide automatic updates
          </label>
        )}
      </div>

      {tab === 'media' && <MediaPanel adapter={adapter} meId={me.id} isHr={me.role === 'hr'} />}
      {tab === 'pinned' && <PinnedPanel adapter={adapter} onJump={scrollTo} onChanged={(m) => merge([m])} />}

      <div className={cn('relative flex min-h-0 flex-1 flex-col', tab !== 'chat' && 'hidden')}>
        <div ref={scroller} onScroll={onScroll}
          className="min-h-[320px] max-h-[62vh] flex-1 space-y-3 overflow-y-auto px-3 py-4 sm:px-5 lg:h-[560px] lg:max-h-none"
          aria-live="polite" aria-label="Messages">
          {messages === null ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : visible.length === 0 ? (
            <div className="py-16 text-center text-sm text-gray-500"><MessageSquare className="mx-auto mb-2 h-6 w-6 text-gray-300" />No messages yet. Say hello to the team.</div>
          ) : visible.map((m) => {
            const day = new Date(m.created_at).toDateString();
            const sep = day !== lastDay ? (lastDay = day, <DaySep key={`d${m.id}`} iso={m.created_at} />) : null;
            const unread = m.id === firstUnread ? (
              <div key={`u${m.id}`} id={`${adapter.key}-unread`} className="flex items-center gap-3 py-1" role="separator">
                <div className="h-px flex-1 bg-primary-200" /><span className="text-[11px] font-semibold uppercase tracking-wide text-primary-600">New messages</span><div className="h-px flex-1 bg-primary-200" />
              </div>
            ) : null;
            return (
              <div key={m.id} id={`${adapter.key}-m-${m.id}`}>
                {sep}{unread}
                {m.kind === 'system' ? (
                  <div className="flex justify-center">
                    <p className="max-w-[90%] rounded-full bg-gray-50 px-3 py-1 text-center text-xs text-gray-500" title={fmtExact(m.created_at)}>
                      {m.body} <span className="text-gray-400">· {relTime(m.created_at)}</span>
                    </p>
                  </div>
                ) : (
                  <Bubble m={m} me={me} adapter={adapter} highlight={highlight === m.id} onJump={scrollTo} onChanged={merge}
                    status={sameId(m.user_id, me.id) ? readStatus(m.id, meNum, participants, readMap) : null}
                    seen={seenBy(m.id, m.user_id != null ? Number(m.user_id) : null, participants, readMap).map((id) => names.get(id) || 'Someone')} />
                )}
              </div>
            );
          })}
        </div>
        {(showJump || (firstUnread && !stick.current)) && (
          <button type="button" onClick={() => { if (scroller.current) { scroller.current.scrollTop = scroller.current.scrollHeight; stick.current = true; setShowJump(false); } }}
            className="absolute bottom-24 right-4 flex h-9 w-9 items-center justify-center rounded-full bg-white text-gray-600 shadow-md ring-1 ring-gray-200 hover:text-gray-900" aria-label="Jump to latest">
            <ArrowDown className="h-4 w-4" />
          </button>
        )}
        {firstUnread && (
          <button type="button" onClick={() => document.getElementById(`${adapter.key}-unread`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })}
            className="absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-primary-600 px-3 py-1 text-xs font-medium text-white shadow hover:bg-primary-700">
            Jump to first unread
          </button>
        )}
        {loadError && <div className="px-4"><ErrorNote error={`Couldn’t refresh: ${loadError}`} /></div>}
        <Composer adapter={adapter} onSent={(m) => { stick.current = true; setFirstUnread(null); merge([m]); }} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ one message

function Bubble({ m, me, adapter, highlight, onJump, onChanged, status, seen }: {
  m: ChatMessage; me: { id: number | string | undefined; role: 'hr' | 'agent' | 'developer' }; adapter: ChatAdapter; highlight: boolean;
  onJump: (id: number) => void; onChanged: (rows: ChatMessage[]) => void; status: 'sent' | 'read' | null; seen: string[];
}) {
  const mine = sameId(m.user_id, me.id);
  const viewer = { userId: Number(me.id), role: me.role };
  const facts = { user_id: m.user_id, created_at: m.created_at, kind: m.kind, deleted_at: m.deleted_at };
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.body);
  const [showSeen, setShowSeen] = useState(false);
  const confirm = useConfirm();
  const toast = useToast();
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);

  const deleted = !!m.deleted_at;
  const links = deleted ? [] : linksIn(m.body);
  const extra = (adapter.actions || []).filter((a) => !deleted && a.show(m));

  async function act(fn: () => Promise<unknown>, ok?: string) {
    setMenu(false);
    try { await fn(); if (ok) toast(ok); } catch (e) { toast((e as Error).message, 'error'); }
  }

  return (
    <div className={cn('group flex items-end gap-2', mine && 'flex-row-reverse')}
      onTouchStart={() => { press.current = setTimeout(() => setMenu(true), 450); }}
      onTouchEnd={() => { if (press.current) clearTimeout(press.current); }}>
      {!mine && <Avatar name={m.author} size="sm" className="mb-1" />}
      <div className={cn('flex min-w-0 max-w-[85%] flex-col sm:max-w-[75%]', mine ? 'items-end' : 'items-start')}>
        <div className={cn('mb-0.5 flex flex-wrap items-center gap-1.5 text-xs', mine && 'justify-end')}>
          <span className="font-medium text-gray-700">{mine ? 'You' : m.author || 'Someone'}</span>
          <RoleBadge role={m.author_role} />
          <time dateTime={m.created_at} title={fmtExact(m.created_at)} className="text-gray-400">{relTime(m.created_at)}</time>
          {m.edited_at && !deleted && <span className="text-gray-400" title={`Edited ${fmtExact(m.edited_at)}`}>(edited)</span>}
          {m.pinned_at && <Pin className="h-3 w-3 text-amber-500" aria-label={`Pinned${m.pinned_by_name ? ` by ${m.pinned_by_name}` : ''}`} />}
        </div>
        <div className={cn('relative rounded-2xl px-3.5 py-2 text-sm break-words [overflow-wrap:anywhere] transition-shadow',
          deleted ? 'border border-dashed border-gray-300 bg-white text-gray-400 italic'
            : mine ? 'rounded-br-md bg-primary-600 text-white' : 'rounded-bl-md bg-gray-100 text-gray-900',
          highlight && 'ring-2 ring-amber-400')}>
          {deleted ? 'This message was deleted' : (
            <>
              {m.forwarded_from && (
                <p className={cn('mb-1 inline-flex items-center gap-1 text-[11px] italic', mine ? 'text-white/80' : 'text-gray-500')}>
                  <Forward className="h-3 w-3" />Forwarded from {m.forwarded_from.ticket_no}{m.forwarded_from.author ? ` · ${m.forwarded_from.author}` : ''}
                </p>
              )}
              {m.reply_to && (
                <button type="button" onClick={() => onJump(m.reply_to!)}
                  className={cn('mb-1.5 block w-full rounded-lg border-l-2 px-2 py-1 text-left text-xs', mine ? 'border-white/60 bg-white/10 text-white/90' : 'border-gray-400 bg-white/70 text-gray-600')}>
                  <span className="font-semibold">{m.reply_author || 'Message'}</span>: {m.reply_body
                    ? `${m.reply_body.slice(0, 140)}${m.reply_body.length > 140 ? '…' : ''}`
                    : m.reply_kind === 'voice' ? 'Voice note' : m.reply_kind === 'media' ? 'Files' : 'Message deleted'}
                </button>
              )}
              {m.media.length > 0 && <div className={cn(m.body && 'mb-1.5')}><MessageMedia files={m.media} mine={mine} voiceMeta={m.meta} /></div>}
              {editing ? (
                <div className="space-y-1.5">
                  <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} autoFocus
                    className="w-full min-w-[220px] rounded-lg border border-gray-300 px-2 py-1 text-sm text-gray-900" aria-label="Edit message" />
                  <div className="flex justify-end gap-1.5">
                    <button type="button" className="rounded px-2 py-0.5 text-xs hover:bg-black/10" onClick={() => { setEditing(false); setDraft(m.body); }}>Cancel</button>
                    <button type="button" className="rounded bg-white px-2 py-0.5 text-xs font-medium text-primary-700"
                      onClick={() => act(async () => { onChanged([await adapter.edit(m.id, draft)]); setEditing(false); })}>Save</button>
                  </div>
                </div>
              ) : m.body && <p className="whitespace-pre-wrap">{m.body}</p>}
              {links.length > 0 && (
                <div className="mt-1.5 space-y-1">
                  {links.map((l) => (
                    <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer nofollow"
                      className={cn('flex items-center gap-2 rounded-lg px-2 py-1 text-xs', mine ? 'bg-white/15 hover:bg-white/25' : 'bg-white hover:bg-gray-50')}>
                      <Link2 className="h-3.5 w-3.5 shrink-0" /><span className="font-semibold">{l.host}</span><span className="truncate opacity-70">{l.path}</span>
                    </a>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        <div className={cn('relative mt-0.5 flex items-center gap-1', mine && 'flex-row-reverse')}>
          {status && !deleted && (
            <button type="button" onClick={() => setShowSeen((x) => !x)} aria-label={status === 'read' ? 'Read by everyone' : 'Sent'}
              className={cn('rounded px-0.5', status === 'read' ? 'text-sky-500' : 'text-gray-400')}>
              {status === 'read' ? <CheckCheck className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
            </button>
          )}
          {!deleted && (
            <button type="button" onClick={() => setMenu((x) => !x)} aria-label="Message actions" aria-expanded={menu}
              className="rounded p-0.5 text-gray-400 opacity-100 hover:bg-gray-100 hover:text-gray-700 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100">
              <MoreHorizontal className="h-4 w-4" />
            </button>
          )}
          {showSeen && (
            <div className={cn('absolute bottom-6 z-20 w-48 rounded-xl bg-white p-2 text-xs shadow-lg ring-1 ring-gray-200', mine ? 'right-0' : 'left-0')}>
              <p className="mb-1 font-semibold text-gray-700">Seen by</p>
              {seen.length ? seen.map((n) => <p key={n} className="truncate text-gray-600">{n}</p>) : <p className="text-gray-400">Nobody yet</p>}
            </div>
          )}
          {menu && (
            <div role="menu" className={cn('absolute bottom-6 z-20 w-52 rounded-xl bg-white py-1 text-sm shadow-lg ring-1 ring-gray-200', mine ? 'right-0' : 'left-0')}
              onMouseLeave={() => setMenu(false)}>
              <MenuItem icon={Reply} label="Reply" onClick={() => { setMenu(false); window.dispatchEvent(new CustomEvent(`chat-reply:${adapter.key}`, { detail: m })); }} />
              {m.body && <MenuItem icon={Copy} label="Copy" onClick={() => act(() => navigator.clipboard.writeText(m.body), 'Copied')} />}
              {canEditMessage(facts, viewer) && <MenuItem icon={Pencil} label="Edit" onClick={() => { setMenu(false); setDraft(m.body); setEditing(true); }} />}
              <MenuItem icon={m.pinned_at ? PinOff : Pin} label={m.pinned_at ? 'Unpin' : 'Pin'} onClick={() => act(async () => onChanged([await adapter.pin(m.id, !m.pinned_at)]))} />
              <MenuItem icon={Eye} label="Seen by" onClick={() => { setMenu(false); setShowSeen(true); }} />
              {extra.map((a) => <MenuItem key={a.label} icon={Forward} label={a.label} onClick={() => act(async () => { await a.run(m); })} />)}
              {canDeleteMessage(facts, viewer) && (
                <MenuItem icon={Trash2} label="Delete for everyone" danger onClick={async () => {
                  setMenu(false);
                  if (!(await confirm({ title: 'Delete this message for everyone?', body: 'Its text and files are removed for everyone.', confirmLabel: 'Delete', danger: true }))) return;
                  act(async () => { await adapter.remove(m.id); onChanged([{ ...m, deleted_at: new Date().toISOString(), body: '', media: [] }]); });
                }} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MenuItem({ icon: Icon, label, onClick, danger }: { icon: typeof Reply; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" role="menuitem" onClick={onClick}
      className={cn('flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-gray-50', danger ? 'text-red-600' : 'text-gray-700')}>
      <Icon className="h-4 w-4" />{label}
    </button>
  );
}

// ------------------------------------------------------------------ composer

function Composer({ adapter, onSent }: { adapter: ChatAdapter; onSent: (m: ChatMessage) => void }) {
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [draftId, setDraftId] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const toast = useToast();

  useEffect(() => {
    const onReply = (e: Event) => { setReplyTo((e as CustomEvent<ChatMessage>).detail); setTimeout(() => input.current?.focus(), 0); };
    window.addEventListener(`chat-reply:${adapter.key}`, onReply);
    return () => window.removeEventListener(`chat-reply:${adapter.key}`, onReply);
  }, [adapter.key]);

  const addFiles = useCallback((list: FileList | File[]) => {
    const arr = Array.from(list);
    const big = arr.filter((f) => f.size > MAX_MB * 1024 * 1024);
    if (big.length) toast(`${big.map((f) => f.name).join(', ')} ${big.length === 1 ? 'is' : 'are'} over ${MAX_MB} MB`, 'error');
    setFiles((cur) => [...cur, ...arr.filter((f) => f.size > 0 && f.size <= MAX_MB * 1024 * 1024)
      .map((file) => ({ key: `${file.name}-${file.size}-${Math.random()}`, file, progress: 0 }))]);
  }, [toast]);

  function onPaste(e: React.ClipboardEvent) {
    const pasted = Array.from(e.clipboardData.files || []);
    if (!pasted.length) return;
    e.preventDefault();
    addFiles(pasted.map((f, i) => (f.name === 'image.png' ? new File([f], `screenshot-${Date.now()}${i ? `-${i}` : ''}.png`, { type: f.type }) : f)));
  }

  const reset = () => { setBody(''); setReplyTo(null); setFiles([]); setDraftId(null); };

  async function send() {
    if (sending) return;
    const text = body.trim();
    if (!text && !files.length) return;
    setSending(true);
    try {
      if (!files.length) {
        onSent(await adapter.send(text, replyTo?.id ?? null));
        reset();
        return;
      }
      // Files: a draft only you can see, upload each file to it, then publish.
      let id = draftId;
      if (!id) { id = (await adapter.createDraft({ kind: 'media', body: text, replyTo: replyTo?.id ?? null })).id; setDraftId(id); }
      const target = adapter.attachTarget(id);
      let failed = 0;
      for (const f of files) {
        if (f.mediaId) continue;
        try {
          const mediaId = await uploadToTarget(target, f.file, {
            onProgress: (p) => setFiles((cur) => cur.map((x) => (x.key === f.key ? { ...x, progress: p, error: undefined } : x))),
          });
          setFiles((cur) => cur.map((x) => (x.key === f.key ? { ...x, mediaId, progress: 1 } : x)));
          f.mediaId = mediaId;
        } catch (e) {
          failed++;
          setFiles((cur) => cur.map((x) => (x.key === f.key ? { ...x, error: (e as Error).message } : x)));
        }
      }
      if (failed) { toast(`${failed} file${failed > 1 ? 's' : ''} didn’t upload — retry or remove ${failed > 1 ? 'them' : 'it'}`, 'error'); return; }
      onSent(await adapter.publish(id));
      reset();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSending(false);
      input.current?.focus();
    }
  }

  async function sendVoice(r: Recording) {
    const { id } = await adapter.createDraft({ kind: 'voice', body: '', replyTo: replyTo?.id ?? null, meta: { duration: r.duration, peaks: r.peaks } });
    try {
      const ext = r.mime.includes('mp4') ? 'm4a' : r.mime.includes('ogg') ? 'ogg' : 'webm';
      await uploadToTarget(adapter.attachTarget(id), r.blob, { name: `voice-note-${Date.now()}.${ext}`, kind: 'voice' });
      onSent(await adapter.publish(id));
      setReplyTo(null);
    } catch (e) {
      await adapter.discard(id).catch(() => {});
      throw e;
    }
  }

  async function discard() {
    if (draftId) await adapter.discard(draftId).catch(() => {});
    reset();
  }

  return (
    <div className={cn('border-t border-gray-100 p-3 sm:p-4', drag && 'bg-primary-50')}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}>
      {replyTo && (
        <div className="mb-2 flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
          <Reply className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary-600" />
          <div className="min-w-0 flex-1 truncate">Replying to <strong>{replyTo.author}</strong>: {replyTo.body || (replyTo.kind === 'voice' ? 'Voice note' : 'Files')}</div>
          <button type="button" onClick={() => setReplyTo(null)} className="rounded p-0.5 hover:bg-gray-200" aria-label="Cancel reply"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}
      {files.length > 0 && (
        <ul className="mb-2 space-y-1.5">
          {files.map((f) => (
            <li key={f.key} className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs">
              <div className="flex items-center gap-2">
                {f.file.type.startsWith('image/') ? <ImageIcon className="h-3.5 w-3.5 text-gray-400" /> : <Paperclip className="h-3.5 w-3.5 text-gray-400" />}
                <span className="min-w-0 flex-1 truncate text-gray-800">{f.file.name}</span>
                <span className="text-gray-400">{fmtSize(f.file.size)}</span>
                {f.error && !sending && <button type="button" onClick={send} className="inline-flex items-center gap-0.5 text-primary-600 hover:underline"><RotateCcw className="h-3 w-3" />Retry</button>}
                {!sending && !f.mediaId && <button type="button" aria-label={`Remove ${f.file.name}`} onClick={() => setFiles((c) => c.filter((x) => x.key !== f.key))} className="rounded p-0.5 text-gray-400 hover:bg-gray-100"><X className="h-3.5 w-3.5" /></button>}
              </div>
              {(sending || f.progress > 0) && (
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-valuenow={Math.round(f.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                  <div className={cn('h-full rounded-full', f.error ? 'bg-red-500' : 'bg-primary-500')} style={{ width: `${Math.round(f.progress * 100)}%` }} />
                </div>
              )}
              {f.error && <p className="mt-0.5 text-red-600">{f.error}</p>}
            </li>
          ))}
          {draftId && !sending && <li><button type="button" onClick={discard} className="text-xs text-gray-500 hover:underline">Discard this message</button></li>}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <button type="button" onClick={() => picker.current?.click()} title="Attach files" aria-label="Attach files" disabled={sending}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40">
          <Paperclip className="h-4 w-4" />
        </button>
        <input ref={picker} type="file" multiple className="hidden" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
        <label htmlFor={`composer-${adapter.key}`} className="sr-only">Write a message</label>
        <textarea id={`composer-${adapter.key}`} ref={input} rows={2} value={body} onChange={(e) => setBody(e.target.value)} onPaste={onPaste}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
            if (e.key === 'Escape' && replyTo) setReplyTo(null);
          }}
          placeholder={files.length ? 'Add a caption (optional)…' : 'Write a message…'}
          className="min-h-[44px] max-h-40 flex-1 resize-y rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500" />
        {!body.trim() && !files.length ? (
          <VoiceRecorder onSend={sendVoice} disabled={sending} />
        ) : (
          <Btn onClick={send} disabled={sending} className="h-11 shrink-0">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            <span className="hidden sm:inline">Send</span>
          </Btn>
        )}
      </div>
      <p className="mt-1 hidden text-[11px] text-gray-400 sm:block">Enter to send · Shift+Enter for a new line · drop or paste files · mic for a voice note (up to 5 min)</p>
    </div>
  );
}

// ------------------------------------------------------------------ media + pinned tabs

const MEDIA_KINDS: { id: string; label: string }[] = [
  { id: '', label: 'All' }, { id: 'image', label: 'Images' }, { id: 'video', label: 'Videos' },
  { id: 'voice', label: 'Voice notes' }, { id: 'audio', label: 'Audio' }, { id: 'pdf', label: 'PDFs' }, { id: 'file', label: 'Other' },
];

function MediaPanel({ adapter, meId, isHr }: { adapter: ChatAdapter; meId: number | string | undefined; isHr: boolean }) {
  const [kind, setKind] = useState('');
  const { data, mutate } = usePapi<MediaFile[]>(`${adapter.mediaUrl}${kind ? `&kind=${kind}` : ''}`, { refreshInterval: 30_000 });
  return (
    <div className="max-h-[70vh] overflow-y-auto p-4">
      <div className="mb-3 flex flex-wrap gap-1.5">
        {MEDIA_KINDS.map((k) => (
          <button key={k.id} type="button" onClick={() => setKind(k.id)} aria-pressed={kind === k.id}
            className={cn('rounded-full border px-3 py-1 text-xs', kind === k.id ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50')}>
            {k.label}
          </button>
        ))}
      </div>
      {!data ? <Loader2 className="mx-auto h-5 w-5 animate-spin text-gray-400" /> : !data.length ? (
        <p className="py-10 text-center text-sm text-gray-500">Nothing shared yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {data.map((f) => <FileTile key={f.id} f={f} canDelete={isHr || String(f.uploaded_by) === String(meId)} onChanged={() => mutate()} />)}
        </div>
      )}
    </div>
  );
}

function PinnedPanel({ adapter, onJump, onChanged }: { adapter: ChatAdapter; onJump: (id: number) => void; onChanged: (m: ChatMessage) => void }) {
  const [items, setItems] = useState<ChatMessage[] | null>(null);
  const toast = useToast();
  const load = useCallback(() => { adapter.pinned().then(setItems).catch((e) => toast((e as Error).message, 'error')); }, [adapter, toast]);
  useEffect(() => { load(); }, [load]);
  if (!items) return <div className="p-6"><Loader2 className="mx-auto h-5 w-5 animate-spin text-gray-400" /></div>;
  if (!items.length) return <p className="p-10 text-center text-sm text-gray-500">No pinned messages. Pin important ones from a message’s menu.</p>;
  return (
    <ul className="max-h-[70vh] divide-y divide-gray-100 overflow-y-auto">
      {items.map((m) => (
        <li key={m.id} className="flex items-start gap-3 px-4 py-3">
          <Pin className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <button type="button" onClick={() => onJump(m.id)} className="min-w-0 flex-1 text-left">
            <p className="text-xs text-gray-500">{m.author || 'Someone'} · {relTime(m.created_at)}{m.pinned_by_name ? ` · pinned by ${m.pinned_by_name}` : ''}</p>
            <p className="line-clamp-2 text-sm text-gray-900">{m.body || (m.kind === 'voice' ? 'Voice note' : `${m.media.length} file${m.media.length === 1 ? '' : 's'}`)}</p>
          </button>
          <button type="button" className="text-xs text-gray-500 hover:underline" onClick={async () => {
            try { onChanged(await adapter.pin(m.id, false)); load(); } catch (e) { toast((e as Error).message, 'error'); }
          }}>Unpin</button>
        </li>
      ))}
    </ul>
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
