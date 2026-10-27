'use client';

import Link from 'next/link';
import { Crown, ShieldCheck, Eye, UserCog, Lock, LayoutDashboard, FolderKanban } from 'lucide-react';
import { PageHeader } from '@/components/training/ui';
import { CeoOnly } from '@/components/ceo/guard';
import { useAuth } from '@/hooks/use-auth';

const CARDS = [
  { href: '/hr', icon: LayoutDashboard, title: 'HR dashboard', body: 'Every HR screen: sales, calls, QA, attendance, payroll, training.' },
  { href: '/projects', icon: FolderKanban, title: 'Projects', body: 'All client projects, tickets, files and Env names.' },
  { href: '/ceo/security', icon: ShieldCheck, title: 'Security', body: 'Your sessions, two-step sign-in, CEO access and Admin-mode logs, Env revocations.' },
  { href: '/ceo/users', icon: UserCog, title: 'CEO accounts', body: 'Add or remove executive accounts (Admin mode).' },
  { href: '/ceo/privacy', icon: Lock, title: 'Privacy', body: 'Workplace chat visibility and staff notices.' },
];

export default function CeoHome() {
  const { user } = useAuth();
  return (
    <CeoOnly>
      <PageHeader title={`Welcome, ${user?.full_name?.split(' ')[0] || 'CEO'}`} subtitle="You can see everything. Changes need Admin mode (top right), which lasts 30 minutes." />
      <div className="mb-6 flex items-start gap-3 rounded-2xl border border-indigo-100 bg-indigo-50 p-4 text-sm text-indigo-900">
        <Crown className="mt-0.5 h-5 w-5 shrink-0" />
        <p>The executive dashboard (company KPIs, analytics, Recording Center, targets and alerts) arrives in the analytics phase. Until then, use the HR dashboard and <span className="inline-flex items-center gap-1 font-semibold"><Eye className="h-3.5 w-3.5" />View as…</span> to see any person’s screens read-only.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {CARDS.map((c) => (
          <Link key={c.href} href={c.href} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-primary-300 hover:shadow">
            <c.icon className="h-5 w-5 text-primary-600" />
            <h2 className="mt-2 font-semibold text-gray-900">{c.title}</h2>
            <p className="mt-1 text-sm text-gray-600">{c.body}</p>
          </Link>
        ))}
      </div>
    </CeoOnly>
  );
}
