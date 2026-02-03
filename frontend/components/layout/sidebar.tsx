'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
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
  Upload,
  Phone,
  DollarSign,
  Receipt,
  TrendingUp,
} from 'lucide-react';
import { useState } from 'react';

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  roles: ('hr' | 'agent')[];
}

const navItems: NavItem[] = [
  {
    label: 'Dashboard',
    href: '/agent',
    icon: LayoutDashboard,
    roles: ['agent'],
  },
  {
    label: 'Import Leads',
    href: '/agent/leads',
    icon: Upload,
    roles: ['agent'],
  },
  {
    label: 'Power Dialer',
    href: '/agent/dialer',
    icon: Phone,
    roles: ['agent'],
  },
  {
    label: 'Sales',
    href: '/agent/sales',
    icon: Receipt,
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
    label: 'Leaderboard',
    href: '/leaderboard',
    icon: Trophy,
    roles: ['hr', 'agent'],
  },
];

export function Sidebar() {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (!user) return null;

  const filteredItems = navItems.filter((item) => item.roles.includes(user.role));

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
          <nav className="flex-1 p-4 space-y-1">
            {filteredItems.map((item) => {
              const isActive = pathname === item.href;
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
                </Link>
              );
            })}
          </nav>

          {/* User Info */}
          <div className="p-4 border-t">
            <div className="flex items-center gap-3 mb-3">
              <div className="h-10 w-10 rounded-full bg-primary-100 flex items-center justify-center">
                <span className="text-primary-600 font-bold">
                  {user.full_name.charAt(0)}
                </span>
              </div>
              <div>
                <p className="font-medium text-gray-900">{user.full_name}</p>
                <p className="text-xs text-gray-500 capitalize">{user.role}</p>
              </div>
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
