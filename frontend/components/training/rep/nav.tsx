'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Route, Sun, Layers, Phone, Headphones, Trophy, Radar } from 'lucide-react';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/agent/training', label: 'My Path', icon: Route, match: (p: string) => p === '/agent/training' || p.startsWith('/agent/training/lesson') },
  { href: '/agent/training/today', label: 'Today', icon: Sun },
  { href: '/agent/training/flashcards', label: 'Flashcards', icon: Layers },
  { href: '/agent/training/roleplay', label: 'Roleplay', icon: Phone },
  { href: '/agent/training/calls', label: 'My Calls', icon: Headphones },
  { href: '/agent/training/scoreboard', label: 'Scoreboard', icon: Trophy },
  { href: '/agent/training/assist', label: 'Live Assist', icon: Radar },
];

/** Sub-navigation shared by every rep training screen. */
export function TrainingNav() {
  const pathname = usePathname() || '';
  return (
    <nav aria-label="Training sections" className="mb-6 -mx-1 pt-10 lg:pt-0">
      <ul className="flex flex-wrap gap-1.5 px-1">
        {TABS.map((t) => {
          const active = t.match ? t.match(pathname) : pathname === t.href || pathname.startsWith(t.href + '/');
          const Icon = t.icon;
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                  active ? 'bg-primary-600 text-white shadow-sm' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 hover:text-gray-900'
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
