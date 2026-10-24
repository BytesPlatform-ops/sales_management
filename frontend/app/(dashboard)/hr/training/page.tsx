'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { AlertTriangle, RefreshCw, Users } from 'lucide-react';
import { useTraining, fmtDate } from '@/lib/training/client';
import { Panel, PhaseBadge, ProgressBar, Spinner, ErrorNote, Pill, Empty, Btn, Stat, scoreTone } from '@/components/training/ui';
import { TrainerPage, TableWrap, th, td, fmtUsd, Help } from '@/components/training/hr/kit';
import { cn } from '@/lib/utils';

interface CohortRep {
  id: string | number; name: string; username: string; phase: string; quota_multiplier: number; grandfathered: boolean;
  phase_started_at: string; certified_at: string | null;
  tracks: { code: string; title: string; progress_pct: number; completed: boolean }[];
  certifications: { code: string; granted_at: string; method: string }[];
  time_to_cert_days: number | null; first_attempt_pass_pct: number | null; roleplay_avg_28d: number | null; roleplays_28d: number;
  flashcard_retention_pct: number | null; ai_spend_usd: number; ai_cap_usd: number | null;
  live_scorecard_avg: number | null; live_scorecard_n: number; live_scorecard_source: 'scorecard' | 'qa';
  suggest_supervised: boolean; pending_reviews: number;
}
interface Cohort {
  reps: CohortRep[];
  question_stats: { id: number; prompt: string; tags: string[]; lesson_code: string; answered: number; correct_pct: number }[];
  criteria: { id: string; criterion: string; n: number; avg_points: number; max_points: number; pct: number | null }[];
  ai_vs_human: { avg_gap: number | null; n: number; over_15: number };
  correlation: { n: number; r: number | null; note: string | null };
  kpi_targets: Record<string, string>[];
}

const CERT_SHORT: Record<string, string> = { PRODUCT_CERT: 'Product', LIVE_CALL_CERT: 'Live calls', BYTESCON_CERT: 'Bytescon' };

