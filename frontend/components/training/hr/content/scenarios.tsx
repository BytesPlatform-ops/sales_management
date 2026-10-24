'use client';

import { useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Copy } from 'lucide-react';
import { tapi, useTraining } from '@/lib/training/client';
import { Panel, Pill, Btn, Spinner, ErrorNote, Empty, inputCls, scoreTone } from '@/components/training/ui';
import { Field, Toggle, JsonEditor, parseJson, Help, TableWrap, th, td, useConfirm, useToast } from '@/components/training/hr/kit';
import { cn } from '@/lib/utils';

interface RubricLite { id: number; code: string; criteria_json: { id: string; criterion: string; max_points: number }[]; auto_fail_json: { id: string }[] }

const EXAM_KINDS = [
  { value: '', label: 'None (practice persona)' },
  { value: 'friendly', label: 'Friendly — certification exam' },
  { value: 'skeptical', label: 'Skeptical — certification exam' },
  { value: 'bytescon', label: 'Bytescon — optional certification' },
];

const EMPTY_SCRIPT = {
  start: 'n1',
  nodes: {
    n1: { prospect: 'Hello, this is Mike.', choices: [
      { label: 'Hi Mike, it’s [Your name] with Bytes Platform. How have you been?', next: 'n2', points: { opener: 10 }, feedback: 'Good opener.' },
      { label: 'Hi, is now a bad time?', next: 'end_bad', points: {}, feedback: 'Gives them an easy exit.' },
    ] },
    n2: { prospect: 'Fine. What is this about?', end: true, outcome: 'booked' },
    end_bad: { prospect: 'Yes, actually. Bye.', end: true, outcome: 'hung_up' },
  },
};

/** Structural checks for the branching script (standard-mode roleplay engine). */
export function checkScript(rubric: RubricLite | undefined) {
  return (s: any): string[] => {
    const p: string[] = [];
    if (!s || typeof s !== 'object') return ['The script must be an object with "start" and "nodes"'];
    const nodes = s.nodes;
    if (!nodes || typeof nodes !== 'object') return ['Missing "nodes"'];
    if (!s.start) p.push('Missing "start" (the id of the first node)');
    else if (!nodes[s.start]) p.push(`"start" points to "${s.start}", which is not a node`);
    const ids = new Set(rubric?.criteria_json.map((c) => c.id) || []);
    for (const [id, n] of Object.entries<any>(nodes)) {
      if (!n || typeof n.prospect !== 'string') p.push(`Node "${id}" needs a "prospect" line`);
      const choices = n?.choices || [];
      if (!choices.length && !n?.end) p.push(`Node "${id}" has no choices, so it must have "end": true`);
      if (choices.length && n?.end) p.push(`Node "${id}" is marked "end" but still has choices`);
      choices.forEach((c: any, i: number) => {
        if (!c.label) p.push(`Node "${id}", choice ${i + 1}: missing "label"`);
        if (!c.next) p.push(`Node "${id}", choice ${i + 1}: missing "next"`);
        else if (!nodes[c.next]) p.push(`Node "${id}", choice ${i + 1}: "next" goes to "${c.next}", which does not exist`);
        for (const k of Object.keys(c.points || {})) if (ids.size && !ids.has(k)) p.push(`Node "${id}", choice ${i + 1}: unknown criterion "${k}" in points`);
      });
    }
    // reachability
    if (s.start && nodes[s.start]) {
      const seen = new Set<string>();
      const stack = [s.start];
      while (stack.length) {
        const n = stack.pop()!;
        if (seen.has(n) || !nodes[n]) continue;
        seen.add(n);
        for (const c of nodes[n].choices || []) stack.push(c.next);
      }
      const unreachable = Object.keys(nodes).filter((k) => !seen.has(k));
      if (unreachable.length) p.push(`Never reached from the start: ${unreachable.join(', ')}`);
    }
    return p;
  };
}

