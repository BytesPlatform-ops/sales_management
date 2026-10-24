'use client';

import { ReactNode, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Search } from 'lucide-react';
import { tapi, useTraining, SERVICE_LABELS } from '@/lib/training/client';
import { Panel, Pill, Btn, Spinner, ErrorNote, Empty, inputCls } from '@/components/training/ui';
import { Modal, Field, Toggle, ChipInput, JsonEditor, parseJson, Help, TableWrap, th, td, useConfirm, useToast } from '@/components/training/hr/kit';
import { cn } from '@/lib/utils';

export type FieldDef = {
  key: string; label: string; help?: ReactNode; wide?: boolean;
  type: 'text' | 'textarea' | 'int' | 'bool' | 'select' | 'lines' | 'tags' | 'json' | 'multiselect';
  options?: { value: string; label: string }[]; suggestions?: string[]; rows?: number; required?: boolean;
  validate?: (v: any) => string[];
};

export interface EntityConfig {
  entity: string;
  title: string;
  noun: string;
  help?: ReactNode;
  fields: FieldDef[];
  columns: { label: string; render: (row: any) => ReactNode; className?: string }[];
  defaults: Record<string, any>;
  searchText?: (row: any) => string;
  deleteWarning?: ReactNode;
}

function toForm(fields: FieldDef[], row: any) {
  const f: Record<string, any> = {};
  for (const d of fields) {
    const v = row[d.key];
    if (d.type === 'lines') f[d.key] = Array.isArray(v) ? v.join('\n') : '';
    else if (d.type === 'json') f[d.key] = v === null || v === undefined ? '' : JSON.stringify(v, null, 2);
    else if (d.type === 'tags' || d.type === 'multiselect') f[d.key] = Array.isArray(v) ? v : [];
    else f[d.key] = v ?? (d.type === 'bool' ? false : '');
  }
  return f;
}

function fromForm(fields: FieldDef[], f: Record<string, any>): { body?: any; error?: string } {
  const body: Record<string, any> = {};
  for (const d of fields) {
    const v = f[d.key];
    if (d.required && (v === '' || v === null || v === undefined || (Array.isArray(v) && !v.length))) return { error: `${d.label} is required` };
    if (d.type === 'lines') body[d.key] = String(v || '').split('\n').map((s) => s.trim()).filter(Boolean);
    else if (d.type === 'json') {
      const p = parseJson(v || '');
      if (!p.ok) return { error: `${d.label}: ${p.error}` };
      const probs = p.value !== null && d.validate ? d.validate(p.value) : [];
      if (probs.length) return { error: `${d.label}: ${probs[0]}` };
      body[d.key] = p.value;
    } else if (d.type === 'int') body[d.key] = v === '' ? null : Number(v);
    else body[d.key] = v;
  }
  return { body };
}

function FieldInput({ d, value, onChange }: { d: FieldDef; value: any; onChange: (v: any) => void }) {
  switch (d.type) {
    case 'textarea': return <textarea rows={d.rows || 3} className={inputCls} value={value} onChange={(e) => onChange(e.target.value)} />;
    case 'int': return <input type="number" className={inputCls} value={value} onChange={(e) => onChange(e.target.value)} />;
    case 'bool': return <Toggle checked={!!value} onChange={onChange} label={d.label} help={d.help} />;
    case 'select': return <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>{d.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
    case 'lines': return <textarea rows={d.rows || 4} className={inputCls} value={value} onChange={(e) => onChange(e.target.value)} placeholder="One per line" />;
    case 'tags': return <ChipInput value={value} onChange={onChange} suggestions={d.suggestions} />;
    case 'multiselect': return (
      <div className="flex flex-wrap gap-1.5">
        {d.options!.map((o) => {
          const on = (value || []).includes(o.value);
          return <button key={o.value} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter((x: string) => x !== o.value) : [...(value || []), o.value])}
            className={cn('rounded-full border px-2.5 py-1 text-xs', on ? 'border-primary-600 bg-primary-600 text-white' : 'border-gray-300 text-gray-700 hover:border-primary-400')}>{o.label}</button>;
        })}
      </div>
    );
    case 'json': return <JsonEditor value={value} onChange={onChange} rows={d.rows || 6} validate={d.validate} />;
    default: return <input className={inputCls} value={value} onChange={(e) => onChange(e.target.value)} />;
  }
}

