'use client';

import { ReactNode, useEffect, useMemo, useState } from 'react';
import { Save, Trash2, Copy, Webhook, KeyRound } from 'lucide-react';
import { tapi, useTraining, fmtDate, PHASE_LABELS } from '@/lib/training/client';
import { Panel, Spinner, ErrorNote, Empty, Btn, Pill, inputCls } from '@/components/training/ui';
import { TrainerPage, Field, Toggle, Modal, JsonEditor, parseJson, PayNote, Help, TableWrap, th, td, useConfirm, useToast, ago } from '@/components/training/hr/kit';
import { cn } from '@/lib/utils';

const EVENT_TYPES = [
  { id: 'training.certified', label: 'A rep earns a certification' },
  { id: 'training.ramp_phase_changed', label: 'A rep’s quota phase changes' },
  { id: 'training.supervised_flag', label: 'A trainer sets SUPERVISED' },
  { id: 'training.track_completed', label: 'A rep completes a track' },
];
const PAY_KEYS: Record<string, string> = {
  gate_enabled: 'new reps’ training gate and ramp',
  ramp_schedule: 'how long each ramp phase lasts and its quota share',
  penalty_free_phases: 'which phases are paid as 100% performance',
  training_completion_bonus: 'the completion bonus',
};

function Section({ title, children, pay }: { title: string; children: ReactNode; pay?: boolean }) {
  return (
    <Panel title={<span className="flex items-center gap-2">{title}{pay && <Pill tone="amber">affects pay</Pill>}</span>}>
      <div className="space-y-5">{children}</div>
    </Panel>
  );
}

function Num({ label, help, value, onChange, suffix, min = 0, step = 1 }: { label: string; help?: ReactNode; value: any; onChange: (n: number) => void; suffix?: string; min?: number; step?: number }) {
  return (
    <Field label={label} help={help}>
      <div className="flex items-center gap-2">
        <input type="number" min={min} step={step} className={cn(inputCls, 'w-32 tabular-nums')} value={typeof value === 'number' && Number.isFinite(value) ? value : ''} onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))} />
        {suffix && <span className="text-sm text-gray-500">{suffix}</span>}
      </div>
    </Field>
  );
}

