'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useParams } from 'next/navigation';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import { CheckCircle2, Circle, ShieldAlert, ShieldCheck, Award, Ban, Wallet, Lock } from 'lucide-react';
import { tapi, useTraining, fmtDate, PHASE_LABELS } from '@/lib/training/client';
import { Panel, PhaseBadge, ProgressBar, Spinner, ErrorNote, Pill, Empty, Btn, Stat, scoreTone, inputCls } from '@/components/training/ui';
import { TrainerPage, TableWrap, th, td, fmtUsd, useConfirm, useToast, Modal, Field, Help, thisMonth } from '@/components/training/hr/kit';
import { cn } from '@/lib/utils';

const CERTS = [
  { code: 'PRODUCT_CERT', label: 'Product Certification', effect: 'Unlocks the Track 2 certification path.' },
  { code: 'LIVE_CALL_CERT', label: 'Live-Calling Certification', effect: 'Starts quota credit and moves the rep from Training into Ramp 50%. Revoking it stops quota credit and puts the rep back into Training.' },
  { code: 'BYTESCON_CERT', label: 'Bytescon Certification (optional)', effect: 'Lets the rep pitch the contract-management build.' },
];
const PHASES = ['TRAINING', 'SUPERVISED', 'RAMP_50', 'RAMP_75', 'FULL'];
const PHASE_PAY: Record<string, string> = {
  TRAINING: 'No quota; penalty-free (paid as 100% performance).',
  SUPERVISED: 'Trainer pause: penalty-free while you coach. Base pay unaffected.',
  RAMP_50: 'Half quota; penalty-free by default.',
  RAMP_75: 'Targets are 75% of the normal quota; missed-target deductions apply.',
  FULL: 'Normal quota and deductions.',
};