/** Best/worst possible score over all paths: points summed per criterion and capped at the rubric max. */
export function scorePaths(s: any, rubric: RubricLite | undefined) {
  if (!s?.nodes?.[s?.start] || !rubric) return null;
  const max = new Map(rubric.criteria_json.map((c) => [c.id, c.max_points]));
  type Best = { total: number; per: Record<string, number>; path: string[]; outcome: string };
  const box: { best: Best | null } = { best: null };
  let worst: number | null = null;
  let endings = 0;
  let truncated = false;
  const walk = (node: string, acc: Record<string, number>, path: string[], depth: number) => {
    if (endings > 20000) { truncated = true; return; }
    const n = s.nodes[node];
    if (!n || n.end || !(n.choices || []).length || depth > 60) {
      endings++;
      const per: Record<string, number> = {};
      let total = 0;
      for (const [id, m] of Array.from(max.entries())) { per[id] = Math.min(m, acc[id] || 0); total += per[id]; }
      if (!box.best || total > box.best.total) box.best = { total, per, path: [...path, node], outcome: n?.outcome || '' };
      if (worst === null || total < worst) worst = total;
      return;
    }
    if (path.includes(node)) { endings++; return; } // loop guard
    for (const c of n.choices) {
      const next = { ...acc };
      for (const [k, v] of Object.entries<any>(c.points || {})) next[k] = (next[k] || 0) + Number(v || 0);
      walk(c.next, next, [...path, node], depth + 1);
    }
  };
  walk(s.start, {}, [], 0);
  return { best: box.best, worst, endings, truncated };
}

function personaForm(row: any) {
  const p = row?.persona_json || {};
  return {
    code: row?.code || '', title: row?.title || '', objective: row?.objective || '', difficulty: row?.difficulty ?? 2,
    exam_kind: row?.exam_kind || '', pass_rule: row?.pass_rule || '', active: row?.active ?? true, rubric_id: row?.rubric_id ?? null,
    name: p.name || '', firm_name: p.firm_name || '', firm_type: p.firm_type || '', narrative: p.narrative || '', state: p.state || '',
    size_guess: p.size_guess || '', gov_mix_pct: p.gov_mix_pct ?? '', hidden_pains: (p.hidden_pains || []).join('\n'), mood: p.mood || '',
    website_observation: p.website_observation || '', voice_notes: p.voice_notes || '',
    objections: (row?.objections_json || []).join('\n'),
    script: row?.script_json && Object.keys(row.script_json).length ? JSON.stringify(row.script_json, null, 2) : '',
    _extra: p,
  };
}