export default function SettingsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const { data, error, mutate } = useTraining<any>('/settings');
  const [s, setS] = useState<any>(null);
  const [kpiText, setKpiText] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) { setS(JSON.parse(JSON.stringify(data))); setKpiText(JSON.stringify(data.kpi_targets || [], null, 2)); } }, [data]);

  const changed = useMemo(() => {
    if (!data || !s) return [] as string[];
    const kpi = parseJson(kpiText);
    const keys = Object.keys(data).filter((k) => k !== 'launched_at' && k !== 'ai_models' && k !== 'kpi_targets' && JSON.stringify(s[k]) !== JSON.stringify(data[k]));
    if (kpi.ok && JSON.stringify(kpi.value) !== JSON.stringify(data.kpi_targets)) keys.push('kpi_targets');
    return keys;
  }, [data, s, kpiText]);

  async function save() {
    const kpi = parseJson(kpiText);
    if (!kpi.ok || !Array.isArray(kpi.value)) return toast.show('KPI targets must be a JSON list', 'error');
    const body: Record<string, any> = {};
    for (const k of changed) body[k] = k === 'kpi_targets' ? kpi.value : s[k];
    for (const [k, v] of Object.entries(body)) if (typeof v === 'number' && !Number.isFinite(v)) return toast.show(`${k.replace(/_/g, ' ')} needs a number`, 'error');
    const pay = changed.filter((k) => PAY_KEYS[k]);
    const ok = await confirm.ask({
      title: `Save ${changed.length} change${changed.length === 1 ? '' : 's'}?`,
      body: <>
        <ul className="list-disc pl-5">{changed.map((k) => <li key={k}><code>{k}</code></li>)}</ul>
        {pay.length > 0 && <p className="text-amber-700"><strong>This affects pay:</strong> {pay.map((k) => PAY_KEYS[k]).join('; ')}. Payroll applies the rules from today; past days keep the phase they had.</p>}
      </>,
      confirmLabel: 'Save settings', tone: pay.length ? 'danger' : 'primary',
    });
    if (ok === null) return;
    setBusy(true);
    try { await tapi('/settings', { method: 'PUT', body }); toast.show('Settings saved'); await mutate(); } catch (e) { toast.error(e); } finally { setBusy(false); }
  }

  const set = (k: string, v: any) => setS({ ...s, [k]: v });
  const setIn = (k: string, sub: string, v: any) => setS({ ...s, [k]: { ...s[k], [sub]: v } });

  return (
    <TrainerPage title="Training settings" subtitle="How onboarding, certification, the quota ramp and AI behave. Changes apply immediately."
      actions={<Btn onClick={save} disabled={busy || !changed.length}><Save className="h-4 w-4" /> {changed.length ? `Save ${changed.length} change${changed.length === 1 ? '' : 's'}` : 'Saved'}</Btn>}>
      {toast.node}{confirm.node}
      <ErrorNote error={error} />
      {!s ? <Spinner /> : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Section title="Onboarding & certification" pay>
              <Toggle checked={s.gate_enabled} onChange={(v) => set('gate_enabled', v)} label="Training gate is on"
                help="New reps start in Training and must earn the Live-Calling Certification before their calls count toward quota. Switching this off treats new reps like veterans (full quota from day one)." />
              <Toggle checked={s.block_dialer_until_certified} onChange={(v) => set('block_dialer_until_certified', v)} label="Block the dialer until certified"
                help="Reps without the Live-Calling Certification can’t open the dialer. Only applies while the training gate is on." />
              <Num label="Onboarding length" suffix="days" value={s.onboarding_days} onChange={(n) => set('onboarding_days', n)} help="Shown to reps as their plan (Day 1 product, Days 2–3 sales coaching + certification)." />
              <Num label="Quiz retry wait" suffix="minutes" value={s.quiz_cooldown_minutes} onChange={(n) => set('quiz_cooldown_minutes', n)} help="After failing a quiz or exam, how long before the rep may try again. 0 = no wait." />
              <Num label="Suggest SUPERVISED below" suffix="/ 100" value={s.supervised_threshold} onChange={(n) => set('supervised_threshold', n)}
                help="If a certified rep’s 4-week live-call scorecard average (3+ graded calls) drops below this, the cohort dashboard and a notification suggest setting SUPERVISED. It never changes the phase by itself." />
            </Section>

            <Section title="Quota ramp & pay" pay>
              <Help>
                After certification a rep moves <strong>Ramp 50% → Ramp 75% → Full</strong> on this schedule. In a <strong>penalty-free</strong> phase the rep is paid as if they hit 100% performance (no missed-target deductions). Other phases scale the daily targets by the quota share.
              </Help>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {(['RAMP_50', 'RAMP_75'] as const).map((p) => (
                  <div key={p} className="rounded-xl border border-gray-200 p-3">
                    <div className="mb-2 text-sm font-semibold text-gray-800">{PHASE_LABELS[p]}</div>
                    <Num label="Lasts" suffix="days" value={s.ramp_schedule?.[p]?.days} onChange={(n) => setIn('ramp_schedule', p, { ...s.ramp_schedule[p], days: n })} />
                    <div className="mt-3"><Num label="Quota share" step={0.05} suffix={`= ${Math.round((s.ramp_schedule?.[p]?.multiplier || 0) * 100)}% of normal targets`} value={s.ramp_schedule?.[p]?.multiplier} onChange={(n) => setIn('ramp_schedule', p, { ...s.ramp_schedule[p], multiplier: n })} /></div>
                  </div>
                ))}
              </div>
              <fieldset>
                <legend className="text-sm font-medium text-gray-700">Penalty-free phases</legend>
                <p className="text-xs text-gray-500 mb-2">Ticked phases are paid as 100% performance. Full quota can’t be penalty-free.</p>
                <div className="flex flex-wrap gap-4">
                  {['TRAINING', 'SUPERVISED', 'RAMP_50', 'RAMP_75'].map((p) => (
                    <label key={p} className="flex items-center gap-2 text-sm text-gray-700">
                      <input type="checkbox" checked={(s.penalty_free_phases || []).includes(p)} onChange={(e) => set('penalty_free_phases', e.target.checked ? [...s.penalty_free_phases, p] : s.penalty_free_phases.filter((x: string) => x !== p))} />
                      {PHASE_LABELS[p]}
                    </label>
                  ))}
                </div>
                {!(s.penalty_free_phases || []).includes('TRAINING') && <PayNote>Reps in Training would be penalised for missing targets even though they have no quota yet.</PayNote>}
              </fieldset>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Num label="Training completion bonus" value={s.training_completion_bonus?.amount ?? ''} onChange={(n) => set('training_completion_bonus', { ...s.training_completion_bonus, amount: Number.isFinite(n) ? n : null })}
                  help="Optional one-time amount for finishing onboarding. Leave empty for none. Recorded for payroll; not paid automatically." />
                <Field label="Currency"><input className={cn(inputCls, 'w-28')} value={s.training_completion_bonus?.currency || ''} onChange={(e) => set('training_completion_bonus', { ...s.training_completion_bonus, currency: e.target.value })} /></Field>
              </div>
            </Section>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Section title="AI">
              <Toggle checked={s.ai_enabled} onChange={(v) => set('ai_enabled', v)} label="AI features on" help="Off = standard mode for everyone: scripted roleplays, keyword grading, template digests. Training still works." />
              <Toggle checked={s.voice_enabled} onChange={(v) => set('voice_enabled', v)} label="Voice roleplay" help="Lets reps practise by talking instead of typing. Costs more — see the voice cap below." />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Num label="Rep monthly cap" suffix="USD" step={0.5} value={s.ai_caps?.rep_monthly_usd} onChange={(n) => setIn('ai_caps', 'rep_monthly_usd', n)} help="Default per rep; raise individuals on the AI usage page." />
                <Num label="…with voice on" suffix="USD" step={0.5} value={s.ai_caps?.rep_monthly_usd_with_voice} onChange={(n) => setIn('ai_caps', 'rep_monthly_usd_with_voice', n)} />
                <Num label="Organisation monthly cap" suffix="USD" value={s.ai_caps?.org_monthly_usd} onChange={(n) => setIn('ai_caps', 'org_monthly_usd', n)} />
                <Num label="Warn trainers at" suffix="% of a cap" value={s.ai_caps?.warn_at_pct} onChange={(n) => setIn('ai_caps', 'warn_at_pct', n)} />
                <Num label="Voice minutes per rep per day" suffix="min" value={s.ai_caps?.voice_minutes_per_day} onChange={(n) => setIn('ai_caps', 'voice_minutes_per_day', n)} />
              </div>
              <p className="text-xs text-gray-500">Models per feature are set on the <a className="text-primary-600 underline" href="/hr/training/ai">AI usage</a> page.</p>
            </Section>
            <Section title="Recordings & targets">
              <Num label="Keep uploaded call audio for" suffix="days" value={s.audio_retention_days} onChange={(n) => set('audio_retention_days', n)} help="Uploaded recordings are deleted after this many days. Transcripts and scores are kept." />
              <JsonEditor label="Week-by-week KPI targets" value={kpiText} onChange={setKpiText} rows={10}
                validate={(v) => (Array.isArray(v) ? v.filter((r) => typeof r !== 'object' || !r.week).map((_, i) => `Row ${i + 1} needs a "week"`) : ['Must be a list of rows'])}
                help={<>Shown on the cohort dashboard. One row per period with: <code>week</code>, <code>phase</code>, <code>dials</code>, <code>conversations</code>, <code>meetings</code>, <code>show_rate</code>, <code>scorecard</code>. Coaching targets only — they don’t change pay.</>} />
            </Section>
          </div>

          <Integration />
        </div>
      )}
    </TrainerPage>
  );
}

