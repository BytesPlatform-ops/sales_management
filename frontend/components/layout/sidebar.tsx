'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Users,
  Calendar,
  Trophy,
  LogOut,
  Menu,
  X,
  DollarSign,
  Receipt,
  TrendingUp,
  Headphones,
  FileUp,
  PhoneCall,
  Target,
  Crosshair,
  FileAudio,
  ClipboardCheck,
  GraduationCap,
  Sparkles,
  LineChart,
  BookOpen,
  Zap,
  Mic,
  FileText,
  FolderKanban,
  CalendarDays,
  Code2,
  ListTodo,
  Inbox,
  Bookmark,
  LayoutTemplate,
  Bell,
  Crown,
  ShieldCheck,
  UserCog,
  Lock,
  MessagesSquare,
  LifeBuoy,
  Share2, Gauge } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ReminderButtons } from '@/components/reminders/Reminders';

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  roles: ('hr' | 'agent' | 'developer')[];
  /** CEO / Executive only (a CEO also sees every HR item). */
  ceoOnly?: boolean;
}

const navItems: NavItem[] = [
  { label: 'Executive', href: '/ceo', icon: Crown, roles: [], ceoOnly: true },
  { label: 'Security', href: '/ceo/security', icon: ShieldCheck, roles: [], ceoOnly: true },
  { label: 'CEO accounts', href: '/ceo/users', icon: UserCog, roles: [], ceoOnly: true },
  { label: 'Privacy', href: '/ceo/privacy', icon: Lock, roles: [], ceoOnly: true },
  {
    label: 'Dashboard',
    href: '/agent',
    icon: LayoutDashboard,
    roles: ['agent'],
  },
  {
    label: 'My Leads',
    href: '/agent/dialer-leads',
    icon: PhoneCall,
    roles: ['agent'],
  },
  {
    label: 'Pipeline',
    href: '/agent/pipeline',
    icon: Target,
    roles: ['agent'],
  },
  {
    label: 'Sales',
    href: '/agent/sales',
    icon: Receipt,
    roles: ['agent'],
  },
  {
    label: 'Recordings',
    href: '/agent/recordings',
    icon: Headphones,
    roles: ['agent'],
  },
  {
    label: 'Daily Report',
    href: '/agent/daily-report',
    icon: ClipboardCheck,
    roles: ['agent'],
  },
  {
    label: 'My Coaching',
    href: '/agent/coaching',
    icon: GraduationCap,
    roles: ['agent'],
  },
  {
    label: 'Training',
    href: '/agent/training',
    icon: BookOpen,
    roles: ['agent'],
  },
  {
    label: 'Live Assist',
    href: '/agent/training/assist',
    icon: Zap,
    roles: ['agent'],
  },
  {
    label: 'Dashboard',
    href: '/hr',
    icon: LayoutDashboard,
    roles: ['hr'],
  },
  {
    label: 'Daily Stats',
    href: '/hr/daily-stats',
    icon: TrendingUp,
    roles: ['hr'],
  },
  {
    label: 'Agents',
    href: '/hr/agents',
    icon: Users,
    roles: ['hr'],
  },
  {
    label: 'Targets',
    href: '/hr/targets',
    icon: Crosshair,
    roles: ['hr'],
  },
  {
    label: 'Attendance',
    href: '/hr/attendance',
    icon: Calendar,
    roles: ['hr'],
  },
  {
    label: 'Payroll',
    href: '/hr/payroll',
    icon: DollarSign,
    roles: ['hr'],
  },
  {
    label: 'Salary Reports',
    href: '/hr/payroll-reports',
    icon: FileText,
    roles: ['hr'],
  },
  {
    label: 'Call Auditing',
    href: '/hr/auditing',
    icon: Headphones,
    roles: ['hr'],
  },
  {
    label: 'Call QA',
    href: '/hr/qa-daily',
    icon: ClipboardCheck,
    roles: ['hr'],
  },
  {
    label: 'Weekly Review',
    href: '/hr/qa-weekly',
    icon: Sparkles,
    roles: ['hr'],
  },
  {
    label: 'Monthly Trends',
    href: '/hr/qa-monthly',
    icon: LineChart,
    roles: ['hr'],
  },
  {
    label: 'Recordings',
    href: '/hr/recordings',
    icon: FileAudio,
    roles: ['hr'],
  },
  {
    label: 'Recordings by Agent',
    href: '/hr/recordings-by-agent',
    icon: Mic,
    roles: ['hr'],
  },
  {
    label: 'Training',
    href: '/hr/training',
    icon: BookOpen,
    roles: ['hr'],
  },
  {
    label: 'Leads',
    href: '/hr/dialer-leads',
    icon: FileUp,
    roles: ['hr'],
  },
  {
    label: 'Pipeline',
    href: '/hr/pipeline',
    icon: Target,
    roles: ['hr'],
  },
  {
    label: 'Leaderboard',
    href: '/leaderboard',
    icon: Trophy,
    roles: ['hr', 'agent'],
  },
  {
    label: 'Projects overview',
    href: '/overview',
    icon: Gauge,
    roles: ['hr', 'agent', 'developer'],
  },
  {
    label: 'Projects',
    href: '/projects',
    icon: FolderKanban,
    roles: ['hr', 'agent', 'developer'],
  },
  {
    label: 'Project Calendar',
    href: '/projects/calendar',
    icon: CalendarDays,
    roles: ['hr', 'agent', 'developer'],
  },
  {
    label: 'My Tasks',
    href: '/my-tasks',
    icon: ListTodo,
    roles: ['hr', 'agent', 'developer'],
  },
  {
    label: 'Chat',
    href: '/chat',
    icon: MessagesSquare,
    roles: ['hr', 'agent', 'developer'],
  },
  {
    label: 'Inbox',
    href: '/inbox',
    icon: Inbox,
    roles: ['hr', 'agent', 'developer'],
  },
  {
    label: 'Help requests',
    href: '/help',
    icon: LifeBuoy,
    roles: ['hr', 'developer'],
  },
  {
    label: 'Shared with me',
    href: '/shared',
    icon: Share2,
    roles: ['hr', 'developer'],
  },
  {
    label: 'My profile',
    href: '/profile',
    icon: UserCog,
    roles: ['hr', 'agent', 'developer'],
  },
  {
    label: 'Templates',
    href: '/hr/templates',
    icon: LayoutTemplate,
    roles: ['hr'],
  },
  {
    label: 'Developers',
    href: '/hr/developers',
    icon: Code2,
    roles: ['hr'],
  },
];

