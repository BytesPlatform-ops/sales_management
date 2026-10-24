'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Dice5, MessageSquare, Mic, Phone } from 'lucide-react';
import { tapi, useTraining, fmtDate } from '@/lib/training/client';
import { PageHeader, Panel, ErrorNote, Spinner, Pill, Btn, StandardModeBanner, scoreTone, Empty } from '@/components/training/ui';
import { REVIEW_STATUS, fmtDuration } from '@/components/training/rep/common';
import { cn } from '@/lib/utils';

const MOOD: Record<string, string> = { friendly: '🙂 friendly', busy: '⏱️ busy', skeptical: '🤨 skeptical', hostile: '😠 hostile', rushed: '⏱️ rushed' };

export default function RoleplayPickerPage() {
  const router = useRouter();
  const { data, error } = useTraining<any>('/roleplays');
  const [mode, setMode] = useState<'text' | 'voice'>('text');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [filter, setFilter] = useState<'all' | 'practice' | 'exam'>('all');

  const start = async (key: string, body: any) => {
    setBusy(key);
    setErr(null);
    try {
      const r = await tapi<any>('/roleplays', { method: 'POST', body: { purpose: 'practice', ...body, mode } });
      router.push(`/agent/training/roleplay/${r.session.id}`);
    } catch (e) {
      setErr(e);
      setBusy(null);
    }
  };

  if (error) return <ErrorNote error={error} />;
  if (!data) return <Spinner label="Loading roleplays…" />;

  const scenarios: any[] = (data.scenarios || []).filter((s: any) => filter === 'all' || (filter === 'exam' ? !!s.exam_kind : !s.exam_kind));
  const sessions: any[] = data.sessions || [];
  const standard = !data.ai?.available;

  return (
    <div>
      <PageHeader title="Roleplay practice" subtitle="Practise real calls with a pretend prospect. At the end you get a score out of 100 and three things to do better next time." />
      {standard && <StandardModeBanner message={`${data.ai?.message || 'AI unavailable — using standard mode'}. Calls run as scripted conversations: you choose what to say from 2–4 options and get coaching on each choice.`} />}
      <ErrorNote error={err} />

      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <Panel className="md:col-span-2">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-100 text-primary-700"><Dice5 className="h-6 w-6" aria-hidden /></div>
            <div className="flex-1">
              <h2 className="font-semibold text-gray-900">Practise on a random SAM.gov lead</h2>
              <p className="text-sm text-gray-600">We turn a real row from the lead list into a prospect (contact details removed). Great for getting used to real narratives.</p>
            </div>
            <Btn onClick={() => start('random', { lead: 'random' })} disabled={!!busy}><Phone className="h-4 w-4" aria-hidden /> {busy === 'random' ? 'Dialing…' : 'Random lead'}</Btn>
          </div>
        </Panel>
        <Panel>
          <fieldset>
            <legend className="text-sm font-semibold text-gray-900 mb-2">How do you want to talk?</legend>
            <div className="grid grid-cols-2 gap-2">
              <ModeButton active={mode === 'text'} onClick={() => setMode('text')} icon={<MessageSquare className="h-4 w-4" aria-hidden />} label="Text" />
              <ModeButton active={mode === 'voice'} onClick={() => setMode('voice')} icon={<Mic className="h-4 w-4" aria-hidden />} label="Voice" disabled={!data.voice_enabled} />
            </div>
            <p className="mt-2 text-xs text-gray-500">{data.voice_enabled ? 'Voice uses your microphone and a time limit per day.' : 'Voice practice is off right now — text works the same way.'}</p>
          </fieldset>
        </Panel>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-gray-900">Pick a scenario</h2>
        <div className="flex gap-1" role="group" aria-label="Filter scenarios">
          {(['all', 'practice', 'exam'] as const).map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f}
              className={cn('rounded-full px-3 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500', filter === f ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50')}>
              {f === 'all' ? 'All' : f === 'practice' ? 'Practice' : 'Exam-style'}
            </button>
          ))}
        </div>
      </div>
      <p className="mb-3 text-sm text-gray-500">Exam-style scenarios here are practice only. Graded certification roleplays are started from the <Link href="/agent/training" className="text-primary-600 underline">Live-calling certification lesson</Link>.</p>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 mb-8">
        {scenarios.map((s) => (
          <li key={s.id} className="flex flex-col bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
            <div className="flex flex-wrap gap-1.5 mb-2">
              <Pill tone={s.difficulty >= 4 ? 'red' : s.difficulty >= 3 ? 'amber' : 'green'}>Difficulty {s.difficulty}/5</Pill>
              {s.exam_kind && <Pill tone="violet">Exam: {s.exam_kind}</Pill>}
              {s.state && <Pill tone="blue">{s.state}</Pill>}
              {s.mood && <Pill tone="gray">{MOOD[s.mood] || s.mood}</Pill>}
            </div>
            <h3 className="font-semibold text-gray-900">{s.title}</h3>
            {s.firm_type && <p className="text-xs text-gray-500 mt-0.5">{s.firm_type}</p>}
            <p className="mt-2 text-sm text-gray-600 line-clamp-4">{s.objective}</p>
            <div className="mt-auto pt-3 flex items-center justify-between gap-2">
              {standard && !s.has_script ? <span className="text-xs text-amber-700">Needs AI (no scripted version)</span> : <span className="text-xs text-gray-400">{s.code}</span>}
              <Btn size="sm" onClick={() => start(s.code, { scenario_code: s.code })} disabled={!!busy || (standard && !s.has_script)}>
                <Phone className="h-4 w-4" aria-hidden /> {busy === s.code ? 'Dialing…' : 'Start'}
              </Btn>
            </div>
          </li>
        ))}
      </ul>

      <Panel title="Your recent roleplays">
        {sessions.length === 0 ? <Empty title="No roleplays yet" body="Pick a scenario above — your first call is the hardest." /> : (
          <div className="overflow-x-auto -mx-5">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-400">
                  <th className="px-5 py-2 font-medium">Call</th><th className="px-3 py-2 font-medium">When</th><th className="px-3 py-2 font-medium">Length</th>
                  <th className="px-3 py-2 font-medium">Status</th><th className="px-5 py-2 font-medium text-right">Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sessions.map((s) => {
                  const st = REVIEW_STATUS[s.status] || { label: s.status, tone: 'gray' as const };
                  return (
                    <tr key={s.id} className="hover:bg-gray-50">
                      <td className="px-5 py-2.5">
                        <Link href={`/agent/training/roleplay/${s.id}`} className="font-medium text-gray-900 hover:text-primary-700">{s.title || s.scenario_code || `Roleplay #${s.id}`}</Link>
                        <div className="text-xs text-gray-500">{s.purpose === 'exam' ? 'Graded exam' : 'Practice'} · {s.engine === 'script' ? 'scripted' : 'AI'}{s.mode === 'voice' ? ' · voice' : ''}</div>
                      </td>
                      <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{fmtDate(s.started_at, true)}</td>
                      <td className="px-3 py-2.5 text-gray-600 tabular-nums">{fmtDuration(s.duration_s)}</td>
                      <td className="px-3 py-2.5"><Pill tone={st.tone}>{st.label}</Pill></td>
                      <td className={cn('px-5 py-2.5 text-right font-semibold tabular-nums', scoreTone(s.final_score === null ? null : Number(s.final_score)))}>{s.final_score === null ? '—' : Math.round(Number(s.final_score))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function ModeButton({ active, onClick, icon, label, disabled }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={active}
      className={cn('inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-40 disabled:cursor-not-allowed',
        active ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50')}>
      {icon} {label}
    </button>
  );
}