// ------------------------------------------------------------------ integration

function Integration() {
  const toast = useToast();
  const confirm = useConfirm();
  const { data, error, mutate } = useTraining<any>('/integration/webhooks');
  const [url, setUrl] = useState('');
  const [types, setTypes] = useState<string[]>([]);
  const [secret, setSecret] = useState<{ url: string; secret: string } | null>(null);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  async function register() {
    try {
      const r = await tapi<any>('/integration/webhooks', { body: { url, event_types: types } });
      setSecret({ url: r.url, secret: r.secret }); setUrl(''); setTypes([]); mutate();
    } catch (e) { toast.error(e); }
  }
  async function toggle(h: any) {
    try { await tapi(`/integration/webhooks/${h.id}`, { method: 'PUT', body: { active: !h.active } }); mutate(); toast.show(h.active ? 'Webhook paused' : 'Webhook active'); } catch (e) { toast.error(e); }
  }
  async function remove(h: any) {
    const ok = await confirm.ask({ title: 'Delete this webhook?', body: <p>{h.url} will stop receiving events. Events stay in the log.</p>, confirmLabel: 'Delete' });
    if (ok === null) return;
    try { await tapi(`/integration/webhooks/${h.id}`, { method: 'DELETE' }); mutate(); toast.show('Webhook deleted'); } catch (e) { toast.error(e); }
  }
  const copy = (t: string) => { navigator.clipboard?.writeText(t).then(() => toast.show('Copied'), () => toast.show('Copy failed — select and copy manually', 'error')); };

  return (
    <Panel title={<span className="flex items-center gap-2"><Webhook className="h-4 w-4" /> Integration with the salary system</span>}>
      {toast.node}{confirm.node}
      <ErrorNote error={error} />
      <div className="space-y-6">
        <Help>
          The training module never edits payroll itself. Payroll in this app reads each rep’s phase history directly. An external salary system can either <strong>receive webhooks</strong> when something changes, or <strong>ask</strong> for a rep’s status (below).
        </Help>

        <div>
          <h3 className="text-sm font-semibold text-gray-800 mb-2">Webhooks</h3>
          {!data ? <Spinner /> : data.webhooks.length === 0 ? <p className="text-sm text-gray-400 mb-3">No webhooks registered.</p> : (
            <ul className="mb-4 space-y-2">
              {data.webhooks.map((h: any) => (
                <li key={h.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-xs text-gray-800">{h.url}</div>
                    <div className="text-xs text-gray-400">{h.event_types?.length ? h.event_types.join(', ') : 'all events'} · {h.signed ? 'signed' : 'unsigned'} · added {fmtDate(h.created_at)}</div>
                  </div>
                  <Toggle checked={h.active} onChange={() => toggle(h)} label={<span className="text-xs">{h.active ? 'Active' : 'Paused'}</span>} />
                  <button className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600" aria-label={`Delete webhook ${h.url}`} onClick={() => remove(h)}><Trash2 className="h-4 w-4" /></button>
                </li>
              ))}
            </ul>
          )}
          <div className="rounded-xl border border-dashed border-gray-300 p-3">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <Field label="Listener URL"><input className={cn(inputCls, 'font-mono text-xs')} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://salary.example.com/hooks/training" /></Field>
              <Btn onClick={register} disabled={!/^https?:\/\/\S+$/.test(url)}>Register webhook</Btn>
            </div>
            <fieldset className="mt-3">
              <legend className="text-xs font-medium text-gray-600">Events (none ticked = all)</legend>
              <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1">
                {EVENT_TYPES.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 text-sm text-gray-700">
                    <input type="checkbox" checked={types.includes(t.id)} onChange={(e) => setTypes(e.target.checked ? [...types, t.id] : types.filter((x) => x !== t.id))} />
                    {t.label} <code className="text-[11px] text-gray-400">{t.id}</code>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Each event is POSTed as JSON <code>{'{ id, type, payload }'}</code> with headers <code>X-Training-Event</code> and <code>X-Training-Signature: sha256=&lt;HMAC-SHA256 of the raw body with your secret, hex&gt;</code>. Verify the signature before trusting the payload. Failed deliveries are retried up to 10 times.
          </p>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-gray-800 mb-2">Recent events</h3>
          {!data ? <Spinner /> : data.events.length === 0 ? <Empty title="No events yet" /> : (
            <TableWrap>
              <thead className="bg-gray-50"><tr><th className={th}>When</th><th className={th}>Event</th><th className={th}>Details</th><th className={th}>Delivery</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {data.events.slice(0, 25).map((e: any) => (
                  <tr key={e.id}>
                    <td className={cn(td, 'whitespace-nowrap text-gray-500')}>{ago(e.created_at)} ago</td>
                    <td className={cn(td, 'font-mono text-xs')}>{e.type}</td>
                    <td className={cn(td, 'max-w-md text-xs text-gray-600')}>
                      {e.payload_json?.user_id !== undefined && <>rep #{e.payload_json.user_id} · </>}
                      {e.payload_json?.phase && <>{e.payload_json.previous_phase ? `${e.payload_json.previous_phase} → ` : ''}{e.payload_json.phase} · </>}
                      {e.payload_json?.cert && <>{e.payload_json.cert} · </>}
                      {e.payload_json?.reason}
                    </td>
                    <td className={td}>
                      {e.delivered_at ? <Pill tone="green">delivered</Pill> : e.last_error ? <Pill tone="red">failing ({e.attempts} tries)</Pill> : <Pill>pending</Pill>}
                      {e.last_error && <div className="mt-0.5 max-w-xs truncate text-xs text-red-600" title={e.last_error}>{e.last_error}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </div>

        <div>
          <h3 className="text-sm font-semibold text-gray-800 mb-2">Pull a rep’s status (for developers)</h3>
          <div className="relative">
            <pre className="overflow-x-auto rounded-xl bg-gray-900 p-4 text-xs leading-5 text-gray-100">{`# one rep (employee id = the user id in this app)
curl -H "Authorization: Bearer $TRAINING_SERVICE_TOKEN" \\
  ${origin}/api/training/integration/ramp-status/42

# every rep
curl -H "Authorization: Bearer $TRAINING_SERVICE_TOKEN" \\
  ${origin}/api/training/integration/ramp-status/all

# → { "employee_id": 42, "phase": "RAMP_50", "quota_multiplier": 0.5,
#     "penalty_free": true, "quota_credit": true, "certified_at": "…",
#     "phase_started_at": "…", "grandfathered": false, "history": [ … ] }`}</pre>
            <button className="absolute right-2 top-2 rounded bg-white/10 p-1.5 text-gray-200 hover:bg-white/20" aria-label="Copy" onClick={() => copy(`curl -H "Authorization: Bearer $TRAINING_SERVICE_TOKEN" ${origin}/api/training/integration/ramp-status/all`)}><Copy className="h-3.5 w-3.5" /></button>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Authenticate with <code>Bearer TRAINING_SERVICE_TOKEN</code> (or <code>CRON_SECRET</code>) from the server environment, or an HR login. Systems with database access can read the
            {' '}<code>v_rep_ramp_status</code> view instead (one row per rep: phase, quota multiplier, penalty-free flag, certification date).
          </p>
        </div>
      </div>

      <Modal open={!!secret} onClose={() => setSecret(null)} title="Webhook registered — copy the signing secret now"
        footer={<Btn onClick={() => setSecret(null)}>I’ve saved it</Btn>}>
        <p className="text-sm text-gray-600">This secret is shown <strong>only once</strong>. Give it to the salary system so it can verify <code>X-Training-Signature</code>.</p>
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <KeyRound className="h-4 w-4 text-amber-700 shrink-0" />
          <code className="min-w-0 flex-1 break-all text-xs text-gray-900" data-testid="webhook-secret">{secret?.secret}</code>
          <Btn size="sm" variant="secondary" onClick={() => secret && copy(secret.secret)}><Copy className="h-3.5 w-3.5" /> Copy</Btn>
        </div>
        <p className="mt-2 text-xs text-gray-400 break-all">For {secret?.url}</p>
      </Modal>
    </Panel>
  );
}
