'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, AlertTriangle, Save } from 'lucide-react';
import { tapi, useTraining, fmtDate } from '@/lib/training/client';
import { Panel, Spinner, ErrorNote, Empty, Btn, Pill, Stat, ProgressBar, inputCls } from '@/components/training/ui';
import { TrainerPage, TableWrap, th, td, fmtUsd, fmtNum, thisMonth, Toggle, Help, useConfirm, useToast } from '@/components/training/hr/kit';
import { cn } from '@/lib/utils';

const FEATURE_LABEL: Record<string, string> = {
  default: 'Default (everything not listed)', transcribe: 'Transcription', transcribe_after_2027_02_26: 'Transcription (after 26 Feb 2027)',
  voice: 'Voice roleplay', roleplay: 'Roleplay prospect', grading: 'Scorecard grading', drill: 'Drill grading', email: 'Follow-up emails',
  pitch: 'Live Assist talking points', digest: 'Coach digest', generate: 'Content generation', site_scan: 'Website scan summary', quiz_grade: 'Short-answer grading',
};
const REASON: Record<string, string> = {
  no_key: 'No OpenAI key is configured on the server (OPENAI_API_KEY).',
  disabled: 'AI is switched off in Settings.',
  cap_reached: 'A monthly AI budget (organisation or personal) is used up — raise it below.',
  api_error: 'The AI service returned errors recently.',
};

function BudgetRow({ row, month, onSaved, toast }: { row: any; month: string; onSaved: () => void; toast: ReturnType<typeof useToast> }) {
  const [cap, setCap] = useState(String(row.cap_usd ?? ''));
  const [hard, setHard] = useState<boolean>(row.hard_stop ?? true);
  useEffect(() => { setCap(String(row.cap_usd ?? '')); setHard(row.hard_stop ?? true); }, [row.cap_usd, row.hard_stop]);
  const dirty = cap !== String(row.cap_usd ?? '') || hard !== (row.hard_stop ?? true);
  const pct = Number(row.cap_usd) ? (Number(row.spent_usd || 0) / Number(row.cap_usd)) * 100 : 0;
  async function save() {
    const v = Number(cap);
    if (!(v >= 0) || cap === '') return toast.show('Enter a cap of 0 or more', 'error');
    try { await tapi('/ai/budgets', { body: { user_id: Number(row.user_id), cap_usd: v, hard_stop: hard, month } }); toast.show(`Cap for ${row.name} set to ${fmtUsd(v)}`); onSaved(); } catch (e) { toast.error(e); }
  }
  return (
    <tr className={cn(Number(row.user_id) === 0 && 'bg-primary-50/40')}>
      <td className={cn(td, 'font-medium text-gray-900 whitespace-nowrap')}>{row.name}{row.isDefault && <span className="ml-1 text-xs font-normal text-gray-400">(default cap)</span>}</td>
      <td className={cn(td, 'text-right tabular-nums')}>{fmtUsd(row.spent_usd || 0)}</td>
      <td className={cn(td, 'min-w-[110px]')}><ProgressBar value={pct} /><div className={cn('mt-0.5 text-xs tabular-nums', pct >= 100 ? 'text-red-600' : pct >= 80 ? 'text-amber-600' : 'text-gray-400')}>{Math.round(pct)}%{row.warned_at ? ' · warned' : ''}</div></td>
      <td className={td}>
        <div className="flex items-center gap-1"><span className="text-gray-400">$</span>
          <input type="number" min={0} step="0.5" aria-label={`Cap for ${row.name}`} className={cn(inputCls, 'w-24 py-1 tabular-nums')} value={cap} onChange={(e) => setCap(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save(); }} />
        </div>
      </td>
      <td className={td}><Toggle checked={hard} onChange={setHard} label={<span className="text-xs">{hard ? 'Hard stop' : 'Warn only'}</span>} /></td>
      <td className={cn(td, 'text-right')}><Btn size="sm" variant={dirty ? 'primary' : 'secondary'} disabled={!dirty} onClick={save}>Save</Btn></td>
    </tr>
  );
}