export function Sidebar() {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [projectBadge, setProjectBadge] = useState<{ unread: number; overdue: number } | null>(null);

  // Unread project messages / overdue projects badge (polled every minute).
  useEffect(() => {
    if (!user) return;
    let alive = true;
    const load = () =>
      fetch('/api/projects/summary', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }, cache: 'no-store' })
        .then((r) => r.json())
        .then((j) => { if (alive && j.status === 'success') setProjectBadge(j.data); })
        .catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [user]);

  // Unread chat messages (polled every 15s, like the chat list).
  const [chatUnread, setChatUnread] = useState(0);
  useEffect(() => {
    if (!user) return;
    let alive = true;
    const load = () =>
      fetch('/api/chat', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }, cache: 'no-store' })
        .then((r) => r.json())
        .then((j) => { if (alive && j.data) setChatUnread(j.data.unreadTotal || 0); })
        .catch(() => {});
    load();
    const t = setInterval(load, 15_000);
    return () => { alive = false; clearInterval(t); };
  }, [user]);

  if (!user) return null;

  const filteredItems = navItems.filter((item) => (item.ceoOnly ? !!user.isCeo : item.roles.includes(user.role)));

  // Training has sub-pages: highlight the longest training nav href that prefixes the path.
  const trainingMatch = filteredItems
    .filter((item) => (item.href.includes('/training') || item.href.startsWith('/projects')) && (pathname === item.href || pathname.startsWith(item.href + '/')))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <>
      {/* Mobile menu button */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="lg:hidden fixed top-4 left-4 z-50 p-2 rounded-lg bg-white shadow-md"
      >
        {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
      </button>

      {/* Overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed top-0 left-0 z-40 h-screen w-64 bg-white border-r transform transition-transform duration-200',
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="p-6 border-b">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-primary-600 shadow-lg">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h1 className="text-lg font-bold text-gray-900 tracking-tight">
                  Salary System
                </h1>
                <p className="text-xs text-gray-500 font-medium">Performance Dashboard</p>
              </div>
            </div>
          </div>

          {/* Nav Items */}
          <nav className="flex-1 min-h-0 overflow-y-auto p-4 space-y-1">
            {filteredItems.map((item) => {
              const isActive = item.href.includes('/training') || item.href.startsWith('/projects') ? trainingMatch === item.href
                : item.href === '/chat' ? pathname === '/chat' || pathname.startsWith('/chat/') : pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    'flex items-center gap-3 px-4 py-3 rounded-lg transition-colors',
                    isActive
                      ? 'bg-primary-50 text-primary-600'
                      : 'text-gray-600 hover:bg-gray-50'
                  )}
                >
                  <item.icon className="h-5 w-5" />
                  <span className="font-medium">{item.label}</span>
                  {item.href === '/chat' && chatUnread > 0 && (
                    <span className="ml-auto rounded-full bg-primary-600 px-1.5 text-[11px] font-bold text-white" title="Unread messages">{chatUnread > 99 ? '99+' : chatUnread}</span>
                  )}
                  {item.href === '/projects' && projectBadge && (projectBadge.unread > 0 || projectBadge.overdue > 0) && (
                    <span className="ml-auto flex items-center gap-1">
                      {projectBadge.unread > 0 && <span className="rounded-full bg-primary-600 px-1.5 text-[11px] font-bold text-white" title="Unread messages">{projectBadge.unread}</span>}
                      {projectBadge.overdue > 0 && <span className="rounded-full bg-red-500 px-1.5 text-[11px] font-bold text-white" title="Overdue projects">{projectBadge.overdue}</span>}
                    </span>
                  )}
                </Link>
              );
            })}
            <PinnedViews pathname={pathname} onNavigate={() => setMobileOpen(false)} />
          </nav>

          {/* User Info */}
          <div className="p-4 border-t">
            <div className="flex items-center gap-3 mb-3">
              <div className="h-10 w-10 rounded-full bg-primary-100 flex items-center justify-center">
                <span className="text-primary-600 font-bold">
                  {user.full_name.charAt(0)}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-gray-900">{user.full_name}</p>
                <p className="text-xs text-gray-500 capitalize">{user.role}</p>
              </div>
              <NotificationBell onNavigate={() => setMobileOpen(false)} />
            </div>
            <button
              onClick={logout}
              className="flex items-center gap-2 w-full px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
              <LogOut className="h-4 w-4" />
              <span>Logout</span>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

