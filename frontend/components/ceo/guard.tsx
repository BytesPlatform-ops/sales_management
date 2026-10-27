'use client';

import Link from 'next/link';
import { ReactNode } from 'react';
import { useAuth } from '@/hooks/use-auth';

/** Renders children for CEOs only; a short notice for everyone else. (The API enforces it too.) */
export function CeoOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!user) return null;
  if (!user.isCeo) {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-600">
        This page is for CEO / Executive accounts. <Link href="/" className="text-primary-600 underline">Go home</Link>
      </div>
    );
  }
  return <>{children}</>;
}
