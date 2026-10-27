'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Share2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import { Btn, Pill, PageHeader, Spinner, ErrorNote, Empty } from '@/components/training/ui';
import { ProjectsPage, ProjectsProvider, SectionCard, useConfirm, useToast } from '@/components/projects/ui';
import { papi, usePapi, fmtDay, relTime } from '@/components/projects/lib';

interface Share {
  id: number; grantee_id: number | string; grantee_name: string | null; resource_type: string; resource_id: string; level: string;
  scope: { pending_approval?: boolean; hr_approved?: boolean; vault_envs?: string[] }; source: string; expires_at: string | null;
  granted_by_name: string | null; created_at: string; active: boolean; label: string; link: string;
}

const TYPE: Record<string, string> = { project: 'Project', ticket: 'Ticket', file: 'File', saved_view: 'Saved view', vault_item: 'Env variable' };

function ShareRows({ rows, mode, onChange }: { rows: Share[]; mode: 'with_me' | 'by_me' | 'approvals'; onChange: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  async function end(s: Share) {
    if (!(await confirm({ title: 'End this access?', body: mode === 'with_me' ? 'You won’t be able to open it any more.' : `${s.grantee_name} loses access now.`, confirmLabel: 'End access', danger: true }))) return;
    try { await papi(`/api/shares/${s.id}`, { method: 'DELETE' }); toast('Access ended'); onChange(); } catch (e) { toast((e as Error).message, 'error'); }
  }
  async function approve(s: Share) {
    try { await papi(`/api/shares/${s.id}/approve`, { method: 'POST' }); toast('Approved'); onChange(); } catch (e) { toast((e as Error).message, 'error'); }
  }
  return (
    <ul className="divide-y divide-gray-100">
      {rows.map((s) => (
        <li key={s.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone="gray">{TYPE[s.resource_type] || s.resource_type}</Pill>
              {s.active ? <Link href={s.link} className="truncate text-sm font-medium text-gray-900 hover:underline">{s.label}</Link>
                : <span className="truncate text-sm font-medium text-gray-500">{s.label}</span>}
              <Pill tone={s.level === 'edit' ? 'violet' : s.level === 'comment' ? 'blue' : 'gray'}>{s.level === 'comment' ? 'read + comment' : s.level}</Pill>
              {s.scope.pending_approval && <Pill tone="amber">Waiting for HR</Pill>}
              {s.source === 'help_request' && <Pill tone="green">Help request</Pill>}
            </div>
            <p className="mt-0.5 text-xs text-gray-500">
              {mode === 'with_me' ? `From ${s.granted_by_name || 'someone'}` : `To ${s.grantee_name}`}
              {' · '}{s.expires_at ? `until ${fmtDay(s.expires_at.slice(0, 10))}` : 'no end date'} · {relTime(s.created_at)}
              {s.scope.vault_envs?.length ? ` · Env: ${s.scope.vault_envs.join(', ')}` : ''}
            </p>
          </div>
          <div className="flex shrink-0 gap-1.5">
            {mode === 'approvals' && <Btn size="sm" variant="success" onClick={() => approve(s)}>Approve</Btn>}
            <Btn size="sm" variant="ghost" onClick={() => end(s)}>{mode === 'with_me' ? 'Leave' : mode === 'approvals' ? 'Reject' : 'End'}</Btn>
          </div>
        </li>
      ))}
    </ul>
  );
}

function SharedPage() {
  const { user } = useAuth();
  const sp = useSearchParams();
  const isHr = user?.role === 'hr' || (user as any)?.role === 'ceo';
  const [tab, setTab] = useState<'with_me' | 'by_me' | 'approvals'>((sp.get('tab') as any) || 'with_me');
  const { data, error, mutate } = usePapi<Share[]>(`/api/shares?scope=${tab}`, { refreshInterval: 30_000 });
  const tabs: { k: typeof tab; label: string }[] = [{ k: 'with_me', label: 'Shared with me' }, { k: 'by_me', label: 'Shared by me' }];
  if (isHr) tabs.push({ k: 'approvals', label: 'Waiting for approval' });
  return (
    <ProjectsPage>
      <PageHeader title="Shared" subtitle="Tickets, files, views and Env variables shared with specific people, and temporary help access. Everything here ends on its date." />
      <div role="tablist" className="mb-4 inline-flex gap-1 rounded-xl bg-gray-100 p-1">
        {tabs.map((t) => (
          <button key={t.k} role="tab" aria-selected={tab === t.k} onClick={() => setTab(t.k)}
            className={cn('rounded-lg px-3 py-1.5 text-sm font-medium', tab === t.k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900')}>{t.label}</button>
        ))}
      </div>
      <SectionCard title={tabs.find((t) => t.k === tab)?.label || ''}>
        {error ? <ErrorNote error={error} /> : !data ? <Spinner /> : data.length ? <ShareRows rows={data} mode={tab} onChange={() => mutate()} />
          : <Empty icon={<Share2 className="h-6 w-6" />} title="Nothing here" body={tab === 'with_me' ? 'When someone shares something with you, it shows up here with its end date.' : undefined} />}
      </SectionCard>
    </ProjectsPage>
  );
}

export default function Page() {
  return <ProjectsProvider><SharedPage /></ProjectsProvider>;
}
