'use client';

import { useState } from 'react';
import { PageHeader, Panel, Btn, Spinner } from '@/components/training/ui';
import { papi, usePapi } from '@/components/projects/lib';
import { CeoOnly } from '@/components/ceo/guard';
import { useAuth } from '@/hooks/use-auth';

interface Privacy { workplace_chat_visibility: { enabled: boolean; effective_at: string | null }; in_effect: boolean; notice_lead_hours: number }

export default function PrivacyPage() {
  const { user } = useAuth();
  const { data, mutate } = usePapi<Privacy>('/api/ceo/privacy');
  const [msg, setMsg] = useState<string | null>(null);
  const admin = !!user?.admin_until && user.admin_until * 1000 > Date.now();
  const v = data?.workplace_chat_visibility;

  async function set(on: boolean) {
    if (on && !window.confirm(`All staff will see a notice now, and work chats (including direct messages) become visible to CEOs ${data?.notice_lead_hours ?? 24} hours later. Continue?`)) return;
    setMsg(null);
    try { await papi('/api/ceo/privacy', { method: 'PUT', body: { workplace_chat_visibility: on } }); mutate(); } catch (e) { setMsg((e as Error).message); }
  }

  return (
    <CeoOnly>
      <PageHeader title="Privacy" subtitle="What CEOs can see by default, and what needs staff to be told first." />
      <Panel title="Workplace chat visibility">
        {!data ? <Spinner /> : (
          <div className="space-y-3 text-sm text-gray-700">
            <p>Work modules, recordings, 1:1 notes and per-person pay are visible to CEOs (and every view of the sensitive ones is logged). <strong>Private direct messages are hidden</strong> unless you turn this on.</p>
            <p>
              Status: <strong>{!v?.enabled ? 'Off' : data.in_effect ? 'On' : `Turning on — staff notified, takes effect ${new Date(v.effective_at!).toLocaleString('en-GB', { timeZone: 'Asia/Karachi', dateStyle: 'medium', timeStyle: 'short' })} PKT`}</strong>
            </p>
            {!admin && <p className="text-amber-700">Turn on Admin mode to change this.</p>}
            <div className="flex gap-2">
              {!v?.enabled
                ? <Btn variant="danger" disabled={!admin} onClick={() => set(true)}>Make work chats visible to CEOs</Btn>
                : <Btn variant="secondary" disabled={!admin} onClick={() => set(false)}>Turn off (hide private chats again)</Btn>}
            </div>
            {msg && <p className="text-red-600">{msg}</p>}
          </div>
        )}
      </Panel>
    </CeoOnly>
  );
}
