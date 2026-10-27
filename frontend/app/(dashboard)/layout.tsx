'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AuthProvider, useAuth } from '@/hooks/use-auth';
import { Sidebar } from '@/components/layout/sidebar';
import { CommandPalette } from '@/components/command/CommandPalette';
import { CeoBar, StaffNotices, ViewAsBanner } from '@/components/ceo/CeoBar';

function DashboardContent({ children }: { children: React.ReactNode }) {
  const { user, loading, isAuthenticated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push('/login');
    }
  }, [loading, isAuthenticated, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <ViewAsBanner />
      <Sidebar />
      <CommandPalette />
      <CeoBar />
      <StaffNotices />
      <main className={user?.view_as ? 'lg:ml-64 p-6 pt-12' : user?.isCeo ? 'lg:ml-64 p-6 pt-14' : 'lg:ml-64 p-6'}>{children}</main>
    </div>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <DashboardContent>{children}</DashboardContent>
    </AuthProvider>
  );
}
