'use client';

import { useState } from 'react';
import { Flame, Trophy } from 'lucide-react';
import { useTraining } from '@/lib/training/client';
import { useAuth } from '@/hooks/use-auth';
import { PageHeader, Panel, ErrorNote, Spinner, Empty, scoreTone } from '@/components/training/ui';
import { BadgeIcon } from '@/components/training/rep/common';
import { cn } from '@/lib/utils';

const MEDAL = ['🥇', '🥈', '🥉'];

export default function ScoreboardPage() {
  const { user } = useAuth();
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const { data, error } = useTraining<any[]>(`/leaderboard?period=${period}`);
  const me = (data || []).find((r) => Number(r.user_id) === Number(user?.id));

  return (
    <div>
      <PageHeader title="Scoreboard" subtitle="Points come from effort, not just sales: daily drills, your streak, roleplay scores, graded calls and meetings booked. New reps can top it too."
        actions={
          <div className="flex rounded-lg border border-gray-200 bg-white p-0.5" role="group" aria-label="Period">
            {(['week', 'month'] as const).map((p) => (
              <button key={p} type="button" onClick={() => setPeriod(p)} aria-pressed={period === p}
                className={cn('rounded-md px-3 py-1.5 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500', period === p ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-50')}>
                {p === 'week' ? 'This week' : 'Last 30 days'}
              </button>
            ))}
          </div>
        } />

      {me && (
        <div className="mb-5 flex flex-wrap items-center gap-4 rounded-2xl border border-primary-200 bg-primary-50 px-5 py-4">
          <div className="text-3xl font-extrabold text-primary-700 tabular-nums">#{me.rank}</div>
          <div className="text-sm text-primary-900"><div className="font-semibold">You · {me.points} points</div><div>{me.drills} drills · {me.streak}-day streak · {me.badges.length} badges</div></div>
        </div>
      )}

      {error ? <ErrorNote error={error} /> : !data ? <Spinner /> : data.length === 0 ? (
        <Panel><Empty icon={<Trophy className="h-6 w-6" />} title="No one on the board yet" body="Do today's drill to get on it." /></Panel>
      ) : (
        <Panel className="p-0">
          <div className="overflow-x-auto -m-5">
            <table className="w-full min-w-[760px] text-sm">
              <caption className="sr-only">Training leaderboard</caption>
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-400 border-b border-gray-100">
                  <th scope="col" className="px-5 py-3 font-medium">Rank</th>
                  <th scope="col" className="px-3 py-3 font-medium">Rep</th>
                  <th scope="col" className="px-3 py-3 font-medium text-right">Drills</th>
                  <th scope="col" className="px-3 py-3 font-medium text-right">Streak</th>
                  <th scope="col" className="px-3 py-3 font-medium text-right">Roleplay avg</th>
                  <th scope="col" className="px-3 py-3 font-medium text-right">Live call avg</th>
                  <th scope="col" className="px-3 py-3 font-medium text-right">Meetings</th>
                  <th scope="col" className="px-3 py-3 font-medium">Badges</th>
                  <th scope="col" className="px-5 py-3 font-medium text-right">Points</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.map((r) => {
                  const mine = Number(r.user_id) === Number(user?.id);
                  return (
                    <tr key={r.user_id} className={cn(mine ? 'bg-primary-50 font-medium' : 'hover:bg-gray-50')} aria-current={mine ? 'true' : undefined}>
                      <td className="px-5 py-3 tabular-nums">{MEDAL[r.rank - 1] || r.rank}</td>
                      <td className="px-3 py-3 text-gray-900 whitespace-nowrap">{r.name}{mine && <span className="ml-1.5 rounded-full bg-primary-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">you</span>}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{r.drills}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{r.streak > 0 ? <span className="inline-flex items-center gap-0.5"><Flame className="h-3.5 w-3.5 text-orange-500" aria-hidden />{r.streak}</span> : 0}</td>
                      <td className={cn('px-3 py-3 text-right tabular-nums', scoreTone(r.roleplay_avg))}>{r.roleplay_avg ?? '—'}{r.roleplays ? <span className="text-xs text-gray-400"> ({r.roleplays})</span> : null}</td>
                      <td className={cn('px-3 py-3 text-right tabular-nums', scoreTone(r.live_avg))}>{r.live_avg ?? '—'}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{r.meetings}</td>
                      <td className="px-3 py-3">
                        <span className="flex flex-wrap gap-1">
                          {(r.badges || []).slice(0, 6).map((b: any) => <span key={b.code} title={b.title} className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-50 border border-amber-200 text-amber-600" aria-label={b.title}><BadgeIcon icon={b.icon} /></span>)}
                          {(r.badges || []).length > 6 && <span className="text-xs text-gray-400">+{r.badges.length - 6}</span>}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right font-bold tabular-nums text-gray-900">{r.points}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
      <p className="mt-3 text-xs text-gray-500">Points: 10 per daily drill · 5 per streak day · roleplay average (up to 5 roleplays) · 25 per meeting booked · half your live-call average.</p>
    </div>
  );
}
