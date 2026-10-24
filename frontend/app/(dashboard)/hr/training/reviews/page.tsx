'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Inbox, RefreshCw } from 'lucide-react';
import { useTraining } from '@/lib/training/client';
import { Panel, Spinner, ErrorNote, Pill, Empty, Btn, scoreTone, inputCls } from '@/components/training/ui';
import { TrainerPage, TableWrap, th, td, ago } from '@/components/training/hr/kit';
import { cn } from '@/lib/utils';
import { Suspense } from 'react';
import { QueueRow, queuePath } from '@/components/training/hr/review';

const SORTS = [
  { id: 'lowest', label: 'Lowest score first' },
  { id: 'disagreement', label: 'Biggest AI-vs-trainer gap' },
  { id: 'oldest', label: 'Oldest first' },
];

export default function ReviewQueuePage() {
  return <Suspense fallback={<Spinner />}><ReviewQueue /></Suspense>;
}

function ReviewQueue() {
  const sp = useSearchParams();
  const router = useRouter();
  const sort = sp.get('sort') || 'lowest';
  const status = sp.get('status') || 'needs_review';
  const { data, error, isLoading, mutate, isValidating } = useTraining<QueueRow[]>(queuePath(sort, status));
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(sp.toString());
    p.set(k, v);
    router.replace(`/hr/training/reviews?${p}`);
  };
  const qs = `?sort=${sort}&status=${status}`;

  return (
    <TrainerPage
      title="Review queue"
      subtitle="Roleplays and live calls that need a human look: scores under 60 or over 90, reps whose last AI-vs-trainer gap was over 15, and anything graded in standard mode."
      actions={<Btn variant="secondary" size="sm" onClick={() => mutate()} disabled={isValidating}><RefreshCw className={cn('h-4 w-4', isValidating && 'animate-spin')} /> Refresh</Btn>}
    >
      <Panel>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="block text-xs font-medium text-gray-500 mb-1">Sort</span>
            <select className={cn(inputCls, 'w-auto')} value={sort} onChange={(e) => set('sort', e.target.value)}>
              {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-xs font-medium text-gray-500 mb-1">Show</span>
            <select className={cn(inputCls, 'w-auto')} value={status} onChange={(e) => set('status', e.target.value)}>
              <option value="needs_review">Waiting for review</option>
              <option value="all">Everything graded</option>
            </select>
          </label>
          {data && <span className="text-sm text-gray-500 ml-auto">{data.length} item{data.length === 1 ? '' : 's'}</span>}
        </div>
        <ErrorNote error={error} />
        {isLoading ? <Spinner /> : !data?.length ? (
          <Empty icon={<Inbox className="h-5 w-5" />} title={status === 'all' ? 'Nothing graded yet' : 'Queue is empty'} body={status === 'all' ? undefined : 'Nice — nothing is waiting for you.'} />
        ) : (
          <TableWrap>
            <thead className="bg-gray-50">
              <tr>
                <th className={th}>Kind</th><th className={th}>Rep</th><th className={th}>Title</th><th className={th}>Purpose</th>
                <th className={cn(th, 'text-right')}>AI score</th><th className={cn(th, 'text-right')}>Final</th>
                <th className={cn(th, 'text-right')} title="This rep's most recent AI-vs-trainer gap">Last gap</th>
                <th className={cn(th, 'text-right')}>Age</th><th className={th}></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.map((r) => (
                <tr key={`${r.kind}-${r.id}`} className="hover:bg-gray-50">
                  <td className={td}><Pill tone={r.kind === 'call' ? 'blue' : 'violet'}>{r.kind === 'call' ? 'Live call' : 'Roleplay'}</Pill></td>
                  <td className={cn(td, 'whitespace-nowrap font-medium text-gray-900')}>{r.full_name}</td>
                  <td className={cn(td, 'max-w-xs')}><span className="line-clamp-2">{r.title || '—'}</span>{r.engine === 'script' && <span className="text-xs text-gray-400">scripted (standard mode)</span>}</td>
                  <td className={td}>
                    {r.purpose ? <Pill tone={r.purpose === 'exam' ? 'violet' : 'gray'}>{r.purpose}</Pill> : '—'}
                    {r.exam_kind && <div className="text-xs text-gray-400 mt-0.5">{r.exam_kind}</div>}
                  </td>
                  <td className={cn(td, 'text-right tabular-nums')}>{r.ai_total ?? <span className="text-xs text-gray-400">not graded</span>}</td>
                  <td className={cn(td, 'text-right tabular-nums font-semibold', scoreTone(r.final_score))}>{r.final_score ?? '—'}{r.human_reviewed && <div className="text-xs font-normal text-emerald-600">reviewed</div>}</td>
                  <td className={cn(td, 'text-right tabular-nums', (r.last_gap ?? 0) > 15 && 'text-red-600 font-semibold')}>{r.last_gap ?? '—'}</td>
                  <td className={cn(td, 'text-right whitespace-nowrap text-gray-500')}>{ago(r.at)}</td>
                  <td className={cn(td, 'text-right')}>
                    <Link href={`/hr/training/reviews/${r.kind}/${r.id}${qs}`} className="inline-flex rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700">
                      {r.human_reviewed ? 'Open' : 'Grade'}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>
    </TrainerPage>
  );
}