function ScenarioEditor({ row, rubric, onDone, onCancel }: { row: any | null; rubric?: RubricLite; onDone: () => void; onCancel: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<any>(() => personaForm(row));
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setF({ ...f, [k]: v });
  const script = parseJson(f.script);
  const problems = script.ok && script.value ? checkScript(rubric)(script.value) : [];
  const paths = useMemo(() => (script.ok && script.value && !problems.length ? scorePaths(script.value, rubric) : null), [f.script, rubric]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (!f.code.trim() || !f.title.trim() || !f.objective.trim()) return toast.show('Code, title and objective are required', 'error');
    if (!script.ok) return toast.show(`Script JSON: ${script.error}`, 'error');
    if (problems.length) return toast.show(`Script: ${problems[0]}`, 'error');
    const persona = {
      ...f._extra, name: f.name, firm_name: f.firm_name, firm_type: f.firm_type, narrative: f.narrative, state: f.state, size_guess: f.size_guess,
      gov_mix_pct: f.gov_mix_pct === '' ? null : Number(f.gov_mix_pct), hidden_pains: f.hidden_pains.split('\n').map((s: string) => s.trim()).filter(Boolean),
      mood: f.mood, website_observation: f.website_observation, voice_notes: f.voice_notes,
    };
    const body = {
      code: f.code.trim(), title: f.title.trim(), objective: f.objective, difficulty: Number(f.difficulty) || 1, exam_kind: f.exam_kind || null,
      pass_rule: f.pass_rule || null, active: !!f.active, persona_json: persona,
      objections_json: f.objections.split('\n').map((s: string) => s.trim()).filter(Boolean),
      script_json: script.value || {}, ...(f.rubric_id ? {} : rubric ? { rubric_id: rubric.id } : {}),
    };
    setBusy(true);
    try {
      if (row?.id) await tapi(`/admin/scenarios/${row.id}`, { method: 'PUT', body });
      else await tapi('/admin/scenarios', { body });
      onDone();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  }

  return (
    <Panel title={row?.id ? `Edit persona ${row.code}` : 'New persona'} action={<Btn size="sm" variant="ghost" onClick={onCancel}>Close</Btn>}>
      {toast.node}
      <div className="space-y-6">
        <section>
          <h3 className="mb-3 text-sm font-semibold text-gray-800">Scenario</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Code" help="e.g. RP4. Roleplay lessons list the codes that count."><input className={cn(inputCls, 'font-mono')} value={f.code} onChange={(e) => set('code', e.target.value)} /></Field>
            <Field label="Title" className="sm:col-span-2 lg:col-span-3"><input className={inputCls} value={f.title} onChange={(e) => set('title', e.target.value)} /></Field>
            <Field label="Objective for the rep" className="sm:col-span-2 lg:col-span-4" help="Shown to the rep before they start, and used by the AI grader."><textarea rows={2} className={inputCls} value={f.objective} onChange={(e) => set('objective', e.target.value)} /></Field>
            <Field label={`Difficulty: ${f.difficulty} of 5`}><input type="range" min={1} max={5} value={f.difficulty} onChange={(e) => set('difficulty', Number(e.target.value))} className="w-full accent-primary-600" /></Field>
            <Field label="Certification exam"><select className={inputCls} value={f.exam_kind} onChange={(e) => set('exam_kind', e.target.value)}>{EXAM_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select></Field>
            <Field label="Pass rule (optional)" help="Leave empty for the normal ≥70. Use “removed” for do-not-call personas where the right move is to comply.">
              <input className={inputCls} value={f.pass_rule} onChange={(e) => set('pass_rule', e.target.value)} />
            </Field>
            <div className="pt-6"><Toggle checked={f.active} onChange={(v) => set('active', v)} label="Active" help="Inactive personas can’t be started." /></div>
          </div>
        </section>

        <section>
          <h3 className="mb-3 text-sm font-semibold text-gray-800">Who the prospect is <span className="font-normal text-gray-400">(the AI plays this person)</span></h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Name"><input className={inputCls} value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
            <Field label="Company"><input className={inputCls} value={f.firm_name} onChange={(e) => set('firm_name', e.target.value)} /></Field>
            <Field label="Type of business"><input className={inputCls} value={f.firm_type} onChange={(e) => set('firm_type', e.target.value)} /></Field>
            <Field label="State"><input className={inputCls} value={f.state} onChange={(e) => set('state', e.target.value)} /></Field>
            <Field label="Size"><input className={inputCls} value={f.size_guess} onChange={(e) => set('size_guess', e.target.value)} placeholder="10–25 employees" /></Field>
            <Field label="Government share of revenue (%)"><input type="number" min={0} max={100} className={inputCls} value={f.gov_mix_pct} onChange={(e) => set('gov_mix_pct', e.target.value)} /></Field>
            <Field label="Mood"><input className={inputCls} value={f.mood} onChange={(e) => set('mood', e.target.value)} placeholder="busy, friendly, skeptical…" /></Field>
            <Field label="Website observation" help="What the rep would see on a quick scan."><input className={inputCls} value={f.website_observation} onChange={(e) => set('website_observation', e.target.value)} /></Field>
            <Field label="Capabilities narrative" className="sm:col-span-2 lg:col-span-4"><textarea rows={2} className={inputCls} value={f.narrative} onChange={(e) => set('narrative', e.target.value)} /></Field>
            <Field label="Hidden pains" className="sm:col-span-2" help="One per line. The prospect only reveals these if the rep asks good questions."><textarea rows={3} className={inputCls} value={f.hidden_pains} onChange={(e) => set('hidden_pains', e.target.value)} /></Field>
            <Field label="Objections they raise" className="sm:col-span-2" help="One per line, in roughly the order they come up."><textarea rows={3} className={inputCls} value={f.objections} onChange={(e) => set('objections', e.target.value)} /></Field>
            <Field label="Voice / acting notes" className="sm:col-span-2 lg:col-span-4"><textarea rows={2} className={inputCls} value={f.voice_notes} onChange={(e) => set('voice_notes', e.target.value)} /></Field>
          </div>
        </section>

        <section>
          <h3 className="mb-1 text-sm font-semibold text-gray-800">Branching script <span className="font-normal text-gray-400">(used when AI is off — “standard mode”)</span></h3>
          <Help className="mb-3">
            Each <strong>node</strong> is something the prospect says, with <strong>choices</strong> the rep can pick. A choice has a <code>label</code> (what the rep says), <code>next</code> (the node it leads to),
            optional <code>points</code> per scorecard criterion (e.g. <code>{'{"opener": 10}'}</code>) and <code>feedback</code> (coaching shown afterwards).
            A node without choices ends the call and needs <code>&quot;end&quot;: true</code> plus an <code>outcome</code> such as <code>booked</code>, <code>callback</code>, <code>hung_up</code> or <code>removed</code>.
            Points are added up per criterion and capped at that criterion’s maximum.
            {rubric && <> Criterion ids: {rubric.criteria_json.map((c) => `${c.id} (max ${c.max_points})`).join(', ')}.</>}
          </Help>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div>
              <JsonEditor value={f.script} onChange={(v) => set('script', v)} rows={22} validate={checkScript(rubric)} />
              {!f.script.trim() && <button type="button" className="mt-1 text-xs text-primary-600 hover:underline" onClick={() => set('script', JSON.stringify(EMPTY_SCRIPT, null, 2))}>Start from a small example</button>}
            </div>
            <div className="rounded-xl border border-gray-200 p-4 text-sm h-fit">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Best possible path</div>
              {!f.script.trim() ? <p className="text-gray-400 text-xs">No script — without AI this persona can’t be practised.</p>
                : !paths ? <p className="text-gray-400 text-xs">Fix the problems on the left to see the score preview.</p> : (
                <>
                  <div className={cn('text-3xl font-extrabold tabular-nums', scoreTone(paths.best?.total))}>{paths.best?.total ?? 0}<span className="text-base text-gray-400">/100</span></div>
                  <p className="text-xs text-gray-500 mt-1">Worst path: {paths.worst}. {paths.endings} possible endings{paths.truncated ? ' (stopped counting at 20,000)' : ''}. Best path ends “{paths.best?.outcome || '—'}”.</p>
                  {(paths.best?.total ?? 0) < 70 && <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-800">Even a perfect run can’t reach 70, so no one can pass this persona in standard mode.</p>}
                  <ul className="mt-3 space-y-1">
                    {rubric?.criteria_json.map((c) => (
                      <li key={c.id} className="flex justify-between text-xs"><span className="text-gray-600">{c.criterion}</span><span className={cn('tabular-nums', (paths.best?.per[c.id] ?? 0) < c.max_points ? 'text-amber-600' : 'text-gray-700')}>{paths.best?.per[c.id] ?? 0}/{c.max_points}</span></li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[11px] text-gray-400 break-words">Path: {paths.best?.path.join(' → ')}</p>
                </>
              )}
            </div>
          </div>
        </section>

        <div className="flex justify-end gap-2">
          <Btn variant="secondary" onClick={onCancel}>Cancel</Btn>
          <Btn onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save persona'}</Btn>
        </div>
      </div>
    </Panel>
  );
}

export function ScenariosTab() {
  const toast = useToast();
  const confirm = useConfirm();
  const { data, error, mutate } = useTraining<any[]>('/admin/scenarios');
  const rubrics = useTraining<RubricLite[]>('/admin/rubrics');
  const rubric = rubrics.data?.find((r) => r.code === 'CALL_SCORECARD_100') || rubrics.data?.[0];
  const [editing, setEditing] = useState<any | null | undefined>(undefined);

  async function remove(r: any) {
    const ok = await confirm.ask({ title: `Delete persona ${r.code}?`, body: <p>Past roleplay sessions keep their transcripts and scores. Lessons that list this code will stop finding it. To retire it safely, switch it to inactive instead.</p>, confirmLabel: 'Delete' });
    if (ok === null) return;
    try { await tapi(`/admin/scenarios/${r.id}`, { method: 'DELETE' }); toast.show('Persona deleted'); mutate(); } catch (e) { toast.error(e); }
  }

  return (
    <div className="space-y-6">
      {toast.node}{confirm.node}
      {editing !== undefined ? (
        <ScenarioEditor key={editing?.id ?? 'new'} row={editing} rubric={rubric} onCancel={() => setEditing(undefined)} onDone={() => { setEditing(undefined); toast.show('Persona saved'); mutate(); }} />
      ) : (
        <Panel title="Roleplay personas" action={<Btn size="sm" onClick={() => setEditing(null)}><Plus className="h-4 w-4" /> New persona</Btn>}>
          <ErrorNote error={error} />
          {!data ? <Spinner /> : data.length === 0 ? <Empty title="No personas yet" /> : (
            <TableWrap>
              <thead className="bg-gray-50"><tr><th className={th}>Code</th><th className={th}>Persona</th><th className={th}>Exam</th><th className={th}>Difficulty</th><th className={th}>Script</th><th className={th}></th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {data.map((r) => {
                  const probs = r.script_json?.start ? checkScript(rubric)(r.script_json) : null;
                  const best = probs && !probs.length ? scorePaths(r.script_json, rubric)?.best?.total : null;
                  return (
                    <tr key={r.id} className={cn('hover:bg-gray-50', !r.active && 'opacity-60')}>
                      <td className={cn(td, 'font-mono text-xs whitespace-nowrap')}>{r.code}</td>
                      <td className={cn(td, 'min-w-[240px]')}>
                        <div className="font-medium text-gray-900">{r.title}</div>
                        <div className="text-xs text-gray-400">{[r.persona_json?.firm_type, r.persona_json?.state, r.persona_json?.mood].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td className={td}>{r.exam_kind ? <Pill tone="violet">{r.exam_kind}</Pill> : <span className="text-xs text-gray-400">practice</span>}{!r.active && <Pill tone="amber" className="ml-1">inactive</Pill>}</td>
                      <td className={cn(td, 'tabular-nums')}>{'●'.repeat(r.difficulty || 0)}<span className="text-gray-200">{'●'.repeat(5 - (r.difficulty || 0))}</span></td>
                      <td className={td}>
                        {!r.script_json?.start ? <Pill>no script</Pill> : probs?.length ? <Pill tone="red">{probs.length} problem{probs.length > 1 ? 's' : ''}</Pill> : <span className="text-xs text-gray-600 whitespace-nowrap">{Object.keys(r.script_json.nodes || {}).length} nodes · best {best}</span>}
                      </td>
                      <td className={cn(td, 'text-right whitespace-nowrap')}>
                        <button className="rounded p-1.5 text-gray-500 hover:bg-gray-100" aria-label={`Edit ${r.code}`} onClick={() => setEditing(r)}><Pencil className="h-4 w-4" /></button>
                        <button className="rounded p-1.5 text-gray-500 hover:bg-gray-100" aria-label={`Duplicate ${r.code}`} title="Duplicate" onClick={() => setEditing({ ...r, id: undefined, code: `${r.code}-COPY`, title: `${r.title} (copy)` })}><Copy className="h-4 w-4" /></button>
                        <button className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600" aria-label={`Delete ${r.code}`} onClick={() => remove(r)}><Trash2 className="h-4 w-4" /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          )}
        </Panel>
      )}
    </div>
  );
}
