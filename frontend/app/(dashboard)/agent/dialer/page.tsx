'use client';

import { useAuth } from '@/hooks/use-auth';
import { PowerDialer } from '@/components/dialer/PowerDialer';
import { redirect } from 'next/navigation';
import { Phone, AlertCircle, Loader2 } from 'lucide-react';

export default function PowerDialerPage() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  if (!user) {
    redirect('/login');
  }

  if (user.role !== 'agent') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center max-w-md">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-red-700">Access Denied</h2>
          <p className="text-red-600 mt-2">This page is only available for agents.</p>
        </div>
      </div>
    );
  }

  if (!user.extension_number) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 text-center max-w-md">
          <Phone className="h-12 w-12 text-yellow-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-yellow-700">Extension Required</h2>
          <p className="text-yellow-600 mt-2">
            Your account doesn't have an extension number configured. 
            Please contact HR to set up your phone extension.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-lg mx-auto space-y-6">
        {/* Page Header */}
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900">Power Dialer</h1>
          <p className="text-gray-500 mt-1">Auto-dial through your leads list</p>
        </div>

        {/* Power Dialer Component */}
        <PowerDialer 
          agentExtension={user.extension_number} 
          userId={user.id}
          onCallComplete={(lead) => {
            console.log('Call completed for lead:', lead);
          }}
        />

        {/* Tips Section */}
        <div className="bg-white rounded-xl border p-4">
          <h3 className="font-semibold text-gray-900 mb-3">How it works</h3>
          <ul className="space-y-2 text-sm text-gray-600">
            <li className="flex items-start gap-2">
              <span className="bg-indigo-100 text-indigo-600 rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0 text-xs font-bold">1</span>
              <span>Click "Start Dialing" to begin auto-calling your pending leads</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="bg-indigo-100 text-indigo-600 rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0 text-xs font-bold">2</span>
              <span>Your phone ({user.extension_number}) will ring and connect you to each lead</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="bg-indigo-100 text-indigo-600 rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0 text-xs font-bold">3</span>
              <span>After each call, you have 5 seconds to prepare before the next call</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="bg-indigo-100 text-indigo-600 rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0 text-xs font-bold">4</span>
              <span>Click "Stop Dialing" anytime to pause</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