export default function CohortDashboard() {
  const { data, error, isLoading, mutate, isValidating } = useTraining<Cohort>('/analytics/cohort');
  const { data: settings } = useTraining<any>('/settings');
  const { data: questions } = useTraining<any[]>('/admin/questions');
  const qLesson = useMemo(() => new Map((questions || []).map((q) => [q.id, q.lesson_id])), [questions]);
  const defaultCap = settings?.ai_caps?.rep_monthly_usd;

  const reps = data?.reps || [];
  const inTraining = reps.filter((r) => r.phase === 'TRAINING').length;
  const certified = reps.filter((r) => r.certifications.some((c) => c.code === 'LIVE_CALL_CERT')).length;
  const pending = reps.reduce((s, r) => s + r.pending_reviews, 0);
  const ttc = reps.map((r) => r.time_to_cert_days).filter((v): v is number => v !== null);
  const flagged = reps.filter((r) => r.suggest_supervised);

  return (
    <TrainerPage
      title="Training cohort"
      subtitle="Every rep's onboarding progress, certification and live-call quality in one place."
      actions={<Btn variant="secondary" size="sm" onClick={() => mutate()} disabled={isValidating}><RefreshCw className={cn('h-4 w-4', isValidating && 'animate-spin')} /> Refresh</Btn>}
    >
      <ErrorNote error={error} />
      {isLoading ? <Spinner /> : data && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Active reps" value={reps.length} hint={`${inTraining} still in training`} />
            <Stat label="Live-call certified" value={certified} hint={`of ${reps.length} reps`} />
            <Stat label="Avg time to certify" value={ttc.length ? `${(ttc.reduce((a, b) => a + b, 0) / ttc.length).toFixed(1)} d` : '—'} hint="hire date → LIVE_CALL_CERT (target ≤3 days)" />
            <Stat label="Waiting for review" value={<Link href="/hr/training/reviews" className="hover:underline">{pending}</Link>} hint="roleplays + calls in the queue" tone={pending ? 'text-amber-600' : undefined} />
          </div>

          {flagged.length > 0 && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <strong>Suggest SUPERVISED:</strong>{' '}
                {flagged.map((r, i) => <span key={r.id}>{i > 0 && ', '}<Link className="underline" href={`/hr/training/rep/${r.id}`}>{r.name}</Link></span>)}
                {' '}— live scorecard average is below the threshold ({settings?.supervised_threshold ?? 55}) over 3+ graded calls. Supervised pauses penalties while you coach; base pay is not affected.
              </div>
            </div>
          )}

          <Panel title="Reps" action={<span className="text-xs text-gray-400">Click a name for detail and actions</span>}>
            {reps.length === 0 ? <Empty icon={<Users className="h-5 w-5" />} title="No active reps yet" body="Reps appear here once they are added under Agents." /> : (
              <TableWrap>
                <thead className="bg-gray-50">
                  <tr>
                    <th className={th}>Rep</th>
                    <th className={th}>Phase</th>
                    <th className={th}>Track 1 · Product</th>
                    <th className={th}>Track 2 · Sales</th>
                    <th className={th}>Certifications</th>
                    <th className={cn(th, 'text-right')} title="Days from hire to Live-Calling Certification">Time to cert</th>
                    <th className={cn(th, 'text-right')} title="Share of quizzes/exams passed on the first try">1st-try pass</th>
                    <th className={cn(th, 'text-right')} title="Average roleplay score, last 28 days">Roleplay avg</th>
                    <th className={cn(th, 'text-right')} title="4-week average of graded live calls">Live calls</th>
                    <th className={cn(th, 'text-right')} title="Flashcards answered Good/Easy">Retention</th>
                    <th className={cn(th, 'text-right')}>AI spend</th>
                    <th className={cn(th, 'text-right')}>Reviews</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {reps.map((r) => {
                    const t1 = r.tracks.find((t) => t.code === 'T1') || r.tracks[0];
                    const t2 = r.tracks.find((t) => t.code === 'T2') || r.tracks[1];
                    const cap = r.ai_cap_usd ?? defaultCap;
                    return (
                      <tr key={r.id} className={cn('hover:bg-gray-50', r.suggest_supervised && 'bg-amber-50/60')}>
                        <td className={td}>
                          <Link href={`/hr/training/rep/${r.id}`} className="font-medium text-gray-900 hover:text-primary-700 hover:underline">{r.name}</Link>
                          <div className="text-xs text-gray-400">@{r.username}</div>
                          {r.suggest_supervised && <Pill tone="amber" className="mt-1"><AlertTriangle className="h-3 w-3" /> Suggest SUPERVISED</Pill>}
                        </td>
                        <td className={td}>
                          <PhaseBadge phase={r.phase} />
                          {r.grandfathered && <div className="mt-1 text-xs text-gray-400" title="Hired before the training module launched: treated as certified, full quota.">grandfathered</div>}
                          {r.phase !== 'FULL' && !r.grandfathered && <div className="mt-1 text-xs text-gray-400">since {fmtDate(r.phase_started_at)}</div>}
                        </td>
                        {[t1, t2].map((t, i) => (
                          <td key={i} className={cn(td, 'min-w-[120px]')}>
                            {t ? (<><ProgressBar value={t.progress_pct} tone={t.completed ? 'green' : 'primary'} /><div className="mt-1 text-xs text-gray-500 tabular-nums">{t.progress_pct}%{t.completed ? ' · done' : ''}</div></>) : '—'}
                          </td>
                        ))}
                        <td className={td}>
                          {r.certifications.length === 0 ? <span className="text-xs text-gray-400">none yet</span> : (
                            <div className="space-y-1">
                              {r.certifications.map((c) => (
                                <div key={c.code} className="text-xs whitespace-nowrap">
                                  <Pill tone={c.code === 'LIVE_CALL_CERT' ? 'green' : 'blue'}>{CERT_SHORT[c.code] || c.code}</Pill>{' '}
                                  <span className="text-gray-400">{c.method === 'grandfathered' ? 'grandfathered' : fmtDate(c.granted_at)}{c.method === 'manual' ? ' · manual' : ''}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className={cn(td, 'text-right tabular-nums')}>{r.time_to_cert_days === null ? '—' : `${r.time_to_cert_days} d`}</td>
                        <td className={cn(td, 'text-right tabular-nums')}>{r.first_attempt_pass_pct === null ? '—' : `${r.first_attempt_pass_pct}%`}</td>
                        <td className={cn(td, 'text-right tabular-nums')}>
                          <span className={cn('font-semibold', scoreTone(r.roleplay_avg_28d))}>{r.roleplay_avg_28d ?? '—'}</span>
                          {r.roleplays_28d > 0 && <div className="text-xs text-gray-400">{r.roleplays_28d} sessions</div>}
                        </td>
                        <td className={cn(td, 'text-right tabular-nums')}>
                          <span className={cn('font-semibold', scoreTone(r.live_scorecard_avg))}>{r.live_scorecard_avg ?? '—'}</span>
                          <div className="text-xs text-gray-400 whitespace-nowrap" title={r.live_scorecard_source === 'qa' ? 'No scorecard-graded calls yet, so this uses the QA score × 10' : '100-point scorecard'}>
                            {r.live_scorecard_n ? `${r.live_scorecard_source === 'qa' ? 'QA fallback' : 'scorecard'} · n=${r.live_scorecard_n}` : 'no calls'}
                          </div>
                        </td>
                        <td className={cn(td, 'text-right tabular-nums')}>{r.flashcard_retention_pct === null ? '—' : `${r.flashcard_retention_pct}%`}</td>
                        <td className={cn(td, 'text-right tabular-nums whitespace-nowrap')}>
                          {fmtUsd(r.ai_spend_usd)}
                          <div className="text-xs text-gray-400">of {fmtUsd(cap)}{r.ai_cap_usd === null ? ' (default)' : ''}</div>
                        </td>
                        <td className={cn(td, 'text-right')}>
                          {r.pending_reviews ? <Link href="/hr/training/reviews"><Pill tone="amber">{r.pending_reviews} waiting</Pill></Link> : <span className="text-gray-300">0</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </TableWrap>
            )}
          </Panel>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Panel title="What to coach — weakest scorecard criteria">
              <p className="text-xs text-gray-500 mb-4">Average points per criterion as a share of the maximum, across all roleplays and graded calls in the last 8 weeks. The lowest bars are what the whole team should practise next.</p>
              {data.criteria.length === 0 ? <Empty title="No scored roleplays or calls yet" /> : (
                <ul className="space-y-2.5">
                  {data.criteria.map((c, i) => (
                    <li key={c.id}>
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className={cn('text-gray-800', i < 3 && 'font-semibold')}>{c.criterion}</span>
                        <span className="tabular-nums text-gray-500 text-xs whitespace-nowrap">{c.avg_points}/{c.max_points} · <span className={cn('font-semibold', scoreTone(c.pct))}>{c.pct ?? '—'}%</span></span>
                      </div>
                      <div className="mt-1 h-2 rounded-full bg-gray-100 overflow-hidden" role="img" aria-label={`${c.criterion}: ${c.pct}% of max`}>
                        <div className={cn('h-full rounded-full', (c.pct ?? 0) < 60 ? 'bg-amber-500' : 'bg-primary-500')} style={{ width: `${c.pct ?? 0}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {data.criteria[0] && <p className="mt-3 text-xs text-gray-400">Based on {data.criteria[0].n} scorecards.</p>}
            </Panel>

            <div className="space-y-6">
              <Panel title="Can we trust the AI grader?">
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div><div className={cn('text-2xl font-bold tabular-nums', data.ai_vs_human.avg_gap === null ? 'text-gray-300' : data.ai_vs_human.avg_gap > 10 ? 'text-amber-600' : 'text-emerald-600')}>{data.ai_vs_human.avg_gap ?? '—'}</div><div className="text-xs text-gray-500">avg points apart</div></div>
                  <div><div className="text-2xl font-bold tabular-nums text-gray-900">{data.ai_vs_human.n}</div><div className="text-xs text-gray-500">items you re-graded</div></div>
                  <div><div className={cn('text-2xl font-bold tabular-nums', data.ai_vs_human.over_15 ? 'text-red-600' : 'text-gray-900')}>{data.ai_vs_human.over_15}</div><div className="text-xs text-gray-500">off by more than 15</div></div>
                </div>
                <p className="mt-3 text-xs text-gray-500">
                  Compares the AI score with your score on every roleplay/call you graded yourself. Under ~10 points apart means the AI is grading like you do.
                  A rep whose last gap was over 15 has every new item sent to your review queue. {data.ai_vs_human.n === 0 && 'No AI-graded items have been re-graded yet (standard-mode scripted roleplays are not counted).'}
                </p>
              </Panel>
              <Panel title="Do roleplay scores predict meetings?">
                {data.correlation.r === null ? (
                  <p className="text-sm text-gray-600">Not enough data yet ({data.correlation.n} rep{data.correlation.n === 1 ? '' : 's'} qualify). {data.correlation.note}</p>
                ) : (
                  <p className="text-sm text-gray-700">Correlation between week-2 roleplay average and meetings booked in weeks 5–8: <strong className="tabular-nums">r = {data.correlation.r}</strong> across {data.correlation.n} reps. {data.correlation.note}</p>
                )}
                <p className="mt-2 text-xs text-gray-400">r near 1 = good roleplayers book more meetings later; near 0 = the roleplay rubric is not predicting real results.</p>
              </Panel>
            </div>
          </div>

          <Panel title="Possibly bad questions — lowest correct %">
            <p className="text-xs text-gray-500 mb-3">Quiz and exam questions answered at least 3 times, sorted by how often reps get them right. A question almost nobody gets right may be badly worded or have the wrong answer key.</p>
            {data.question_stats.length === 0 ? <Empty title="Not enough answers yet" body="Questions show up here after 3 or more answers." /> : (
              <TableWrap>
                <thead className="bg-gray-50"><tr><th className={th}>Question</th><th className={th}>Lesson</th><th className={cn(th, 'text-right')}>Answered</th><th className={cn(th, 'text-right')}>Correct</th><th className={th}></th></tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {data.question_stats.slice(0, 12).map((q) => {
                    const lessonId = qLesson.get(q.id);
                    return (
                      <tr key={q.id}>
                        <td className={cn(td, 'max-w-md')}>{q.prompt}<div className="mt-0.5 flex flex-wrap gap-1">{(q.tags || []).map((t) => <Pill key={t}>{t}</Pill>)}</div></td>
                        <td className={cn(td, 'whitespace-nowrap')}>{q.lesson_code || '—'}</td>
                        <td className={cn(td, 'text-right tabular-nums')}>{q.answered}</td>
                        <td className={cn(td, 'text-right tabular-nums font-semibold', q.correct_pct < 50 ? 'text-red-600' : q.correct_pct < 75 ? 'text-amber-600' : 'text-gray-700')}>{q.correct_pct}%</td>
                        <td className={cn(td, 'text-right whitespace-nowrap')}>
                          {lessonId ? <Link href={`/hr/training/content/lesson/${lessonId}?tab=questions&q=${q.id}`} className="text-primary-600 hover:underline text-sm">Edit question</Link> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </TableWrap>
            )}
          </Panel>

          <Panel title="Week-by-week targets for new reps">
            {data.kpi_targets?.length ? (
              <TableWrap>
                <thead className="bg-gray-50"><tr>
                  {['Week', 'Phase', 'Dials / day', 'Conversations / day', 'Meetings / week', 'Show rate', 'Scorecard'].map((h) => <th key={h} className={th}>{h}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {data.kpi_targets.map((k, i) => (
                    <tr key={i}>
                      <td className={cn(td, 'font-medium whitespace-nowrap')}>{k.week}</td>
                      <td className={td}>{k.phase}</td>
                      <td className={cn(td, 'tabular-nums')}>{k.dials}</td>
                      <td className={cn(td, 'tabular-nums')}>{k.conversations}</td>
                      <td className={cn(td, 'tabular-nums')}>{k.meetings}</td>
                      <td className={cn(td, 'tabular-nums')}>{k.show_rate}</td>
                      <td className={td}>{k.scorecard}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            ) : <Empty title="No targets configured" />}
            <Help className="mt-4">These are coaching targets, not pay rules. Pay follows the ramp phase: Training/Supervised/Ramp 50% are penalty-free, Ramp 75% uses 75% of the normal targets, Full uses 100%. Change the schedule under <Link href="/hr/training/settings" className="text-primary-600 underline">Settings</Link>.</Help>
          </Panel>
        </div>
      )}
    </TrainerPage>
  );
}