export default function AiUsagePage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [month, setMonth] = useState(thisMonth());
  const { data, error, mutate } = useTraining<any>(`/ai/usage?month=${month}`);
  const users = useTraining<any[]>('/users?role=rep');
  const [models, setModels] = useState<Record<string, string>>({});
  const [newFeature, setNewFeature] = useState('');
  useEffect(() => { if (data?.models) setModels({ ...data.models }); }, [data?.models]);
  const modelsDirty = data && JSON.stringify(models) !== JSON.stringify(data.models);

  const totals = useMemo(() => {
    const f = data?.by_feature || [];
    return { cost: f.reduce((s: number, x: any) => s + Number(x.cost_usd || 0), 0), calls: f.reduce((s: number, x: any) => s + Number(x.calls || 0), 0) };
  }, [data]);

  const budgetRows = useMemo(() => {
    if (!data) return [];
    const rows = [...(data.budgets || [])];
    const has = (id: number) => rows.some((r) => Number(r.user_id) === id);
    if (!has(0)) rows.unshift({ user_id: 0, name: 'Organisation (all AI use)', cap_usd: data.caps?.org_monthly_usd, spent_usd: totals.cost, hard_stop: true, isDefault: true });
    for (const u of users.data || []) {
      if (!has(Number(u.id))) {
        const spent = (data.by_user || []).find((x: any) => String(x.user_id) === String(u.id))?.cost_usd || 0;
        rows.push({ user_id: Number(u.id), name: u.full_name, cap_usd: data.caps?.rep_monthly_usd, spent_usd: spent, hard_stop: true, isDefault: true });
      }
    }
    return rows.map((r) => (Number(r.user_id) === 0 ? { ...r, name: 'Organisation (all AI use)' } : r)).sort((a, b) => Number(a.user_id) - Number(b.user_id));
  }, [data, users.data, totals.cost]);

  async function saveModels() {
    const priceList = new Map((data.model_prices || []).map((m: any) => [m.model, m]));
    const risky = Object.entries(models).filter(([, m]) => (priceList.get(m) as any)?.status && (priceList.get(m) as any).status !== 'current');
    const ok = await confirm.ask({
      title: 'Save model settings?',
      body: <><p>New AI calls use these models immediately.</p>{risky.length > 0 && <p className="text-amber-700">Deprecated / shut-down models selected: {risky.map(([f, m]) => `${f} → ${m}`).join(', ')}. Calls may fail after the shutdown date.</p>}</>,
      confirmLabel: 'Save', tone: 'primary',
    });
    if (ok === null) return;
    try { await tapi('/settings', { method: 'PUT', body: { ai_models: models } }); toast.show('Model settings saved'); mutate(); } catch (e) { toast.error(e); }
  }

  const st = data?.status;
  const modelNames: string[] = (data?.model_prices || []).map((m: any) => m.model);

  return (
    <TrainerPage title="AI usage & cost" subtitle="What the AI features cost, who is using them, budgets, and which model each feature uses."
      actions={<label className="flex items-center gap-2 text-sm text-gray-600">Month <input type="month" className={cn(inputCls, 'w-auto py-1.5')} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></label>}>
      {toast.node}{confirm.node}
      <ErrorNote error={error} />
      {!data ? <Spinner /> : (
        <div className="space-y-6">
          <div className={cn('flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm', st?.available ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-900')}>
            {st?.available ? <CheckCircle2 className="h-5 w-5 shrink-0" /> : <AlertTriangle className="h-5 w-5 shrink-0" />}
            <div>
              <strong>{st?.available ? 'AI is available.' : 'AI is unavailable — the module runs in standard mode.'}</strong>
              {!st?.available && <span> {REASON[st?.reason] || st?.message}</span>}
              <div className="mt-1 text-xs opacity-80">
                API key {data.key_configured ? 'configured' : 'not configured'} · AI features {data.ai_enabled ? 'on' : 'off'} · voice roleplay {data.voice_enabled ? 'on' : 'off'} ·{' '}
                <Link href="/hr/training/settings" className="underline">change in Settings</Link>.
                {' '}Standard mode: scripted roleplays, keyword grading and template text — reps can still finish training.
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Spend this month" value={fmtUsd(totals.cost)} hint={`of ${fmtUsd(data.caps?.org_monthly_usd)} organisation cap`} />
            <Stat label="AI calls" value={fmtNum(totals.calls)} />
            <Stat label="Default rep cap" value={fmtUsd(data.caps?.rep_monthly_usd)} hint={`${fmtUsd(data.caps?.rep_monthly_usd_with_voice)} with voice`} />
            <Stat label="Errors" value={(data.recent_errors || []).length} tone={(data.recent_errors || []).length ? 'text-red-600' : undefined} hint="this month (last 20)" />
          </div>

          <Panel title="Cost by feature and model">
            {(data.by_feature || []).length === 0 ? <Empty title="No AI calls this month" body={st?.available ? undefined : 'Expected while AI is unavailable.'} /> : (
              <TableWrap>
                <thead className="bg-gray-50"><tr>
                  <th className={th}>Feature</th><th className={th}>Model</th><th className={cn(th, 'text-right')}>Calls</th><th className={cn(th, 'text-right')}>Tokens in</th>
                  <th className={cn(th, 'text-right')}>Cached</th><th className={cn(th, 'text-right')}>Tokens out</th><th className={cn(th, 'text-right')}>Audio (s)</th>
                  <th className={cn(th, 'text-right')}>Cost</th><th className={cn(th, 'text-right')}>Avg latency</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {data.by_feature.map((r: any, i: number) => (
                    <tr key={i}>
                      <td className={td}>{FEATURE_LABEL[r.feature] || r.feature}</td><td className={cn(td, 'font-mono text-xs')}>{r.model}</td>
                      <td className={cn(td, 'text-right tabular-nums')}>{fmtNum(r.calls)}</td><td className={cn(td, 'text-right tabular-nums')}>{fmtNum(r.input_tokens)}</td>
                      <td className={cn(td, 'text-right tabular-nums')}>{fmtNum(r.cached_tokens)}</td><td className={cn(td, 'text-right tabular-nums')}>{fmtNum(r.output_tokens)}</td>
                      <td className={cn(td, 'text-right tabular-nums')}>{fmtNum(r.audio_seconds)}</td><td className={cn(td, 'text-right tabular-nums font-medium')}>{fmtUsd(r.cost_usd, 3)}</td>
                      <td className={cn(td, 'text-right tabular-nums')}>{r.avg_latency_ms ? `${(Number(r.avg_latency_ms) / 1000).toFixed(1)} s` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </Panel>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
            <Panel title="Spend by person">
              {(data.by_user || []).length === 0 ? <Empty title="No spend yet" /> : (
                <TableWrap>
                  <thead className="bg-gray-50"><tr><th className={th}>Who</th><th className={cn(th, 'text-right')}>Calls</th><th className={cn(th, 'text-right')}>Cost</th></tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.by_user.map((u: any, i: number) => (
                      <tr key={i}><td className={td}>{u.user_id ? <Link className="hover:underline" href={`/hr/training/rep/${u.user_id}`}>{u.name}</Link> : u.name}</td><td className={cn(td, 'text-right tabular-nums')}>{fmtNum(u.calls)}</td><td className={cn(td, 'text-right tabular-nums')}>{fmtUsd(u.cost_usd, 3)}</td></tr>
                    ))}
                  </tbody>
                </TableWrap>
              )}
            </Panel>
            <Panel title={`Budgets for ${month}`}>
              <p className="-mt-1 mb-3 text-xs text-gray-500"><strong>Hard stop</strong>: when the cap is reached that person’s AI features switch to standard mode. <strong>Warn only</strong>: trainers are notified but AI keeps working. The organisation cap covers everyone together.</p>
              <TableWrap>
                <thead className="bg-gray-50"><tr><th className={th}>Who</th><th className={cn(th, 'text-right')}>Spent</th><th className={th}>Used</th><th className={th}>Cap (USD)</th><th className={th}>At cap</th><th className={th}></th></tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {budgetRows.map((r) => <BudgetRow key={`${r.user_id}-${month}`} row={r} month={month} toast={toast} onSaved={() => mutate()} />)}
                </tbody>
              </TableWrap>
            </Panel>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Panel title="Model per feature" action={<Btn size="sm" disabled={!modelsDirty} onClick={saveModels}><Save className="h-4 w-4" /> Save</Btn>}>
              <p className="-mt-1 mb-3 text-xs text-gray-500">Which OpenAI model each feature uses. Features not listed use “Default”. Prefer models marked current.</p>
              <datalist id="model-names">{modelNames.map((m) => <option key={m} value={m} />)}</datalist>
              <div className="space-y-2">
                {Object.entries(models).map(([feature, model]) => {
                  const price = (data.model_prices || []).find((m: any) => m.model === model);
                  return (
                    <div key={feature} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2">
                      <label htmlFor={`m-${feature}`} className="truncate text-sm text-gray-700" title={feature}>{FEATURE_LABEL[feature] || feature}</label>
                      <input id={`m-${feature}`} list="model-names" className={cn(inputCls, 'py-1.5 font-mono text-xs', price && price.status !== 'current' && 'border-amber-400 bg-amber-50')} value={model} onChange={(e) => setModels({ ...models, [feature]: e.target.value })} />
                      {feature !== 'default' ? <button className="px-1 text-xs text-gray-400 hover:text-red-600" onClick={() => { const m = { ...models }; delete m[feature]; setModels(m); }} aria-label={`Remove ${feature}`}>✕</button> : <span className="w-4" />}
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex gap-2">
                <select aria-label="Add a feature" className={cn(inputCls, 'w-auto py-1.5')} value={newFeature} onChange={(e) => setNewFeature(e.target.value)}>
                  <option value="">Add a feature override…</option>
                  {Object.keys(FEATURE_LABEL).filter((f) => !(f in models)).map((f) => <option key={f} value={f}>{FEATURE_LABEL[f]}</option>)}
                </select>
                <Btn size="sm" variant="secondary" disabled={!newFeature} onClick={() => { setModels({ ...models, [newFeature]: models.default || '' }); setNewFeature(''); }}>Add</Btn>
              </div>
            </Panel>
            <Panel title="Model price list (USD)">
              <TableWrap>
                <thead className="bg-gray-50"><tr><th className={th}>Model</th><th className={th}>Status</th><th className={cn(th, 'text-right')}>In / 1M</th><th className={cn(th, 'text-right')}>Cached / 1M</th><th className={cn(th, 'text-right')}>Out / 1M</th><th className={cn(th, 'text-right')}>Per min</th></tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {(data.model_prices || []).map((m: any) => {
                    const soon = m.shutdown_date && new Date(m.shutdown_date).getTime() - Date.now() < 90 * 86_400_000;
                    return (
                      <tr key={m.model} className={cn(m.status === 'shutdown' && 'bg-red-50/60', m.status === 'deprecated' && 'bg-amber-50/50')}>
                        <td className={td}><span className="font-mono text-xs">{m.model}</span>{m.notes && <div className="text-xs text-gray-400">{m.notes}</div>}</td>
                        <td className={td}>
                          <Pill tone={m.status === 'current' ? 'green' : m.status === 'shutdown' ? 'red' : 'amber'}>{m.status}</Pill>
                          {m.shutdown_date && <div className={cn('mt-0.5 text-xs whitespace-nowrap', soon ? 'font-semibold text-red-600' : 'text-gray-500')}>{m.status === 'shutdown' ? 'shut down' : 'shuts down'} {fmtDate(m.shutdown_date)}</div>}
                        </td>
                        <td className={cn(td, 'text-right tabular-nums')}>{Number(m.input_per_1m) ? fmtUsd(m.input_per_1m) : Number(m.audio_input_per_1m) ? `${fmtUsd(m.audio_input_per_1m)} audio` : '—'}</td>
                        <td className={cn(td, 'text-right tabular-nums')}>{Number(m.cached_per_1m) ? fmtUsd(m.cached_per_1m, 3) : '—'}</td>
                        <td className={cn(td, 'text-right tabular-nums')}>{Number(m.output_per_1m) ? fmtUsd(m.output_per_1m) : '—'}</td>
                        <td className={cn(td, 'text-right tabular-nums')}>{Number(m.per_minute) ? fmtUsd(m.per_minute, 4) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </TableWrap>
            </Panel>
          </div>

          <Panel title="Recent errors">
            {(data.recent_errors || []).length === 0 ? <Empty title="No errors this month" /> : (
              <ul className="space-y-2">
                {data.recent_errors.map((e: any, i: number) => (
                  <li key={i} className="rounded-lg border border-red-100 bg-red-50/50 px-3 py-2 text-xs">
                    <span className="text-gray-500">{fmtDate(e.created_at, true)} · {FEATURE_LABEL[e.feature] || e.feature} · <span className="font-mono">{e.model}</span></span>
                    <div className="mt-0.5 text-red-700 break-words">{e.error}</div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Help>Costs are estimated from the price list and token counts the API reports. Caps reset each calendar month.</Help>
        </div>
      )}
    </TrainerPage>
  );
}