interface Notice { id: string; type: string; body: string; link: string | null; read_at: string | null; created_at: string; entity_type?: string | null; entity_id?: string | null }

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** In-app notifications (assignments, mentions, status changes…). Polls every 30s. */
function NotificationBell({ onNavigate }: { onNavigate: () => void }) {
  const router = useRouter();
  const [items, setItems] = useState<Notice[]>([]);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  // The panel is wider than the sidebar, so it renders in a portal beside it
  // (fixed, next to the bell) instead of inside the sidebar, where it was cut
  // off and covered by the page.
  const [pos, setPos] = useState<React.CSSProperties>({});

  const [unread, setUnread] = useState(0);
  // Unified inbox: new notifications plus the training module's (see /api/inbox).
  const call = useCallback(async (path: string, body?: unknown) => {
    const r = await fetch(path, {
      method: body ? 'POST' : 'GET', cache: 'no-store',
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return r.json();
  }, []);

  const load = useCallback(() => {
    call('/api/inbox?tab=all&limit=20').then((j) => { if (j.status === 'success') { setItems(j.data.items); setUnread(j.data.unread_count); } }).catch(() => {});
  }, [call]);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = box.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.min(320, window.innerWidth - 32);
      const bottom = Math.max(16, window.innerHeight - r.bottom);
      // Room to the right of the sidebar → open there; otherwise (phones) centre it.
      const left = r.right + 12 + width <= window.innerWidth - 16 ? r.right + 12 : (window.innerWidth - width) / 2;
      setPos({ left, bottom, width, maxHeight: window.innerHeight - bottom - 16 });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (box.current?.contains(target) || panel.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  async function openNotice(n: Notice) {
    setOpen(false);
    if (!n.read_at) {
      setItems((xs) => xs.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
      setUnread((u) => Math.max(0, u - 1));
      call('/api/inbox/read', { ids: [n.id] }).catch(() => {});
    }
    if (n.link) { onNavigate(); router.push(n.link); }
  }

  async function markAll() {
    setItems((xs) => xs.map((x) => ({ ...x, read_at: x.read_at || new Date().toISOString() })));
    setUnread(0);
    await call('/api/inbox/read', {}).catch(() => {});
  }

  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="true" aria-expanded={open}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        className="relative rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-red-500 px-1 text-center text-[10px] font-bold leading-[18px] text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && createPortal(
        <div ref={panel} role="dialog" aria-label="Notifications" style={pos}
          className="fixed z-[70] flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
            <span className="text-sm font-semibold text-gray-900">Notifications</span>
            {unread > 0 && <button type="button" onClick={markAll} className="text-xs font-medium text-primary-600 hover:underline">Mark all read</button>}
          </div>
          {items.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-gray-500">You're all caught up.</p>
          ) : (
            <ul className="min-h-0 flex-1 max-h-96 overflow-y-auto divide-y divide-gray-50">
              {items.slice(0, 20).map((n) => (
                <li key={n.id}>
                  <button type="button" onClick={() => openNotice(n)}
                    className={cn('flex w-full gap-2 px-3 py-2.5 text-left text-sm hover:bg-gray-50', !n.read_at && 'bg-primary-50/50')}>
                    <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.read_at ? 'bg-transparent' : 'bg-primary-500')} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block text-gray-800 break-words">{n.body}</span>
                      <span className="text-[11px] text-gray-400">{ago(n.created_at)}</span>
                    </span>
                  </button>
                  {n.type === 'reminder' && n.entity_type === 'reminder' && n.entity_id && (
                    <div className="flex justify-end px-3 pb-2"><ReminderButtons id={n.entity_id} onChange={load} /></div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={() => { setOpen(false); onNavigate(); router.push('/inbox'); }}
            className="block w-full border-t border-gray-100 px-3 py-2 text-center text-xs font-medium text-primary-600 hover:bg-gray-50">
            Open inbox
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}

interface PinnedView { id: number; name: string; href: string; scope: string; project_ticket_no: string | null }

/** Saved views pinned to the sidebar (see components/tickets/SavedViews). */
function PinnedViews({ pathname, onNavigate }: { pathname: string; onNavigate: () => void }) {
  const [views, setViews] = useState<PinnedView[]>([]);
  // Read the query string after mount (not during render) to avoid hydration mismatches.
  const [search, setSearch] = useState('');
  useEffect(() => { setSearch(window.location.search); }, [pathname]);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch('/api/saved-views?pinned=1', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }, cache: 'no-store' })
        .then((r) => r.json())
        .then((j) => { if (alive && j.status === 'success') setViews(j.data); })
        .catch(() => {});
    load();
    window.addEventListener('saved-views-changed', load);
    const t = setInterval(load, 120_000);
    return () => { alive = false; window.removeEventListener('saved-views-changed', load); clearInterval(t); };
  }, []);
  if (!views.length) return null;
  return (
    <div className="pt-3">
      <p className="px-4 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Views</p>
      {views.map((v) => {
        const active = v.href === pathname + search || (v.href.startsWith(pathname + '?') && search.includes(`view=${v.id}`));
        return (
          <Link key={v.id} href={v.href} onClick={onNavigate} title={v.project_ticket_no ? `${v.name} · ${v.project_ticket_no}` : v.name}
            className={cn('flex items-center gap-3 rounded-lg px-4 py-2 text-sm transition-colors', active ? 'bg-primary-50 text-primary-600' : 'text-gray-600 hover:bg-gray-50')}>
            <Bookmark className="h-4 w-4 shrink-0" />
            <span className="truncate">{v.name}</span>
            {v.project_ticket_no && <span className="ml-auto shrink-0 text-[10px] text-gray-400">{v.project_ticket_no.replace('PRJ-', '#')}</span>}
          </Link>
        );
      })}
    </div>
  );
}

