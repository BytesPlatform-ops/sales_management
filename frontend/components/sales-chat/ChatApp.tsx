'use client';

/**
 * Chat (Addendum 5): conversation list + open conversation. Talks to
 * /api/chat and /api/messages. The open conversation polls every 3 s, the list
 * every 15 s.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Bell, BellOff, Check, CheckCheck, CornerUpLeft, Hash, Lock, LogOut, Megaphone, MessageSquarePlus,
  Pencil, Pin, PinOff, Plus, Search, Smile, Trash2, UserPlus, Users, X,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';

const REACTIONS = ['👍', '❤️', '😂', '🎉', '👏', '✅'];

// ---------------------------------------------------------------- api

async function api<T = any>(path: string, method = 'GET', body?: unknown): Promise<{ data: T; nextCursor: string | null }> {
  const r = await fetch(path, {
    method,
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${localStorage.getItem('token')}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({ error: 'Network error' }));
  if (!r.ok || j.error) throw new Error(j.error || 'Request failed');
  return j;
}

// ---------------------------------------------------------------- types

interface ConversationItem {
  id: string; type: 'dm' | 'group' | 'channel'; name: string; topic: string | null; systemKey: string | null;
  isPrivate: boolean; isAnnouncementOnly: boolean; other: { id: number; name: string; role: string } | null;
  memberCount: number; pinned: boolean; muted: boolean; unread: number; activityAt: string;
  last: { body: string; senderName: string | null; mine: boolean } | null;
}

interface Member { id: number; name: string; userRole: string; role: 'member' | 'admin'; lastReadMessageId: number }

interface ConversationDetail {
  id: string; type: 'dm' | 'group' | 'channel'; name: string; topic: string | null; systemKey: string | null;
  isPrivate: boolean; isAnnouncementOnly: boolean; meId: number; members: Member[]; pinned: boolean; mutedUntil: string | null;
  canPost: boolean; canManage: boolean; canLeave: boolean;
}

interface Message {
  id: string; kind: string; body: string; sender: { id: number; name: string; role: string } | null; mine: boolean;
  createdAt: string; editedAt: string | null; deleted: boolean; canEdit: boolean; canDelete: boolean;
  replyTo: { id: string; senderName: string | null; body: string } | null;
  reactions: { emoji: string; count: number; mine: boolean }[];
}

interface Person { id: number; name: string; role: string }

// ---------------------------------------------------------------- helpers

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]).join('').toUpperCase() || '?';

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Karachi' });
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const key = (x: Date) => x.toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (key(d) === key(today)) return 'Today';
  if (key(d) === key(yesterday)) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Asia/Karachi' });
}

function listTime(iso: string) {
  const d = new Date(iso);
  const sameDay = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }) === new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });
  return sameDay ? timeLabel(iso) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'Asia/Karachi' });
}

function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-100 text-xs font-bold text-primary-700', className)}>
      {initials(name)}
    </span>
  );
}

function ConversationIcon({ c }: { c: { type: string; name: string; isPrivate: boolean; isAnnouncementOnly: boolean } }) {
  if (c.type === 'dm') return <Avatar name={c.name} />;
  const Icon = c.type === 'group' ? Users : c.isAnnouncementOnly ? Megaphone : c.isPrivate ? Lock : Hash;
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-600">
      <Icon className="h-4 w-4" />
    </span>
  );
}

const displayName = (c: { type: string; name: string }) => (c.type === 'channel' ? `#${c.name}` : c.name);

// ---------------------------------------------------------------- app

export function ChatApp({ conversationId }: { conversationId?: string }) {
  const { user } = useAuth();
  const router = useRouter();
  const [list, setList] = useState<ConversationItem[] | null>(null);
  const [listError, setListError] = useState('');
  const [filter, setFilter] = useState('');
  const [dialog, setDialog] = useState<null | 'dm' | 'group' | 'channel' | 'browse'>(null);

  const loadList = useCallback(async () => {
    try {
      const { data } = await api<{ conversations: ConversationItem[] }>('/api/chat');
      setList(data.conversations);
      setListError('');
    } catch (e: any) {
      setListError(e.message);
    }
  }, []);

  useEffect(() => {
    loadList();
    const t = setInterval(loadList, 15_000);
    return () => clearInterval(t);
  }, [loadList]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (list || []).filter((c) => !q || c.name.toLowerCase().includes(q));
  }, [list, filter]);
  const channels = shown.filter((c) => c.type === 'channel');
  const direct = shown.filter((c) => c.type !== 'channel');
  const isSales = user?.role === 'agent' || user?.role === 'hr';

  const opened = (id: string) => {
    setDialog(null);
    loadList();
    router.push(`/chat/${id}`);
  };

  return (
    <div className="-m-6 flex h-screen overflow-hidden bg-white pt-14 lg:pt-0">
      {/* Conversation list */}
      <aside className={cn('w-full flex-col border-r border-gray-200 md:flex md:w-80 md:shrink-0', conversationId ? 'hidden' : 'flex')}>
        <div className="border-b border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-bold text-gray-900">Chat</h1>
            {isSales && (
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setDialog('dm')} title="New message" aria-label="New message"
                  className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-800">
                  <MessageSquarePlus className="h-5 w-5" />
                </button>
                <button type="button" onClick={() => setDialog('group')} title="New group" aria-label="New group"
                  className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-800">
                  <Users className="h-5 w-5" />
                </button>
              </div>
            )}
          </div>
          <label className="relative mt-3 block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a conversation"
              className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-primary-400 focus:bg-white focus:ring-2 focus:ring-primary-100" />
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto py-2">
          {list === null && !listError && <p className="px-4 py-6 text-sm text-gray-500">Loading…</p>}
          {listError && <p className="px-4 py-6 text-sm text-red-600">{listError}</p>}

          <SectionHeader label="Channels" action={isSales ? (
            <span className="flex gap-1">
              <button type="button" onClick={() => setDialog('browse')} className="text-xs font-medium text-primary-600 hover:underline">Browse</button>
              {user?.role === 'hr' && (
                <button type="button" onClick={() => setDialog('channel')} title="New channel" aria-label="New channel"
                  className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><Plus className="h-3.5 w-3.5" /></button>
              )}
            </span>
          ) : null} />
          {channels.map((c) => <ConversationRow key={c.id} c={c} active={c.id === conversationId} />)}

          <SectionHeader label="Direct messages & groups" />
          {direct.map((c) => <ConversationRow key={c.id} c={c} active={c.id === conversationId} />)}
          {list && !direct.length && !filter && (
            <p className="px-4 py-2 text-sm text-gray-500">
              No messages yet.{' '}
              {isSales && <button type="button" onClick={() => setDialog('dm')} className="font-medium text-primary-600 hover:underline">Message someone</button>}
            </p>
          )}
        </div>
      </aside>

      {/* Open conversation */}
      <section className={cn('min-w-0 flex-1 flex-col', conversationId ? 'flex' : 'hidden md:flex')}>
        {conversationId ? (
          <ConversationView key={conversationId} id={conversationId} onChanged={loadList} onLeft={() => { loadList(); router.push('/chat'); }} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center p-8 text-center text-gray-500">
            <MessageSquarePlus className="mb-3 h-10 w-10 text-gray-300" />
            <p className="font-medium text-gray-700">Pick a conversation</p>
            <p className="mt-1 text-sm">Or start one with anyone in sales.</p>
          </div>
        )}
      </section>

      {dialog === 'dm' && <PeopleDialog mode="dm" onClose={() => setDialog(null)} onCreated={opened} />}
      {dialog === 'group' && <PeopleDialog mode="group" onClose={() => setDialog(null)} onCreated={opened} />}
      {dialog === 'channel' && <PeopleDialog mode="channel" onClose={() => setDialog(null)} onCreated={opened} />}
      {dialog === 'browse' && <BrowseChannels onClose={() => setDialog(null)} onJoined={opened} />}
    </div>
  );
}

