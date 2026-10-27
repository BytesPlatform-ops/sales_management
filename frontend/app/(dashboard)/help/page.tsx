'use client';

import Link from 'next/link';
import { useState } from 'react';
import { LifeBuoy } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { Btn, Pill, PageHeader, Spinner, ErrorNote, Empty } from '@/components/training/ui';
import { ProjectsPage, ProjectsProvider, SectionCard, useToast } from '@/components/projects/ui';
import { papi, usePapi, relTime, fmtDay, sameId } from '@/components/projects/lib';

interface Help {
  id: number; status: string; skills: string[]; message: string; created_at: string; expires_at: string | null; ticket_id: number;
  project_id: number; requested_by: number | string; requested_by_name: string | null; accepted_by: number | string | null;
  accepted_by_name: string | null; ticket_key: string; ticket_title: string; project_ticket_no: string; project_title: string;
}

const TONE: Record<string, 'blue' | 'green' | 'gray' | 'amber'> = { open: 'blue', accepted: 'green', expired: 'gray', cancelled: 'gray', declined: 'amber' };

function HelpList({ rows, meId, onChange }: { rows: Help[]; meId: number | undefined; onChange: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<number | null>(null);
  async function act(h: Help, action: string, ok: string) {
    setBusy(h.id);
    try { await papi(`/api/help-requests/${h.id}`, { method: 'POST', body: { action } }); toast(ok); onChange(); }
    catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(null); }
  }
  return (
    <ul className="divide-y divide-gray-100">
      {rows.map((h) => {
        const mineToAnswer = h.status === 'open' && !sameId(h.requested_by, meId);
        const canOpen = h.status === 'accepted' && sameId(h.accepted_by, meId);
        return (
          <li key={h.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-semibold text-gray-500">{h.ticket_key}</span>
                <span className="text-sm font-medium text-gray-900">{h.ticket_title}</span>
                <Pill tone={TONE[h.status] || 'gray'}>{h.status}</Pill>
                {h.skills.map((s) => <span key={s} className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">{s}</span>)}
              </div>
              <p className="mt-1 text-sm text-gray-700">{h.message}</p>
              <p className="mt-0.5 text-xs text-gray-500">
                {h.requested_by_name} · {h.project_ticket_no} {h.project_title} · {relTime(h.created_at)}
                {h.accepted_by_name ? ` · helping: ${h.accepted_by_name}` : ''}
                {h.expires_at && h.status === 'accepted' ? ` · access until ${fmtDay(h.expires_at.slice(0, 10))}` : ''}
              </p>
            </div>
            <div className="flex shrink-0 gap-1.5">
              {mineToAnswer && <>
                <Btn size="sm" variant="success" disabled={busy === h.id} onClick={() => act(h, 'accept', 'You have access for 3 days')}>Accept</Btn>
                <Btn size="sm" variant="ghost" disabled={busy === h.id} onClick={() => act(h, 'decline', 'Declined')}>Can’t help</Btn>
              </>}
              {canOpen && <Link href={`/projects/${h.project_id}/tickets/${h.ticket_key}`} className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">Open ticket</Link>}
              {sameId(h.requested_by, meId) && (h.status === 'open' || h.status === 'accepted') &&
                <Btn size="sm" variant="ghost" disabled={busy === h.id} onClick={() => act(h, 'cancel', 'Ended')}>End</Btn>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function HelpPage() {
  const { user } = useAuth();
  const forMe = usePapi<Help[]>('/api/help-requests?scope=for_me', { refreshInterval: 30_000 });
  const mine = usePapi<Help[]>('/api/help-requests?scope=mine', { refreshInterval: 30_000 });
  const refresh = () => { forMe.mutate(); mine.mutate(); };
  return (
    <ProjectsPage>
      <PageHeader title="Help requests" subtitle="Developers asking for a hand. Accepting gives you read + comment access and Development secrets for 3 days." />
      <div className="space-y-4">
        <SectionCard title="For you">
          {forMe.error ? <ErrorNote error={forMe.error} /> : !forMe.data ? <Spinner /> : forMe.data.length
            ? <HelpList rows={forMe.data} meId={user?.id} onChange={refresh} />
            : <Empty icon={<LifeBuoy className="h-6 w-6" />} title="Nobody needs you right now" body="Add your skills on My profile so the right requests find you." />}
        </SectionCard>
        <SectionCard title="Asked by you">
          {mine.error ? <ErrorNote error={mine.error} /> : !mine.data ? <Spinner /> : mine.data.length
            ? <HelpList rows={mine.data} meId={user?.id} onChange={refresh} />
            : <p className="text-sm text-gray-500">Use “Help” on a ticket to ask someone.</p>}
        </SectionCard>
      </div>
    </ProjectsPage>
  );
}

export default function Page() {
  return <ProjectsProvider><HelpPage /></ProjectsProvider>;
}