export function EntityForm({ fields, form, setForm }: { fields: FieldDef[]; form: Record<string, any>; setForm: (f: Record<string, any>) => void }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {fields.map((d) => d.type === 'bool' ? (
        <div key={d.key} className={cn(d.wide && 'sm:col-span-2')}><FieldInput d={d} value={form[d.key]} onChange={(v) => setForm({ ...form, [d.key]: v })} /></div>
      ) : (
        <Field key={d.key} label={<>{d.label}{d.required && <span className="text-red-500"> *</span>}</>} help={d.help} className={cn((d.wide || ['textarea', 'lines', 'json'].includes(d.type)) && 'sm:col-span-2')}>
          <FieldInput d={d} value={form[d.key]} onChange={(v) => setForm({ ...form, [d.key]: v })} />
        </Field>
      ))}
    </div>
  );
}

export function EntityManager({ config }: { config: EntityConfig }) {
  const toast = useToast();
  const confirm = useConfirm();
  const { data, error, mutate } = useTraining<any[]>(`/admin/${config.entity}`);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data || []).filter((r) => !s || (config.searchText ? config.searchText(r) : JSON.stringify(r)).toLowerCase().includes(s));
  }, [data, q, config]);

  const open = (row: any | null) => { setEditing(row || { __new: true }); setForm(toForm(config.fields, row || config.defaults)); };
  async function save() {
    const { body, error: err } = fromForm(config.fields, form);
    if (err) return toast.show(err, 'error');
    setBusy(true);
    try {
      if (editing.__new) await tapi(`/admin/${config.entity}`, { body });
      else await tapi(`/admin/${config.entity}/${editing.id}`, { method: 'PUT', body });
      toast.show(`${config.noun} saved`); setEditing(null); mutate();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  }
  async function remove(row: any) {
    const ok = await confirm.ask({ title: `Delete this ${config.noun.toLowerCase()}?`, body: config.deleteWarning || <p>This cannot be undone. To hide it instead, switch it to inactive.</p>, confirmLabel: 'Delete' });
    if (ok === null) return;
    try { await tapi(`/admin/${config.entity}/${row.id}`, { method: 'DELETE' }); toast.show('Deleted'); mutate(); } catch (e) { toast.error(e); }
  }

  return (
    <div className="space-y-4">
      {toast.node}{confirm.node}
      {config.help && <Help>{config.help}</Help>}
      <Panel title={config.title} action={<Btn size="sm" onClick={() => open(null)}><Plus className="h-4 w-4" /> Add {config.noun.toLowerCase()}</Btn>}>
        <div className="relative mb-3 max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
          <input aria-label="Search" className={cn(inputCls, 'pl-8')} placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <ErrorNote error={error} />
        {!data ? <Spinner /> : rows.length === 0 ? <Empty title={data.length ? 'No matches' : `No ${config.noun.toLowerCase()}s yet`} /> : (
          <TableWrap>
            <thead className="bg-gray-50"><tr>{config.columns.map((c) => <th key={c.label} className={th}>{c.label}</th>)}<th className={th}></th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => (
                <tr key={r.id} className={cn('hover:bg-gray-50', r.active === false && 'opacity-60')}>
                  {config.columns.map((c) => <td key={c.label} className={cn(td, c.className)}>{c.render(r)}</td>)}
                  <td className={cn(td, 'text-right whitespace-nowrap')}>
                    <button className="rounded p-1.5 text-gray-500 hover:bg-gray-100" aria-label="Edit" onClick={() => open(r)}><Pencil className="h-4 w-4" /></button>
                    <button className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600" aria-label="Delete" onClick={() => remove(r)}><Trash2 className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>
      <Modal open={!!editing} onClose={() => setEditing(null)} wide title={editing?.__new ? `New ${config.noun.toLowerCase()}` : `Edit ${config.noun.toLowerCase()}`}
        footer={<><Btn variant="secondary" onClick={() => setEditing(null)}>Cancel</Btn><Btn onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Btn></>}>
        <EntityForm fields={config.fields} form={form} setForm={setForm} />
      </Modal>
    </div>
  );
}

// ------------------------------------------------------------------ configs

const SERVICE_OPTS = Object.entries(SERVICE_LABELS).map(([value, label]) => ({ value, label }));
export const SCAN_FLAGS = ['no_site', 'no_ssl', 'old_copyright', 'not_mobile', 'no_capability_statement', 'template_look', 'slow_load', 'no_contact_form', 'no_blog', 'no_social', 'modern_site', 'outdated', 'hiring', 'private_customers', 'missed_calls_pain', 'bids_often', 'bd_staff', 'ops_volume', 'pure_federal', 'commercial'];
const stringList = (v: any) => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? [] : ['Must be a list of text, e.g. ["no_site", "hiring"]']);

export const OBJECTIONS: EntityConfig = {
  entity: 'objections', title: 'Objection library', noun: 'Objection',
  help: <>Every objection reps practise in drills and see in Live Assist. The <strong>number</strong> sets the order; tag the five most common with <code>top5</code> so drills include them more often. Responses are the model answers shown after a rep replies.</>,
  defaults: { num: '', objection: '', why_they_say_it: '', principle: '', responses_json: [], quick_response: '', tags: [], active: true },
  fields: [
    { key: 'num', label: 'Number', type: 'int', required: true },
    { key: 'objection', label: 'What the prospect says', type: 'text', required: true },
    { key: 'why_they_say_it', label: 'Why they say it', type: 'textarea', rows: 2 },
    { key: 'principle', label: 'Principle / technique', type: 'text' },
    { key: 'responses_json', label: 'Model responses', type: 'lines', rows: 5, help: 'One response per line. Reps see all of them after answering.' },
    { key: 'quick_response', label: 'Quick response (Live Assist)', type: 'textarea', rows: 2, help: 'The one-liner shown during a live call.' },
    { key: 'tags', label: 'Tags', type: 'tags', suggestions: ['top5', 'brush-off', 'price', 'timing', 'trust', 'competitor'] },
    { key: 'active', label: 'Active', type: 'bool', help: 'Inactive objections are left out of drills and Live Assist.' },
  ],
  columns: [
    { label: '#', render: (r) => <span className="tabular-nums text-gray-400">{r.num}</span> },
    { label: 'Objection', render: (r) => <span className="font-medium text-gray-900">{r.objection}</span>, className: 'min-w-[200px]' },
    { label: 'Quick response', render: (r) => <span className="line-clamp-2 text-gray-600">{r.quick_response || '—'}</span>, className: 'max-w-sm' },
    { label: 'Responses', render: (r) => <span className="tabular-nums">{(r.responses_json || []).length}</span> },
    { label: 'Tags', render: (r) => <div className="flex flex-wrap gap-1">{(r.tags || []).map((t: string) => <Pill key={t}>{t}</Pill>)}{r.active === false && <Pill tone="amber">inactive</Pill>}</div> },
  ],
  searchText: (r) => `${r.objection} ${r.quick_response} ${(r.tags || []).join(' ')}`,
};

export const CLASSIFICATION: EntityConfig = {
  entity: 'classification', title: 'Classification drill rows', noun: 'Row',
  help: <>Practice rows for the classification drill: a SAM.gov-style company description plus what a 30-second website scan found. The rep picks which service to lead with; <strong>Correct service</strong> is the best answer and <strong>Also acceptable</strong> get partial credit.</>,
  defaults: { firm_name: '', narrative: '', city_state: '', website_url: '', scan_flags: [], scan_summary: '', gov_mix: 'mixed', correct_service: 'website_new', acceptable_services: [], reason: '', active: true },
  fields: [
    { key: 'firm_name', label: 'Company name', type: 'text', required: true },
    { key: 'city_state', label: 'City, state', type: 'text' },
    { key: 'narrative', label: 'Capabilities narrative (as on SAM.gov)', type: 'textarea', required: true },
    { key: 'website_url', label: 'Website', type: 'text' },
    { key: 'gov_mix', label: 'Customer mix', type: 'select', options: [{ value: 'pure_federal', label: 'Pure federal' }, { value: 'mixed', label: 'Mixed (gov + private)' }, { value: 'commercial', label: 'Mostly commercial' }] },
    { key: 'scan_flags', label: 'Scan findings', type: 'json', rows: 3, validate: stringList, help: <>A list like <code>[&quot;no_ssl&quot;, &quot;old_copyright&quot;]</code>. Known flags: {SCAN_FLAGS.join(', ')}.</> },
    { key: 'scan_summary', label: 'What the scan shows (plain English)', type: 'textarea', rows: 2 },
    { key: 'correct_service', label: 'Correct service', type: 'select', options: SERVICE_OPTS, required: true },
    { key: 'acceptable_services', label: 'Also acceptable', type: 'multiselect', options: SERVICE_OPTS },
    { key: 'reason', label: 'Why (shown to the rep after answering)', type: 'textarea', required: true },
    { key: 'active', label: 'Active', type: 'bool' },
  ],
  columns: [
    { label: 'Company', render: (r) => <><div className="font-medium text-gray-900">{r.firm_name}</div><div className="text-xs text-gray-400">{r.city_state}</div></>, className: 'min-w-[180px]' },
    { label: 'Scan findings', render: (r) => <div className="flex flex-wrap gap-1">{(r.scan_flags || []).map((f: string) => <Pill key={f} tone="gray">{f.replace(/_/g, ' ')}</Pill>)}</div>, className: 'max-w-xs' },
    { label: 'Correct', render: (r) => <Pill tone="green">{SERVICE_LABELS[r.correct_service] || r.correct_service}</Pill> },
    { label: 'Also OK', render: (r) => <span className="text-xs text-gray-500">{(r.acceptable_services || []).map((s: string) => SERVICE_LABELS[s] || s).join(', ') || '—'}</span> },
    { label: '', render: (r) => (r.active === false ? <Pill tone="amber">inactive</Pill> : null) },
  ],
  searchText: (r) => `${r.firm_name} ${r.narrative} ${r.correct_service}`,
};

const BADGE_TYPES = ['first_meeting', 'drill_streak', 'objection_master', 'cert'];
export const BADGES: EntityConfig = {
  entity: 'badges', title: 'Badges', noun: 'Badge',
  help: <>Badges reps earn automatically. <strong>Rule</strong> says when: <code>{'{"type":"drill_streak","days":10}'}</code>, <code>{'{"type":"cert","code":"PRODUCT_CERT"}'}</code>, <code>{'{"type":"first_meeting"}'}</code>, <code>{'{"type":"objection_master","min":8}'}</code>. Icons are lucide icon names (e.g. award, flame, shield, calendar-check).</>,
  defaults: { code: '', title: '', description: '', icon: 'award', criteria_json: { type: 'cert', code: 'PRODUCT_CERT' } },
  fields: [
    { key: 'code', label: 'Code', type: 'text', required: true },
    { key: 'title', label: 'Title', type: 'text', required: true },
    { key: 'description', label: 'Description', type: 'textarea', rows: 2 },
    { key: 'icon', label: 'Icon', type: 'text' },
    { key: 'criteria_json', label: 'Rule', type: 'json', rows: 4, validate: (v) => (v && BADGE_TYPES.includes(v.type) ? [] : [`"type" must be one of ${BADGE_TYPES.join(', ')}`]) },
  ],
  columns: [
    { label: 'Badge', render: (r) => <><div className="font-medium text-gray-900">{r.title}</div><div className="font-mono text-xs text-gray-400">{r.code}</div></> },
    { label: 'Description', render: (r) => r.description || '—', className: 'max-w-sm' },
    { label: 'Rule', render: (r) => <code className="text-xs text-gray-600">{JSON.stringify(r.criteria_json)}</code> },
  ],
  deleteWarning: <p>Reps who already earned this badge lose it.</p>,
};