function SectionHeader({ label, action }: { label: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 pb-1 pt-3">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</span>
      {action}
    </div>
  );
}

function ConversationRow({ c, active }: { c: ConversationItem; active: boolean }) {
  const preview = c.last ? `${c.last.mine ? 'You: ' : c.type !== 'dm' && c.last.senderName ? `${c.last.senderName.split(' ')[0]}: ` : ''}${c.last.body}` : c.topic || '';
  return (
    <Link href={`/chat/${c.id}`}
      className={cn('mx-2 flex items-center gap-3 rounded-lg px-2 py-2 transition-colors', active ? 'bg-primary-50' : 'hover:bg-gray-50')}>
      <ConversationIcon c={c} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1">
          <span className={cn('truncate text-sm', c.unread && !c.muted ? 'font-semibold text-gray-900' : 'font-medium text-gray-700')}>{displayName(c)}</span>
          {c.pinned && <Pin className="h-3 w-3 shrink-0 text-gray-400" aria-label="Pinned" />}
          {c.muted && <BellOff className="h-3 w-3 shrink-0 text-gray-400" aria-label="Muted" />}
          <span className="ml-auto shrink-0 text-[11px] text-gray-400">{listTime(c.activityAt)}</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="truncate text-xs text-gray-500">{preview || ' '}</span>
          {c.unread > 0 && (
            <span className={cn('ml-auto min-w-[20px] shrink-0 rounded-full px-1.5 text-center text-[11px] font-bold leading-5 text-white', c.muted ? 'bg-gray-400' : 'bg-primary-600')}>
              {c.unread > 99 ? '99+' : c.unread}
            </span>
          )}
        </span>
      </span>
    </Link>
  );
}

