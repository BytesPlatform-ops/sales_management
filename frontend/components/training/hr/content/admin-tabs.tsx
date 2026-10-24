'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, ArrowUp, ArrowDown, CheckCircle2 } from 'lucide-react';
import { tapi, useTraining, fmtDate } from '@/lib/training/client';
import { Panel, Pill, Btn, Spinner, ErrorNote, Empty, inputCls } from '@/components/training/ui';
import { Field, Toggle, JsonEditor, parseJson, Help, PayNote, useConfirm, useToast } from '@/components/training/hr/kit';
import { cn } from '@/lib/utils';

// ================================================================== RUBRIC

export function RubricTab() {
  const toast = useToast();
  const confirm = useConfirm();
  const { data, error, mutate } = useTraining<any[]>('/admin/rubrics');
  const rubric = data?.find((r) => r.code === 'CALL_SCORECARD_100') || data?.[0];
  const [f, setF] = useState<any>(null);
  useEffect(() => { if (rubric) setF(JSON.parse(JSON.stringify(rubric))); }, [rubric]);
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Spinner />;
  if (!rubric || !f) return <Empty title="No rubric found" />;

  const crit: any[] = f.criteria_json || [];
  const fails: any[] = f.auto_fail_json || [];
  const total = crit.reduce((s, c) => s + (Number(c.max_points) || 0), 0);
  const setCrit = (i: number, k: string, v: any) => setF({ ...f, criteria_json: crit.map((c, j) => (j === i ? { ...c, [k]: v } : c)) });
  const move = (i: number, d: number) => { const a = [...crit]; [a[i], a[i + d]] = [a[i + d], a[i]]; setF({ ...f, criteria_json: a }); };
  const setFail = (i: number, k: string, v: any) => setF({ ...f, auto_fail_json: fails.map((c, j) => (j === i ? { ...c, [k]: v } : c)) });
  const idsChanged = rubric.criteria_json.some((c: any) => !crit.find((x) => x.id === c.id));

  async function save() {
    const ids = crit.map((c) => c.id);
    if (ids.some((x) => !/^[a-z0-9_]+$/.test(x || ''))) return toast.show('Criterion ids must be lower-case letters, numbers and _ only', 'error');
    if (new Set(ids).size !== ids.length) return toast.show('Criterion ids must be unique', 'error');
    const ok = await confirm.ask({
      title: 'Save the scorecard?',
      body: <>
        <p>New roleplays and graded calls use it immediately. Existing scores are not recalculated.</p>
        {total !== 100 && <p className="text-amber-700">The maximum points add up to {total}, not 100. Pass ({f.pass_score}) and excellent ({f.excellent_score}) marks assume 100.</p>}
        {idsChanged && <p className="text-amber-700">You removed or renamed a criterion id. Scripted roleplays that award points to the old id will give 0 for it, and the AI grading prompt (Prompts → call_grade) still describes the old list.</p>}
        <p>Certification depends on these scores, which in turn affects pay phases.</p>
      </>,
      confirmLabel: 'Save scorecard', tone: 'primary',
    });
    if (ok === null) return;
    try {
      await tapi(`/admin/rubrics/${rubric.id}`, { method: 'PUT', body: {
        name: f.name, criteria_json: crit.map((c) => ({ ...c, max_points: Number(c.max_points) || 0 })), auto_fail_json: fails,
        auto_fail_cap: Number(f.auto_fail_cap), pass_score: Number(f.pass_score), excellent_score: Number(f.excellent_score),
      } });
      toast.show('Scorecard saved'); mutate();
    } catch (e) { toast.error(e); }
  }

  return (
    <div className="space-y-6">
      {toast.node}{confirm.node}
      <Help>The 100-point scorecard used to grade every roleplay and real call — by the AI, by the scripted fallback and by you in the review queue. Each criterion has a maximum; the total should be 100.</Help>
      <Panel title={<span className="normal-case tracking-normal">{f.name} <span className="font-mono text-xs text-gray-400">{f.code}</span></span>}
        action={<span className={cn('text-sm font-semibold tabular-nums', total === 100 ? 'text-emerald-600' : 'text-red-600')}>Total {total}/100</span>}>
        <div className="space-y-3">
          {crit.map((c, i) => (
            <div key={i} className="rounded-xl border border-gray-200 p-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[110px_1fr_90px_auto]">
                <Field label="Id"><input className={cn(inputCls, 'font-mono text-xs')} value={c.id} onChange={(e) => setCrit(i, 'id', e.target.value)} /></Field>
                <Field label="Criterion"><input className={inputCls} value={c.criterion} onChange={(e) => setCrit(i, 'criterion', e.target.value)} /></Field>
                <Field label="Max points"><input type="number" min={0} className={cn(inputCls, 'tabular-nums')} value={c.max_points} onChange={(e) => setCrit(i, 'max_points', e.target.value)} /></Field>
                <div className="flex items-end gap-0.5 pb-1">
                  <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)} className="p-1.5 text-gray-400 hover:text-gray-700 disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
                  <button type="button" aria-label="Move down" disabled={i === crit.length - 1} onClick={() => move(i, 1)} className="p-1.5 text-gray-400 hover:text-gray-700 disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
                  <button type="button" aria-label="Remove criterion" onClick={() => setF({ ...f, criteria_json: crit.filter((_, j) => j !== i) })} className="p-1.5 text-gray-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                </div>
                <Field label="What earns the points" className="sm:col-span-2"><input className={inputCls} value={c.description || ''} onChange={(e) => setCrit(i, 'description', e.target.value)} /></Field>
                <Field label="Example" className="sm:col-span-2"><input className={inputCls} value={c.examples || ''} onChange={(e) => setCrit(i, 'examples', e.target.value)} /></Field>
              </div>
            </div>
          ))}
          <Btn size="sm" variant="ghost" onClick={() => setF({ ...f, criteria_json: [...crit, { id: '', criterion: '', max_points: 0, description: '', examples: '' }] })}><Plus className="h-4 w-4" /> Add criterion</Btn>
        </div>
      </Panel>
      <Panel title="Automatic fails & pass marks">
        <div className="space-y-2">
          {fails.map((x, i) => (
            <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[200px_1fr_auto] sm:items-center">
              <input aria-label="Auto-fail id" className={cn(inputCls, 'font-mono text-xs')} value={x.id} onChange={(e) => setFail(i, 'id', e.target.value)} />
              <input aria-label="Auto-fail description" className={inputCls} value={x.description} onChange={(e) => setFail(i, 'description', e.target.value)} />
              <button type="button" aria-label="Remove auto-fail" onClick={() => setF({ ...f, auto_fail_json: fails.filter((_, j) => j !== i) })} className="p-1.5 text-gray-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          <Btn size="sm" variant="ghost" onClick={() => setF({ ...f, auto_fail_json: [...fails, { id: '', description: '' }] })}><Plus className="h-4 w-4" /> Add automatic fail</Btn>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <Field label="Score cap on an automatic fail" help="Any automatic fail limits the total to this."><input type="number" className={inputCls} value={f.auto_fail_cap} onChange={(e) => setF({ ...f, auto_fail_cap: e.target.value })} /></Field>
          <Field label="Pass mark" help="Roleplay and call pass."><input type="number" className={inputCls} value={f.pass_score} onChange={(e) => setF({ ...f, pass_score: e.target.value })} /></Field>
          <Field label="Excellent mark"><input type="number" className={inputCls} value={f.excellent_score} onChange={(e) => setF({ ...f, excellent_score: e.target.value })} /></Field>
        </div>
        <div className="mt-5 flex justify-end"><Btn onClick={save}>Save scorecard</Btn></div>
      </Panel>
    </div>
  );
}

// ================================================================== GATES

const REQ_KEYS = ['lesson', 'cert', 'courses_completed', 'roleplays'];

export function describeRule(rule: any): string[] {
  const out: string[] = [];
  for (const r of rule?.requires || []) {
    if (r.lesson) out.push(`Score at least ${r.min_score ?? 'the pass mark'}% on lesson ${r.lesson}`);
    else if (r.cert) out.push(`Hold the ${String(r.cert).replace(/_/g, ' ')}`);
    else if (r.courses_completed) out.push(`Finish every required lesson in course${r.courses_completed.length > 1 ? 's' : ''} ${r.courses_completed.join(', ')}`);
    else if (r.roleplays) {
      const x = r.roleplays;
      let s = `${x.count || 1} ${x.purpose === 'exam' ? 'exam ' : x.purpose ? `${x.purpose} ` : ''}roleplay${(x.count || 1) > 1 ? 's' : ''}`;
      if (x.exam_kind) s += ` with the ${x.exam_kind} persona`;
      s += ` scoring ${x.min_score ?? 0}/100 or more`;
      if (x.distinct_exam_kinds?.length) s += `, including at least one each of: ${x.distinct_exam_kinds.join(', ')}`;
      if (x.human_reviewed) s += `; at least ${x.human_reviewed} reviewed by a trainer`;
      out.push(s);
    } else out.push(`Unknown requirement: ${JSON.stringify(r)}`);
  }
  if (rule?.always_open_courses?.length) out.push(`(These courses are open from the start: ${rule.always_open_courses.join(', ')})`);
  return out;
}

function checkRule(v: any): string[] {
  const p: string[] = [];
  if (!v || typeof v !== 'object' || !Array.isArray(v.requires)) return ['Needs a "requires" list: { "requires": [ … ] }'];
  v.requires.forEach((r: any, i: number) => {
    const keys = Object.keys(r || {}).filter((k) => REQ_KEYS.includes(k));
    if (keys.length !== 1) p.push(`Requirement ${i + 1} must have exactly one of: ${REQ_KEYS.join(', ')}`);
    if (r?.courses_completed && !Array.isArray(r.courses_completed)) p.push(`Requirement ${i + 1}: "courses_completed" must be a list of course codes`);
    if (r?.roleplays && typeof r.roleplays !== 'object') p.push(`Requirement ${i + 1}: "roleplays" must be an object`);
  });
  return p;
}

function GateCard({ gate, onSaved }: { gate: any; onSaved: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [text, setText] = useState(JSON.stringify(gate.rule_json, null, 2));
  const [desc, setDesc] = useState(gate.description || '');
  const [active, setActive] = useState(!!gate.active);
  const p = parseJson(text);
  const lines = p.ok && p.value ? describeRule(p.value) : [];
  const dirty = text !== JSON.stringify(gate.rule_json, null, 2) || desc !== (gate.description || '') || active !== !!gate.active;
  async function save() {
    if (!p.ok || checkRule(p.value).length) return toast.show('Fix the rule first', 'error');
    const ok = await confirm.ask({
      title: `Save gate ${gate.code}?`,
      body: <><p>New rule:</p><ul className="list-disc pl-5">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
        {gate.target_type === 'cert' && <p className="text-amber-700">Certifications are granted automatically when the rule is met. LIVE_CALL_CERT starts quota credit and the ramp phases that payroll uses. Reps who already hold it keep it.</p>}</>,
      confirmLabel: 'Save gate', tone: 'primary',
    });
    if (ok === null) return;
    try { await tapi(`/admin/gates/${gate.id}`, { method: 'PUT', body: { rule_json: p.value, description: desc, active } }); toast.show('Gate saved'); onSaved(); } catch (e) { toast.error(e); }
  }
  return (
    <Panel title={<span className="flex flex-wrap items-center gap-2 normal-case tracking-normal"><span className="font-mono text-gray-900">{gate.code}</span><Pill tone={gate.target_type === 'cert' ? 'green' : gate.target_type === 'track' ? 'blue' : 'violet'}>{gate.target_type} → {gate.target_ref}</Pill>{!gate.active && <Pill tone="amber">inactive</Pill>}</span>}>
      {toast.node}{confirm.node}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <JsonEditor value={text} onChange={setText} rows={9} validate={checkRule} />
        </div>
        <div className="space-y-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">In plain English — a rep must:</div>
            {lines.length ? <ul className="space-y-1">{lines.map((l, i) => <li key={i} className="flex gap-1.5 text-sm text-gray-700"><CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-gray-300" />{l}</li>)}</ul> : <p className="text-sm text-gray-400">—</p>}
          </div>
          <Field label="Description (shown to reps)"><textarea rows={2} className={inputCls} value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
          <Toggle checked={active} onChange={setActive} label="Active" help="An inactive gate is ignored: the target is open / never auto-granted." />
          {gate.target_type === 'cert' && <PayNote>Changing a certification gate changes when reps start earning quota credit and enter the pay ramp.</PayNote>}
          <div className="flex justify-end"><Btn size="sm" onClick={save} disabled={!dirty}>Save gate</Btn></div>
        </div>
      </div>
    </Panel>
  );
}

export function GatesTab() {
  const { data, error, mutate } = useTraining<any[]>('/admin/gates');
  return (
    <div className="space-y-6">
      <Help>
        Gates decide what unlocks and when certifications are granted. A rule is a list under <code>requires</code>; every item must be met. Item types:
        {' '}<code>{'{"lesson":"T1-EXAM","min_score":80}'}</code> · <code>{'{"cert":"PRODUCT_CERT"}'}</code> · <code>{'{"courses_completed":["C1","C2"]}'}</code> ·
        {' '}<code>{'{"roleplays":{"count":2,"purpose":"exam","min_score":70,"human_reviewed":1,"distinct_exam_kinds":["friendly","skeptical"]}}'}</code>.
      </Help>
      <ErrorNote error={error} />
      {!data ? <Spinner /> : data.map((g) => <GateCard key={`${g.id}-${JSON.stringify(g.rule_json)}-${g.active}`} gate={g} onSaved={() => mutate()} />)}
    </div>
  );
}

// ================================================================== PROMPTS

const PROMPT_INFO: Record<string, string> = {
  roleplay_prospect: 'The AI prospect in text/voice roleplays: how it stays in character and when it agrees to a meeting.',
  call_grade: 'Grades roleplays and real calls against the 100-point scorecard.',
  objection_drill_grade: 'Grades a rep’s written reply in the objection drill.',
  objection_variant: 'Rewords library objections so drills don’t repeat word for word.',
  pitch_points: 'Live Assist: three talking points from a lead’s SAM.gov narrative.',
  site_scan_summary: 'Live Assist: plain-English summary of the 30-second website scan.',
  short_answer_grade: 'Grades short-answer quiz questions for meaning.',
  generate_flashcards: 'Drafts flashcards from a lesson (Content editor → AI generate).',
  generate_quiz: 'Drafts quiz questions from a lesson.',
  coach_digest: 'Writes the weekly coach digest.',
  email_followup: 'Drafts the follow-up email after a voicemail.',
  voicemail_grade: 'Grades a practice voicemail recording.',
  persona_from_lead: 'Turns a real SAM.gov lead into a roleplay persona.',
};

const vars = (t: string) => Array.from(new Set((t.match(/\{\{\s*(\w+)\s*\}\}/g) || []).map((m) => m.replace(/[{}\s]/g, ''))));

export function PromptsTab() {
  const toast = useToast();
  const confirm = useConfirm();
  const { data, error, mutate } = useTraining<any[]>('/prompts');
  const [key, setKey] = useState<string | null>(null);
  const [viewV, setViewV] = useState<number | null>(null);
  const [draft, setDraft] = useState<any | null>(null);
  const item = data?.find((d) => d.key === key) || data?.[0];
  useEffect(() => { setViewV(null); setDraft(null); }, [key]);

  const shown = useMemo(() => {
    if (!item) return null;
    const v = viewV ?? item.active_version;
    return v === 0 ? { ...item.default, version: 0 } : item.versions.find((x: any) => x.version === v) || { ...item.default, version: 0 };
  }, [item, viewV]);

  if (error) return <ErrorNote error={error} />;
  if (!data || !item || !shown) return <Spinner />;
  const needVars = vars(item.default.user_template || '');
  const missing = draft ? needVars.filter((v) => !vars(draft.user_template).includes(v) && !vars(draft.system_prompt).includes(v)) : [];

  async function saveVersion() {
    const t = Number(draft.temperature);
    if (!(t >= 0 && t <= 2)) return toast.show('Temperature must be between 0 and 2', 'error');
    if (!draft.system_prompt.trim()) return toast.show('The system prompt cannot be empty', 'error');
    try {
      const r = await tapi<any>('/prompts', { body: { key: item.key, system_prompt: draft.system_prompt, user_template: draft.user_template, temperature: t, model: draft.model || undefined } });
      toast.show(`Saved and activated version ${r.version}`); setDraft(null); setViewV(null); mutate();
    } catch (e) { toast.error(e); }
  }
  async function activate(v: number) {
    const ok = await confirm.ask({ title: v === 0 ? 'Go back to the built-in default?' : `Activate version ${v}?`, body: <p>All new AI calls for “{item.key}” use it straight away.</p>, confirmLabel: 'Activate', tone: 'primary' });
    if (ok === null) return;
    try { await tapi(`/prompts/${item.key}`, { method: 'PUT', body: { version: v } }); toast.show(v === 0 ? 'Using the built-in default' : `Version ${v} is active`); mutate(); } catch (e) { toast.error(e); }
  }

  return (
    <div className="space-y-4">
      {toast.node}{confirm.node}
      <Help>The instructions the AI follows for each feature. The built-in default is version 0. Saving creates a new version and makes it active; you can switch back at any time. Text like <code>{'{{transcript}}'}</code> is filled in automatically — keep those placeholders.</Help>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <Panel className="h-fit">
          <ul className="-mx-2 space-y-0.5" role="listbox" aria-label="Prompt templates">
            {data.map((d) => (
              <li key={d.key}>
                <button role="option" aria-selected={d.key === item.key} onClick={() => setKey(d.key)}
                  className={cn('w-full rounded-lg px-2 py-1.5 text-left text-sm', d.key === item.key ? 'bg-primary-50 text-primary-800 font-medium' : 'text-gray-700 hover:bg-gray-50')}>
                  <span className="font-mono text-xs">{d.key}</span>
                  <span className="ml-1 text-xs text-gray-400">{d.active_version ? `v${d.active_version}` : 'default'}</span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title={<span className="font-mono normal-case tracking-normal text-gray-900">{item.key}</span>}
          action={!draft && <Btn size="sm" onClick={() => setDraft({ system_prompt: shown.system_prompt, user_template: shown.user_template, temperature: shown.temperature ?? item.default.temperature, model: shown.model || '' })}>Edit as new version</Btn>}>
          <p className="-mt-1 mb-4 text-sm text-gray-600">{PROMPT_INFO[item.key]}</p>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-500">Versions:</span>
            {[{ version: 0 }, ...[...item.versions].sort((a: any, b: any) => a.version - b.version)].map((v: any) => (
              <button key={v.version} onClick={() => { setViewV(v.version); setDraft(null); }}
                className={cn('rounded-full border px-2.5 py-0.5 text-xs', (viewV ?? item.active_version) === v.version ? 'border-primary-600 bg-primary-600 text-white' : 'border-gray-300 text-gray-600 hover:border-primary-400')}>
                {v.version === 0 ? 'default' : `v${v.version}`}{item.active_version === v.version ? ' ✓' : ''}
              </button>
            ))}
          </div>
          {!draft ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                {shown.version === item.active_version ? <Pill tone="green">Active</Pill> : <Btn size="sm" variant="secondary" onClick={() => activate(shown.version)}>Activate this version</Btn>}
                <span>temperature {shown.temperature ?? '—'} · model {shown.model || 'feature default'}</span>
                {shown.created_at && <span>· saved {fmtDate(shown.created_at, true)}</span>}
              </div>
              <div><div className="text-xs font-semibold uppercase text-gray-500 mb-1">System prompt</div><pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-xs text-gray-700">{shown.system_prompt}</pre></div>
              <div><div className="text-xs font-semibold uppercase text-gray-500 mb-1">Message template</div><pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-xs text-gray-700">{shown.user_template}</pre></div>
              {needVars.length > 0 && <p className="text-xs text-gray-500">Placeholders filled in automatically: {needVars.map((v) => <code key={v} className="mr-1 rounded bg-gray-100 px-1">{`{{${v}}}`}</code>)}</p>}
            </div>
          ) : (
            <div className="space-y-4">
              <Field label="System prompt" help="The standing instructions."><textarea rows={14} className={cn(inputCls, 'font-mono text-xs')} value={draft.system_prompt} onChange={(e) => setDraft({ ...draft, system_prompt: e.target.value })} /></Field>
              <Field label="Message template" help="Sent with each request; placeholders are replaced with real data."><textarea rows={8} className={cn(inputCls, 'font-mono text-xs')} value={draft.user_template} onChange={(e) => setDraft({ ...draft, user_template: e.target.value })} /></Field>
              {missing.length > 0 && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">These placeholders are missing, so that data won’t reach the AI: {missing.map((m) => `{{${m}}}`).join(', ')}</p>}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Temperature (0–2)" help="0 = consistent (grading). Higher = more varied (roleplay)."><input type="number" step="0.1" min={0} max={2} className={inputCls} value={draft.temperature} onChange={(e) => setDraft({ ...draft, temperature: e.target.value })} /></Field>
                <Field label="Model (optional)" help="Leave empty to use the model set for this feature in AI usage → Models."><input className={inputCls} value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} placeholder="e.g. gpt-6-luna" /></Field>
              </div>
              <div className="flex justify-end gap-2"><Btn variant="secondary" onClick={() => setDraft(null)}>Cancel</Btn><Btn onClick={saveVersion}>Save as new version</Btn></div>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