export default function RepDetailPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const confirm = useConfirm();
  const a = useTraining<any>(`/analytics/rep/${id}`);
  const ramp = useTraining<any>(`/ramp/${id}`);
  const certs = useTraining<any>(`/certifications?user_id=${id}`);
  const usage = useTraining<any>(`/ai/usage?month=${thisMonth()}`);
  const settings = useTraining<any>('/settings');
  const [busy, setBusy] = useState(false);
  const [phaseOpen, setPhaseOpen] = useState(false);
  const [phase, setPhase] = useState('RAMP_50');
  const [phaseReason, setPhaseReason] = useState('');
  const [capOpen, setCapOpen] = useState(false);
  const [cap, setCap] = useState('');

  const refresh = () => { a.mutate(); ramp.mutate(); certs.mutate(); usage.mutate(); };
  const d = a.data;
  const status = ramp.data?.status || d?.ramp;
  const history: any[] = ramp.data?.history || d?.ramp_history || [];
  const budget = (usage.data?.budgets || []).find((b: any) => String(b.user_id) === String(id));
  const defaultCap = settings.data?.ai_caps?.rep_monthly_usd;
  const spent = (d?.ai_usage || []).reduce((s: number, x: any) => s + Number(x.cost_usd || 0), 0);

  async function run(fn: () => Promise<any>, ok: string) {
    setBusy(true);
    try { await fn(); toast.show(ok); refresh(); } catch (e) { toast.error(e); } finally { setBusy(false); }
  }

  async function supervised(on: boolean) {
    const reason = await confirm.ask(on ? {
      title: `Set ${d?.rep?.name} to SUPERVISED?`,
      body: <><p>Supervised pauses quota penalties while you coach. Base pay is not affected; the rep is told their phase changed.</p><p>When you lift it, the rep returns to the phase they were in before.</p></>,
      reason: 'required', reasonLabel: 'Why are you supervising this rep?', confirmLabel: 'Set SUPERVISED', tone: 'primary',
    } : {
      title: 'Lift SUPERVISED?',
      body: <p>The rep goes back to {PHASE_LABELS[status?.phase_before_supervised] || 'their previous phase'} and normal pay rules for that phase apply from today.</p>,
      reason: true, confirmLabel: 'Lift SUPERVISED', tone: 'primary',
    });
    if (reason === null) return;
    run(() => tapi(`/ramp/${id}`, { body: { action: on ? 'supervised_on' : 'supervised_off', reason } }), on ? 'Rep set to SUPERVISED' : 'Supervision lifted');
  }

  async function savePhase() {
    setPhaseOpen(false);
    const ok = await confirm.ask({
      title: `Change phase to ${PHASE_LABELS[phase]}?`,
      body: <><p><strong>This affects pay.</strong> {PHASE_PAY[phase]}</p><p>The change applies from today and is recorded in the ramp history that payroll reads. Normally phases move automatically (certification → Ramp 50% → Ramp 75% → Full).</p></>,
      confirmLabel: 'Change phase',
    });
    if (ok === null) return;
    run(() => tapi(`/ramp/${id}`, { body: { action: 'set_phase', phase, reason: phaseReason } }), `Phase set to ${PHASE_LABELS[phase]}`);
    setPhaseReason('');
  }

  async function grant(code: string, label: string, effect: string) {
    const notes = await confirm.ask({ title: `Grant ${label}?`, body: <><p>Use this only when the rep met the bar outside the system (e.g. you observed live calls).</p><p>{effect}</p></>, reason: true, reasonLabel: 'Notes', confirmLabel: 'Grant', tone: 'primary' });
    if (notes === null) return;
    run(() => tapi(`/certifications/${code}/grant`, { body: { user_id: Number(id), notes } }), `${label} granted`);
  }
  async function revoke(code: string, label: string, effect: string) {
    const notes = await confirm.ask({ title: `Revoke ${label}?`, body: <><p>{effect}</p><p>The rep is notified with your reason.</p></>, reason: 'required', confirmLabel: 'Revoke' });
    if (notes === null) return;
    run(() => tapi(`/certifications/${code}/revoke`, { body: { user_id: Number(id), notes } }), `${label} revoked`);
  }
  async function saveCap() {
    const v = Number(cap);
    if (!(v >= 0)) return toast.show('Enter a dollar amount of 0 or more', 'error');
    setCapOpen(false);
    run(() => tapi('/ai/budgets', { body: { user_id: Number(id), cap_usd: v, hard_stop: budget?.hard_stop ?? true } }), `AI cap for this month set to ${fmtUsd(v)}`);
  }

  if (a.error) return <TrainerPage title="Rep" back={{ href: '/hr/training', label: 'Cohort' }}><ErrorNote error={a.error} /></TrainerPage>;
  if (!d) return <TrainerPage title="Rep" back={{ href: '/hr/training', label: 'Cohort' }}><Spinner /></TrainerPage>;

  const heldCerts: any[] = (certs.data?.certifications || []).filter((c: any) => !c.revoked_at);
  const f = d.funnel;
  const trend = [...(d.roleplay_trend || [])].reverse().map((t: any, i: number) => ({ i: i + 1, score: t.final_score, date: fmtDate(t.started_at), title: t.title, purpose: t.purpose }));

  return (
    <TrainerPage
      title={d.rep.name}
      back={{ href: '/hr/training', label: 'Cohort' }}
      subtitle={<>@{d.rep.username} · ext {d.rep.extension || '—'} · hired {fmtDate(d.rep.created_at)}{d.drill_streak ? ` · ${d.drill_streak}-day drill streak` : ''}</>}
      actions={status && <PhaseBadge phase={status.phase} className="text-sm px-3 py-1" />}
    >
      {toast.node}{confirm.node}
      <div className="space-y-6">
        {/* ramp + actions */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Panel title="Quota phase" className="lg:col-span-2">
            {status && (
              <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2"><PhaseBadge phase={status.phase} /><span className="text-sm text-gray-600">{Math.round(Number(status.quota_multiplier) * 100)}% quota · since {fmtDate(status.phase_started_at)}</span></div>
                  <p className="mt-1 text-sm text-gray-500">{PHASE_PAY[status.phase]}</p>
                  {status.grandfathered && <p className="mt-1 text-xs text-gray-400">Grandfathered: hired before the training module launched, so treated as certified.</p>}
                  {status.supervised_reason && <p className="mt-1 text-sm text-amber-700">Supervised because: {status.supervised_reason}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {status.phase === 'SUPERVISED'
                    ? <Btn size="sm" variant="success" disabled={busy} onClick={() => supervised(false)}><ShieldCheck className="h-4 w-4" /> Lift SUPERVISED</Btn>
                    : <Btn size="sm" variant="secondary" disabled={busy} onClick={() => supervised(true)}><ShieldAlert className="h-4 w-4" /> Set SUPERVISED</Btn>}
                  <Btn size="sm" variant="ghost" disabled={busy} onClick={() => { setPhase(status.phase === 'FULL' ? 'RAMP_75' : 'FULL'); setPhaseOpen(true); }}>Override phase…</Btn>
                </div>
              </div>
            )}
            <ol className="relative border-l-2 border-gray-100 ml-2 space-y-4">
              {[...history].reverse().map((h, i) => (
                <li key={h.id ?? i} className="ml-4">
                  <span className={cn('absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full border-2 border-white', h.ended_at ? 'bg-gray-300' : 'bg-primary-500')} />
                  <div className="flex flex-wrap items-center gap-2">
                    <PhaseBadge phase={h.phase} />
                    <span className="text-xs text-gray-500 tabular-nums">{Math.round(Number(h.quota_multiplier) * 100)}% quota</span>
                    <span className="text-xs text-gray-400">{fmtDate(h.started_at, true)} → {h.ended_at ? fmtDate(h.ended_at, true) : 'now'}</span>
                  </div>
                  {h.reason && <div className="text-xs text-gray-500 mt-0.5">{h.reason}</div>}
                </li>
              ))}
            </ol>
          </Panel>

          <div className="space-y-6">
            <Panel title="Certifications">
              <ul className="space-y-3">
                {CERTS.map((c) => {
                  const held = heldCerts.find((h) => h.code === c.code);
                  return (
                    <li key={c.code} className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-sm font-medium text-gray-800">
                          {held ? <Award className="h-4 w-4 text-emerald-500" /> : <Circle className="h-4 w-4 text-gray-300" />}{c.label}
                        </div>
                        <div className="text-xs text-gray-400 ml-5">{held ? `${held.method} · ${fmtDate(held.granted_at)}${held.notes ? ` · ${held.notes}` : ''}` : 'not held'}</div>
                      </div>
                      {held
                        ? <Btn size="sm" variant="ghost" disabled={busy} onClick={() => revoke(c.code, c.label, c.effect)} className="text-red-600"><Ban className="h-3.5 w-3.5" /> Revoke</Btn>
                        : <Btn size="sm" variant="secondary" disabled={busy} onClick={() => grant(c.code, c.label, c.effect)}>Grant</Btn>}
                    </li>
                  );
                })}
              </ul>
            </Panel>
            <Panel title="AI budget this month">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <div className="text-2xl font-bold tabular-nums">{fmtUsd(budget?.spent_usd ?? spent)}</div>
                  <div className="text-xs text-gray-500">of {fmtUsd(budget?.cap_usd ?? defaultCap)} {budget ? '' : '(default cap)'}{budget && !budget.hard_stop ? ' · soft cap' : ''}</div>
                </div>
                <Btn size="sm" variant="secondary" onClick={() => { setCap(String(budget?.cap_usd ?? defaultCap ?? '')); setCapOpen(true); }}><Wallet className="h-4 w-4" /> Change cap</Btn>
              </div>
              <ProgressBar className="mt-3" value={(Number(budget?.spent_usd ?? spent) / Number(budget?.cap_usd ?? defaultCap ?? 1)) * 100} />
              {d.ai_usage?.length > 0 && (
                <ul className="mt-3 space-y-1 text-xs text-gray-600">
                  {d.ai_usage.map((u: any) => <li key={u.feature} className="flex justify-between"><span>{u.feature} · {u.calls} calls</span><span className="tabular-nums">{fmtUsd(u.cost_usd, 3)}</span></li>)}
                </ul>
              )}
            </Panel>
          </div>
        </div>

        {/* funnel */}
        <Panel title={`Live-call funnel · last ${f.days} days`}>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            <Stat label="Dials" value={f.dials} />
            <Stat label="Connects" value={f.connects} hint="calls ≥50 s" />
            <Stat label="Conversations" value={f.conversations} />
            <Stat label="Meetings booked" value={f.meetings_booked} />
            <Stat label="Meetings held" value={f.meetings_held} />
            <Stat label="Connect rate" value={f.connect_rate === null ? '—' : `${f.connect_rate}%`} />
            <Stat label="Show rate" value={f.show_rate === null ? '—' : `${f.show_rate}%`} />
          </div>
          <p className="mt-3 text-xs text-gray-500">
            Live scorecard (4 weeks): <strong className={scoreTone(d.live_scorecard.avg)}>{d.live_scorecard.avg ?? '—'}</strong>
            {' '}({d.live_scorecard.source === 'qa' ? 'QA score × 10 fallback' : '100-point scorecard'}, n={d.live_scorecard.n}).
            {d.ai_vs_human.n > 0 && <> AI vs your grades: {d.ai_vs_human.avg_gap} points apart on average over {d.ai_vs_human.n} items.</>}
          </p>
        </Panel>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* path */}
          <Panel title="Path progress">
            <div className="space-y-5">
              {(d.tracks || []).filter((t: any) => !t.is_placeholder).map((t: any) => (
                <div key={t.id}>
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-semibold text-gray-800">{t.code} · {t.title}</span>
                    <span className="tabular-nums text-gray-500">{t.progress_pct}%</span>
                  </div>
                  <ProgressBar value={t.progress_pct} tone={t.completed ? 'green' : 'primary'} className="mt-1" />
                  <ul className="mt-2 space-y-1">
                    {t.courses.map((c: any) => (
                      <li key={c.id} className="flex items-center justify-between gap-2 text-xs">
                        <span className="flex items-center gap-1.5 text-gray-700 min-w-0">
                          {c.completed ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" /> : c.unlocked ? <Circle className="h-3.5 w-3.5 text-primary-400 shrink-0" /> : <Lock className="h-3.5 w-3.5 text-gray-300 shrink-0" />}
                          <span className="truncate">{c.code} {c.title}{!c.required && <span className="text-gray-400"> (optional)</span>}</span>
                        </span>
                        <span className="tabular-nums text-gray-400 shrink-0">{c.lessons.filter((l: any) => l.completed).length}/{c.lessons.length} · {c.progress_pct}%</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Panel>

          {/* requirements */}
          <Panel title="Certification checklists">
            {!certs.data ? <Spinner /> : (
              <div className="space-y-4">
                {certs.data.requirements.map((r: any) => (
                  <div key={r.code}>
                    <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                      {r.code.replace(/_/g, ' ')} {r.earned ? <Pill tone="green">earned</Pill> : r.met ? <Pill tone="blue">requirements met</Pill> : <Pill>in progress</Pill>}
                    </div>
                    <ul className="mt-1.5 space-y-1">
                      {r.items.map((it: any, i: number) => (
                        <li key={i} className="flex items-start gap-1.5 text-xs">
                          {it.met ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" /> : <Circle className="h-3.5 w-3.5 text-gray-300 mt-0.5 shrink-0" />}
                          <span className="text-gray-700">{it.label} <span className="text-gray-400">— {it.detail}</span></span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Panel title="Roleplay scores over time">
            {trend.length === 0 ? <Empty title="No scored roleplays yet" /> : (
              <>
                <div className="h-56" role="img" aria-label={`Roleplay scores, ${trend.length} sessions, latest ${trend[trend.length - 1].score}`}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trend} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                      <CartesianGrid stroke="#f1f5f9" vertical={false} />
                      <XAxis dataKey="i" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
                      <YAxis domain={[0, 100]} ticks={[0, 40, 70, 100]} tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                      <ReferenceLine y={70} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: 'pass 70', position: 'insideTopRight', fontSize: 10, fill: '#64748b' }} />
                      <Tooltip
                        contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }}
                        labelFormatter={(_, p: any) => p?.[0]?.payload ? `${p[0].payload.date} · ${p[0].payload.purpose}` : ''}
                        formatter={(v: any, _n: any, p: any) => [`${v}/100`, p?.payload?.title || 'Score']}
                      />
                      <Line isAnimationActive={false} type="monotone" dataKey="score" stroke="#0284c7" strokeWidth={2} dot={{ r: 4, fill: '#0284c7', stroke: '#fff', strokeWidth: 2 }} activeDot={{ r: 6 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-xs text-gray-400">Sessions in order (oldest left). Dashed line = 70, the certification pass mark.</p>
              </>
            )}
          </Panel>
          <Panel title="Criteria averages (8 weeks)">
            {(d.criteria || []).length === 0 ? <Empty title="No scorecards yet" /> : (
              <ul className="space-y-2">
                {d.criteria.map((c: any) => (
                  <li key={c.id}>
                    <div className="flex justify-between text-sm"><span className="text-gray-800">{c.criterion}</span><span className="tabular-nums text-xs text-gray-500">{c.avg_points}/{c.max_points} · {c.pct}%</span></div>
                    <div className="mt-1 h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={cn('h-full rounded-full', (c.pct ?? 0) < 60 ? 'bg-amber-500' : 'bg-primary-500')} style={{ width: `${c.pct ?? 0}%` }} /></div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Panel title="Roleplays">
            {(d.roleplay_trend || []).length === 0 ? <Empty title="None yet" /> : (
              <TableWrap>
                <thead className="bg-gray-50"><tr><th className={th}>When</th><th className={th}>Scenario</th><th className={th}>Type</th><th className={cn(th, 'text-right')}>Score</th><th className={th}>Review</th></tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {d.roleplay_trend.map((r: any) => (
                    <tr key={r.id}>
                      <td className={cn(td, 'whitespace-nowrap')}>{fmtDate(r.started_at)}</td>
                      <td className={cn(td, 'min-w-[180px]')}><Link className="line-clamp-2 text-gray-800 hover:text-primary-700 hover:underline" title={r.title} href={`/hr/training/reviews/roleplay/${r.id}`}>{r.title || `Roleplay #${r.id}`}</Link></td>
                      <td className={td}><Pill tone={r.purpose === 'exam' ? 'violet' : 'gray'}>{r.purpose}</Pill>{r.engine === 'script' && <span className="ml-1 text-xs text-gray-400">scripted</span>}</td>
                      <td className={cn(td, 'text-right font-semibold tabular-nums', scoreTone(r.final_score))}>{r.final_score}</td>
                      <td className={cn(td, 'whitespace-nowrap')}>{r.human_reviewed ? <Pill tone="green">reviewed</Pill> : r.status === 'needs_review' ? <Pill tone="amber">waiting</Pill> : <span className="text-xs text-gray-400">AI only</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </Panel>
          <Panel title="Graded calls">
            {(d.call_reviews || []).length === 0 ? <Empty title="No graded calls yet" /> : (
              <TableWrap>
                <thead className="bg-gray-50"><tr><th className={th}>When</th><th className={th}>Source</th><th className={th}>Status</th><th className={cn(th, 'text-right')}>Score</th><th className={th}></th></tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {d.call_reviews.map((c: any) => (
                    <tr key={c.id}>
                      <td className={cn(td, 'whitespace-nowrap')}>{fmtDate(c.created_at)}</td>
                      <td className={td}>{c.source === 'qa_transcript' ? 'QA recording' : 'Upload'}</td>
                      <td className={td}><Pill tone={c.status === 'reviewed' ? 'green' : c.status === 'needs_review' ? 'amber' : c.status === 'failed' ? 'red' : 'gray'}>{c.status.replace('_', ' ')}</Pill></td>
                      <td className={cn(td, 'text-right font-semibold tabular-nums', scoreTone(c.final_score))}>{c.final_score ?? '—'}</td>
                      <td className={cn(td, 'text-right')}><Link className="text-primary-600 hover:underline" href={`/hr/training/reviews/call/${c.id}`}>Open</Link></td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </Panel>
        </div>

        <Panel title="Quiz, exam and drill attempts">
          {(d.attempts || []).length === 0 ? <Empty title="No finished attempts yet" /> : (
            <TableWrap>
              <thead className="bg-gray-50"><tr><th className={th}>Finished</th><th className={th}>Lesson</th><th className={th}>Type</th><th className={cn(th, 'text-right')}>Score</th><th className={th}>Result</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {d.attempts.map((t: any) => (
                  <tr key={t.id}>
                    <td className={cn(td, 'whitespace-nowrap')}>{fmtDate(t.finished_at, true)}</td>
                    <td className={td}><span className="text-gray-400 mr-1">{t.code}</span>{t.title}</td>
                    <td className={td}>{t.type}</td>
                    <td className={cn(td, 'text-right tabular-nums')}>{Math.round(t.score_pct)}%</td>
                    <td className={td}>{t.passed ? <Pill tone="green">passed</Pill> : <Pill tone="red">not passed</Pill>}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Panel>
      </div>

      <Modal open={phaseOpen} onClose={() => setPhaseOpen(false)} title="Manual phase override"
        footer={<><Btn variant="secondary" onClick={() => setPhaseOpen(false)}>Cancel</Btn><Btn variant="danger" onClick={savePhase} disabled={!phaseReason.trim()}>Continue</Btn></>}>
        <Help className="mb-4">Phases normally move by themselves: Training → (Live-Calling Certification) → Ramp 50% → Ramp 75% → Full, on the schedule in Settings. Override only for exceptions. <strong>This changes how payroll treats the rep from today.</strong></Help>
        <Field label="New phase">
          <select className={inputCls} value={phase} onChange={(e) => setPhase(e.target.value)}>
            {PHASES.map((p) => <option key={p} value={p}>{PHASE_LABELS[p]}</option>)}
          </select>
        </Field>
        <p className="mt-2 text-xs text-gray-500">{PHASE_PAY[phase]}</p>
        <Field label="Reason (required)" className="mt-4">
          <textarea rows={3} className={inputCls} value={phaseReason} onChange={(e) => setPhaseReason(e.target.value)} />
        </Field>
      </Modal>

      <Modal open={capOpen} onClose={() => setCapOpen(false)} title="AI spending cap for this month"
        footer={<><Btn variant="secondary" onClick={() => setCapOpen(false)}>Cancel</Btn><Btn onClick={saveCap}>Save cap</Btn></>}>
        <Field label="Monthly cap (USD)" help={`Default for every rep is ${fmtUsd(defaultCap)}. When the cap is reached the rep's AI features switch to standard mode until next month (or until you raise it).`}>
          <input type="number" min={0} step="0.5" className={inputCls} value={cap} onChange={(e) => setCap(e.target.value)} />
        </Field>
      </Modal>
    </TrainerPage>
  );
}