// ---------------------------------------------------------------- conversation

function ConversationView({ id, onChanged, onLeft }: { id: string; onChanged: () => void; onLeft: () => void }) {
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [older, setOlder] = useState<Message[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [showMembers, setShowMembers] = useState(false);
  const [muteOpen, setMuteOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const lastReadSent = useRef('0');
  const firstLoad = useRef(true);

  const loadDetail = useCallback(async () => {
    try {
      const { data } = await api<ConversationDetail>(`/api/chat/${id}`);
      setDetail(data);
    } catch (e: any) {
      setError(e.message);
    }
  }, [id]);

  const loadMessages = useCallback(async () => {
    try {
      const { data, nextCursor } = await api<Message[]>(`/api/chat/${id}/messages`);
      setMessages(data);
      setCursor((c) => (firstLoad.current ? nextCursor : c));
      firstLoad.current = false;
    } catch (e: any) {
      setError(e.message);
    }
  }, [id]);

  useEffect(() => {
    loadDetail();
    loadMessages();
    const fast = setInterval(loadMessages, 3_000);
    const slow = setInterval(loadDetail, 6_000);
    return () => { clearInterval(fast); clearInterval(slow); };
  }, [loadDetail, loadMessages]);

  const all = useMemo(() => {
    const seen = new Set(messages.map((m) => m.id));
    return [...older.filter((m) => !seen.has(m.id)), ...messages];
  }, [older, messages]);

  // Keep the view pinned to the newest message unless the reader scrolled up.
  useEffect(() => {
    const el = scroller.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [all.length]);

  // Mark read when the newest message is on screen and the tab is visible.
  useEffect(() => {
    const newest = messages[messages.length - 1];
    if (!newest || document.visibilityState !== 'visible' || !atBottom.current) return;
    if (Number(newest.id) <= Number(lastReadSent.current)) return;
    lastReadSent.current = newest.id;
    api(`/api/chat/${id}/read`, 'POST', { messageId: newest.id }).then(onChanged).catch(() => {});
  }, [messages, id, onChanged]);

  async function loadOlder() {
    if (!cursor) return;
    const el = scroller.current;
    const prevHeight = el?.scrollHeight || 0;
    const { data, nextCursor } = await api<Message[]>(`/api/chat/${id}/messages?before=${cursor}`);
    setOlder((o) => [...data, ...o]);
    setCursor(nextCursor);
    requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - prevHeight; });
  }

  async function patch(body: Record<string, unknown>) {
    try {
      await api(`/api/chat/${id}`, 'PATCH', body);
      await loadDetail();
      onChanged();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function act(fn: () => Promise<unknown>) {
    try {
      setError('');
      await fn();
      await loadMessages();
    } catch (e: any) {
      setError(e.message);
    }
  }

  const others = detail ? detail.members.filter((m) => m.id !== detail.meId) : [];
  const myLast = [...all].reverse().find((m) => m.mine && !m.deleted && m.kind !== 'system');
  const seenBy = myLast ? others.filter((m) => Number(m.lastReadMessageId) >= Number(myLast.id)) : [];

  if (error && !detail) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm text-red-600">{error}</p>
        <Link href="/chat" className="text-sm font-medium text-primary-600 hover:underline">Back to chat</Link>
      </div>
    );
  }

  return (
    <>
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-gray-200 px-4 py-3">
        <Link href="/chat" className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 md:hidden" aria-label="Back to conversations">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        {detail && <ConversationIcon c={detail} />}
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold text-gray-900">{detail ? displayName(detail) : '…'}</h2>
          <p className="truncate text-xs text-gray-500">
            {detail?.type === 'dm'
              ? others[0] ? (others[0].userRole === 'hr' ? 'HR' : others[0].userRole === 'developer' ? 'Developer' : 'Sales') : ''
              : detail ? `${detail.members.length} members${detail.topic ? ` · ${detail.topic}` : ''}` : ''}
          </p>
        </div>
        {detail && (
          <div className="relative flex items-center gap-1">
            <button type="button" onClick={() => patch({ pinned: !detail.pinned })} title={detail.pinned ? 'Unpin' : 'Pin to top'}
              aria-label={detail.pinned ? 'Unpin conversation' : 'Pin conversation'} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100">
              {detail.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
            </button>
            <button type="button" onClick={() => setMuteOpen((o) => !o)} title="Mute" aria-label="Mute options"
              className="rounded-lg p-2 text-gray-500 hover:bg-gray-100">
              {detail.mutedUntil && new Date(detail.mutedUntil) > new Date() ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
            </button>
            {muteOpen && (
              <div className="absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-lg">
                {([['1h', 'Mute for 1 hour'], ['8h', 'Mute for 8 hours'], ['forever', 'Until I unmute'], [null, 'Unmute']] as const).map(([v, label]) => (
                  <button key={label} type="button" onClick={() => { setMuteOpen(false); patch({ mute: v }); }}
                    className="block w-full px-3 py-1.5 text-left text-gray-700 hover:bg-gray-50">{label}</button>
                ))}
              </div>
            )}
            {detail.type !== 'dm' && (
              <button type="button" onClick={() => setShowMembers((s) => !s)} title="Members" aria-label="Members"
                className={cn('rounded-lg p-2 hover:bg-gray-100', showMembers ? 'bg-gray-100 text-gray-800' : 'text-gray-500')}>
                <Users className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
      </header>

      <div className="relative flex min-h-0 flex-1">
        {/* Messages */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
            onScroll={(e) => { const el = e.currentTarget; atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
            {cursor && (
              <div className="mb-4 text-center">
                <button type="button" onClick={loadOlder} className="text-xs font-medium text-primary-600 hover:underline">Load earlier messages</button>
              </div>
            )}
            {!all.length && <p className="py-10 text-center text-sm text-gray-500">No messages yet. Say hello.</p>}
            {all.map((m, i) => {
              const prev = all[i - 1];
              const newDay = !prev || dayLabel(prev.createdAt) !== dayLabel(m.createdAt);
              const grouped = !newDay && prev && prev.kind !== 'system' && m.kind !== 'system'
                && prev.sender?.id === m.sender?.id && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000;
              const isMyLast = myLast?.id === m.id;
              return (
                <div key={m.id}>
                  {newDay && (
                    <div className="my-4 flex items-center gap-3 text-[11px] font-medium text-gray-400">
                      <span className="h-px flex-1 bg-gray-100" />{dayLabel(m.createdAt)}<span className="h-px flex-1 bg-gray-100" />
                    </div>
                  )}
                  {m.kind === 'system' ? (
                    <p className="my-2 text-center text-xs text-gray-400">{m.body}</p>
                  ) : (
                    <MessageRow m={m} grouped={!!grouped}
                      receipt={isMyLast && detail ? (detail.type === 'dm'
                        ? { kind: 'dm', read: seenBy.length > 0 }
                        : { kind: 'group', names: seenBy.map((s) => s.name) }) : null}
                      onReply={() => { setEditing(null); setReplyTo(m); }}
                      onEdit={() => { setReplyTo(null); setEditing(m); }}
                      onDelete={() => { if (confirm('Delete this message?')) act(() => api(`/api/messages/${m.id}`, 'DELETE')); }}
                      onReact={(emoji) => act(() => api(`/api/messages/${m.id}/react`, 'POST', { emoji }))} />
                  )}
                </div>
              );
            })}
          </div>

          {error && detail && (
            <div className="mx-4 mb-2 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <span className="flex-1">{error}</span>
              <button type="button" onClick={() => setError('')} aria-label="Dismiss"><X className="h-4 w-4" /></button>
            </div>
          )}

          {detail && (detail.canPost ? (
            <Composer key={editing?.id || 'new'} replyTo={replyTo} editing={editing}
              onCancel={() => { setReplyTo(null); setEditing(null); }}
              onSend={async (text) => {
                setError('');
                try {
                  if (editing) await api(`/api/messages/${editing.id}`, 'PATCH', { body: text });
                  else await api(`/api/chat/${id}/messages`, 'POST', { body: text, replyToId: replyTo?.id });
                  setReplyTo(null);
                  setEditing(null);
                  atBottom.current = true;
                  await loadMessages();
                  onChanged();
                  return true;
                } catch (e: any) {
                  setError(e.message);
                  return false;
                }
              }} />
          ) : (
            <p className="border-t border-gray-200 px-4 py-3 text-center text-sm text-gray-500">Only HR and leads can post in this channel.</p>
          ))}
        </div>

        {/* Members */}
        {showMembers && detail && detail.type !== 'dm' && (
          <MembersPanel detail={detail} meId={detail.meId} onClose={() => setShowMembers(false)}
            onChanged={() => { loadDetail(); onChanged(); }}
            onLeave={async () => {
              if (!confirm('Leave this conversation?')) return;
              try { await api(`/api/chat/${id}`, 'PATCH', { leave: true }); onLeft(); } catch (e: any) { setError(e.message); }
            }} />
        )}
      </div>
    </>
  );
}

function MessageRow({ m, grouped, receipt, onReply, onEdit, onDelete, onReact }: {
  m: Message; grouped: boolean;
  receipt: null | { kind: 'dm'; read: boolean } | { kind: 'group'; names: string[] };
  onReply: () => void; onEdit: () => void; onDelete: () => void; onReact: (emoji: string) => void;
}) {
  const [picker, setPicker] = useState(false);
  const name = m.sender?.name || 'Someone';
  return (
    <div className={cn('group relative flex gap-3 rounded-lg px-2 hover:bg-gray-50', grouped ? 'py-0.5' : 'mt-2 py-1')}>
      <div className="w-9 shrink-0">{!grouped && <Avatar name={name} />}</div>
      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-gray-900">{name}</span>
            {m.sender?.role === 'hr' && <span className="rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-700">HR</span>}
            <span className="text-[11px] text-gray-400">{timeLabel(m.createdAt)}</span>
          </div>
        )}
        {m.replyTo && (
          <p className="mb-1 mt-0.5 line-clamp-2 border-l-2 border-gray-300 pl-2 text-xs text-gray-500">
            <span className="font-medium text-gray-600">{m.replyTo.senderName || 'Someone'}:</span> {m.replyTo.body}
          </p>
        )}
        {m.deleted ? (
          <p className="text-sm italic text-gray-400">This message was deleted</p>
        ) : (
          <p className="whitespace-pre-wrap break-words text-sm text-gray-800">
            {m.body}
            {m.editedAt && <span className="ml-1 text-[11px] text-gray-400">(edited)</span>}
          </p>
        )}
        {m.reactions.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {m.reactions.map((r) => (
              <button key={r.emoji} type="button" onClick={() => onReact(r.emoji)}
                className={cn('flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs',
                  r.mine ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50')}>
                <span>{r.emoji}</span><span>{r.count}</span>
              </button>
            ))}
          </div>
        )}
        {receipt && (
          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-gray-400"
            title={receipt.kind === 'group' && receipt.names.length ? `Seen by ${receipt.names.join(', ')}` : undefined}>
            {receipt.kind === 'dm'
              ? receipt.read ? <><CheckCheck className="h-3.5 w-3.5 text-primary-600" /> Read</> : <><Check className="h-3.5 w-3.5" /> Sent</>
              : receipt.names.length ? <><CheckCheck className="h-3.5 w-3.5 text-primary-600" /> Seen by {receipt.names.length}</> : <><Check className="h-3.5 w-3.5" /> Sent</>}
          </p>
        )}
      </div>

      {!m.deleted && (
        <div className={cn('absolute -top-3 right-2 items-center gap-0.5 rounded-lg border border-gray-200 bg-white p-0.5 shadow-sm',
          picker ? 'flex' : 'hidden group-hover:flex group-focus-within:flex')}>
          <IconButton label="React" onClick={() => setPicker((p) => !p)}><Smile className="h-4 w-4" /></IconButton>
          <IconButton label="Reply" onClick={onReply}><CornerUpLeft className="h-4 w-4" /></IconButton>
          {m.canEdit && <IconButton label="Edit" onClick={onEdit}><Pencil className="h-4 w-4" /></IconButton>}
          {m.canDelete && <IconButton label="Delete" onClick={onDelete}><Trash2 className="h-4 w-4 text-red-500" /></IconButton>}
          {picker && (
            <div className="absolute right-0 top-full z-10 mt-1 flex gap-1 rounded-lg border border-gray-200 bg-white p-1 shadow-lg">
              {REACTIONS.map((e) => (
                <button key={e} type="button" onClick={() => { setPicker(false); onReact(e); }}
                  className="rounded p-1 text-lg leading-none hover:bg-gray-100" aria-label={`React ${e}`}>{e}</button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label}
      className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-800">{children}</button>
  );
}

function Composer({ replyTo, editing, onCancel, onSend }: {
  replyTo: Message | null; editing: Message | null; onCancel: () => void; onSend: (text: string) => Promise<boolean>;
}) {
  const [text, setText] = useState(editing?.body || '');
  const [sending, setSending] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { box.current?.focus(); }, [replyTo, editing]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  async function send() {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    const done = await onSend(t);
    setSending(false);
    if (done) setText('');
  }

  return (
    <div className="border-t border-gray-200 px-4 py-3">
      {(replyTo || editing) && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-1.5 text-xs text-gray-600">
          {editing ? <Pencil className="h-3.5 w-3.5" /> : <CornerUpLeft className="h-3.5 w-3.5" />}
          <span className="min-w-0 flex-1 truncate">
            {editing ? 'Editing your message' : <>Replying to <b>{replyTo!.sender?.name || 'Someone'}</b>: {replyTo!.body}</>}
          </span>
          <button type="button" onClick={onCancel} aria-label="Cancel"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea ref={box} value={text} rows={1} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
            if (e.key === 'Escape' && (replyTo || editing)) onCancel();
          }}
          placeholder="Write a message — Enter to send, Shift+Enter for a new line"
          className="max-h-40 min-h-[40px] flex-1 resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100" />
        <button type="button" onClick={send} disabled={!text.trim() || sending}
          className="h-10 rounded-lg bg-primary-600 px-4 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-40">
          {editing ? 'Save' : 'Send'}
        </button>
      </div>
    </div>
  );
}

function MembersPanel({ detail, meId, onClose, onChanged, onLeave }: {
  detail: ConversationDetail; meId: number; onClose: () => void; onChanged: () => void; onLeave: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  return (
    <aside className="absolute inset-0 z-20 flex flex-col bg-white md:static md:w-72 md:shrink-0 md:border-l md:border-gray-200">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <span className="font-semibold text-gray-900">Members ({detail.members.length})</span>
        <button type="button" onClick={onClose} aria-label="Close members" className="rounded p-1 text-gray-500 hover:bg-gray-100"><X className="h-4 w-4" /></button>
      </div>
      {detail.systemKey && <p className="border-b border-gray-100 px-4 py-2 text-xs text-gray-500">Members follow sales teams automatically.</p>}
      <ul className="min-h-0 flex-1 overflow-y-auto py-2">
        {detail.members.map((m) => (
          <li key={m.id} className="flex items-center gap-2 px-4 py-1.5 text-sm">
            <Avatar name={m.name} className="h-7 w-7 text-[10px]" />
            <span className="min-w-0 flex-1 truncate text-gray-800">{m.name}{m.id === meId && <span className="text-gray-400"> (you)</span>}</span>
            {m.role === 'admin' && <span className="text-[10px] font-medium text-gray-400">admin</span>}
            {detail.canManage && !detail.systemKey && m.id !== meId && (
              <button type="button" title="Remove" aria-label={`Remove ${m.name}`}
                onClick={async () => { try { await api(`/api/chat/${detail.id}`, 'PATCH', { removeMemberIds: [m.id] }); onChanged(); } catch (e: any) { setError(e.message); } }}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600"><X className="h-3.5 w-3.5" /></button>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="px-4 pb-2 text-xs text-red-600">{error}</p>}
      <div className="space-y-1 border-t border-gray-200 p-3">
        {detail.canManage && !detail.systemKey && (
          <button type="button" onClick={() => setAdding(true)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
            <UserPlus className="h-4 w-4" /> Add people
          </button>
        )}
        {detail.canLeave && (
          <button type="button" onClick={onLeave} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50">
            <LogOut className="h-4 w-4" /> Leave
          </button>
        )}
      </div>
      {adding && (
        <PeopleDialog mode="add" conversationId={detail.id} exclude={detail.members.map((m) => m.id)}
          onClose={() => setAdding(false)} onCreated={() => { setAdding(false); onChanged(); }} />
      )}
    </aside>
  );
}

// ---------------------------------------------------------------- dialogs

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-label={title} className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h3 className="font-semibold text-gray-900">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-gray-500 hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function PeopleDialog({ mode, conversationId, exclude = [], onClose, onCreated }: {
  mode: 'dm' | 'group' | 'channel' | 'add'; conversationId?: string; exclude?: number[];
  onClose: () => void; onCreated: (id: string) => void;
}) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<number[]>([]);
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Person[]>('/api/chat/people').then(({ data }) => setPeople(data)).catch((e) => setError(e.message));
  }, []);

  const shown = (people || []).filter((p) => !exclude.includes(p.id) && (!q || p.name.toLowerCase().includes(q.toLowerCase())));
  const title = mode === 'dm' ? 'New message' : mode === 'group' ? 'New group' : mode === 'channel' ? 'New channel' : 'Add people';

  async function submit(dmUserId?: number) {
    setBusy(true);
    setError('');
    try {
      if (mode === 'dm') {
        const { data } = await api<{ id: string }>('/api/chat', 'POST', { type: 'dm', userId: dmUserId });
        onCreated(data.id);
      } else if (mode === 'add') {
        await api(`/api/chat/${conversationId}`, 'PATCH', { addMemberIds: picked });
        onCreated(conversationId!);
      } else {
        const { data } = await api<{ id: string }>('/api/chat', 'POST', { type: mode, name, topic, isPrivate, memberIds: picked });
        onCreated(data.id);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const roleLabel = (r: string) => (r === 'hr' ? 'HR' : r === 'developer' ? 'Developer' : 'Sales');

  return (
    <Dialog title={title} onClose={onClose}>
      <div className="space-y-3 border-b border-gray-100 p-4">
        {(mode === 'group' || mode === 'channel') && (
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus
            placeholder={mode === 'channel' ? 'Channel name, e.g. night-shift' : 'Group name, e.g. Friday closers'}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100" />
        )}
        {mode === 'channel' && (
          <>
            <input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={300} placeholder="What it's for (optional)"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100" />
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
              Private — invite only (otherwise anyone in sales can join)
            </label>
          </>
        )}
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus={mode === 'dm' || mode === 'add'} placeholder="Search people"
            className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100" />
        </label>
        {mode === 'group' && <p className="text-xs text-gray-500">{picked.length + 1} of 20 people</p>}
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto py-1">
        {people === null && !error && <li className="px-4 py-3 text-sm text-gray-500">Loading…</li>}
        {shown.map((p) => {
          const on = picked.includes(p.id);
          return (
            <li key={p.id}>
              <button type="button" disabled={busy}
                onClick={() => (mode === 'dm' ? submit(p.id) : setPicked((xs) => (on ? xs.filter((x) => x !== p.id) : [...xs, p.id])))}
                className={cn('flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-gray-50', on && 'bg-primary-50')}>
                <Avatar name={p.name} className="h-8 w-8" />
                <span className="min-w-0 flex-1 truncate text-gray-800">{p.name}</span>
                <span className="text-xs text-gray-400">{roleLabel(p.role)}</span>
                {mode !== 'dm' && <span className={cn('flex h-5 w-5 items-center justify-center rounded border', on ? 'border-primary-600 bg-primary-600 text-white' : 'border-gray-300')}>{on && <Check className="h-3.5 w-3.5" />}</span>}
              </button>
            </li>
          );
        })}
        {people && !shown.length && <li className="px-4 py-3 text-sm text-gray-500">No one found.</li>}
      </ul>
      {error && <p className="px-4 pb-2 text-sm text-red-600">{error}</p>}
      {mode !== 'dm' && (
        <div className="flex justify-end gap-2 border-t border-gray-200 px-4 py-3">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
          <button type="button" onClick={() => submit()}
            disabled={busy || (mode === 'add' ? !picked.length : !name.trim() || (mode === 'group' && !picked.length) || picked.length + 1 > (mode === 'group' ? 20 : 10_000))}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-40">
            {mode === 'add' ? 'Add' : 'Create'}
          </button>
        </div>
      )}
    </Dialog>
  );
}

function BrowseChannels({ onClose, onJoined }: { onClose: () => void; onJoined: (id: string) => void }) {
  const [rows, setRows] = useState<{ id: string; name: string; topic: string | null; member_count: number }[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api<any[]>('/api/chat?browse=channels').then(({ data }) => setRows(data)).catch((e) => setError(e.message));
  }, []);
  return (
    <Dialog title="Browse channels" onClose={onClose}>
      <ul className="min-h-0 flex-1 overflow-y-auto py-1">
        {rows === null && !error && <li className="px-4 py-3 text-sm text-gray-500">Loading…</li>}
        {rows?.map((c) => (
          <li key={c.id} className="flex items-center gap-3 px-4 py-2">
            <Hash className="h-4 w-4 text-gray-400" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-gray-800">#{c.name}</span>
              <span className="block truncate text-xs text-gray-500">{c.member_count} members{c.topic ? ` · ${c.topic}` : ''}</span>
            </span>
            <button type="button" onClick={async () => { try { await api(`/api/chat/${c.id}/join`, 'POST'); onJoined(String(c.id)); } catch (e: any) { setError(e.message); } }}
              className="rounded-lg border border-gray-200 px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-50">Join</button>
          </li>
        ))}
        {rows && !rows.length && <li className="px-4 py-6 text-center text-sm text-gray-500">You're in every open channel.</li>}
      </ul>
      {error && <p className="px-4 pb-3 text-sm text-red-600">{error}</p>}
    </Dialog>
  );
}
