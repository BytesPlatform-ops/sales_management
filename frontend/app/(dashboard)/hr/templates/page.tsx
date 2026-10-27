'use client';

import { useState } from 'react';
import { Plus, Pencil, Trash2, LayoutTemplate, Copy, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import { PageHeader, Spinner, ErrorNote, Empty, Btn, Pill, inputCls } from '@/components/training/ui';
import { ProjectsPage, ProjectsProvider, SectionCard, Modal, Field, selectCls, useConfirm, useToast } from '@/components/projects/ui';
import { usePapi, papi, SERVICE_LABELS } from '@/components/projects/lib';
import { MarkdownEditor } from '@/components/tickets/MarkdownEditor';
import { TYPE_LABELS, TICKET_TYPES, TicketType } from '@/components/tickets/lib';
import { TypeBadge } from '@/components/tickets/bits';

// ------------------------------------------------------------------ types

interface TicketTemplate {
  id: number; project_id: number | null; name: string; type: TicketType; title_prefix: string; description: string;
  checklist: string[]; require_attachment: boolean; built_in: boolean;
}

interface TplTicket { title: string; type: string; checklist?: string[] }
interface TplEpic { title: string; color: string; tickets: TplTicket[] }
interface TplBody {
  epics: TplEpic[];
  milestones: { title: string; offset_days: number }[];
  vault_placeholders: { environment: string; key: string; note: string }[];
}
interface ProjectTemplate { id: number; name: string; service_type: string | null; description: string; body: Partial<TplBody>; built_in: boolean }

const ENVS = ['development', 'staging', 'production'];
const ENV_LABELS: Record<string, string> = { development: 'Development', staging: 'Staging', production: 'Production' };

function normBody(b: Partial<TplBody> | null | undefined): TplBody {
  return {
    epics: (b?.epics || []).map((e) => ({ title: e.title || '', color: e.color || '#6366f1', tickets: (e.tickets || []).map((t) => ({ ...t, type: t.type || 'task' })) })),
    milestones: (b?.milestones || []).map((m) => ({ title: m.title || '', offset_days: Number(m.offset_days) || 0 })),
    vault_placeholders: (b?.vault_placeholders || []).map((v) => ({ environment: v.environment || 'development', key: v.key || '', note: v.note || '' })),
  };
}

function counts(b: Partial<TplBody>) {
  const n = normBody(b);
  return {
    epics: n.epics.length,
    tickets: n.epics.reduce((s, e) => s + e.tickets.length, 0),
    milestones: n.milestones.length,
    vault: n.vault_placeholders.length,
  };
}

// ------------------------------------------------------------------ page

function Templates() {
  const { user } = useAuth();
  if (user && user.role !== 'hr') {
    return (
      <ProjectsPage>
        <PageHeader title="Templates" />
        <div className="rounded-2xl border border-gray-200 bg-white">
          <Empty icon={<LayoutTemplate className="h-6 w-6" />} title="HR only" body="Ask HR if a template needs changing." />
        </div>
      </ProjectsPage>
    );
  }
  return (
    <ProjectsPage>
      <PageHeader title="Templates" subtitle="Ticket templates prefill new tickets. Project templates add ready-made epics, tickets and milestones to a new project." />
      <div className="space-y-6">
        <TicketTemplates />
        <ProjectTemplates />
      </div>
    </ProjectsPage>
  );
}

export default function TemplatesPage() {
  return <ProjectsProvider><Templates /></ProjectsProvider>;
}

// ------------------------------------------------------------------ ticket templates

interface TtForm { id?: number; name: string; type: TicketType; title_prefix: string; description: string; checklist: string; require_attachment: boolean }
const EMPTY_TT: TtForm = { name: '', type: 'task', title_prefix: '', description: '', checklist: '', require_attachment: false };

function TicketTemplates() {
  const { data, error, isLoading, mutate } = usePapi<TicketTemplate[]>('/api/ticket-templates?all=1');
  const [form, setForm] = useState<TtForm | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const confirm = useConfirm();
  const toast = useToast();
  const list = (data || []).filter((t) => t.project_id === null);

  async function save() {
    if (!form) return;
    setErr(null); setSaving(true);
    const body = {
      name: form.name.trim(), type: form.type, title_prefix: form.title_prefix, description: form.description,
      checklist: form.checklist.split('\n').map((l) => l.trim()).filter(Boolean), require_attachment: form.require_attachment,
    };
    try {
      if (form.id) await papi(`/api/ticket-templates/${form.id}`, { method: 'PATCH', body });
      else await papi('/api/ticket-templates', { body });
      toast('Template saved');
      setForm(null);
      mutate();
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  }

  async function remove(t: TicketTemplate) {
    if (!(await confirm({ title: `Delete “${t.name}”?`, body: 'Existing tickets are not affected.', confirmLabel: 'Delete', danger: true }))) return;
    try { await papi(`/api/ticket-templates/${t.id}`, { method: 'DELETE' }); mutate(); toast('Deleted'); } catch (e) { toast((e as Error).message, 'error'); }
  }

  return (
    <SectionCard title="Ticket templates"
      action={<Btn size="sm" onClick={() => { setErr(null); setForm({ ...EMPTY_TT }); }}><Plus className="h-4 w-4" />New template</Btn>}>
      {error && <ErrorNote error={error} />}
      {isLoading && !data && <Spinner />}
      {data && !list.length && <p className="text-sm text-gray-500">No ticket templates yet.</p>}
      {list.length > 0 && (
        <ul className="-my-2 divide-y divide-gray-100">
          {list.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-gray-900">{t.name}</span>
                  <TypeBadge type={t.type} />
                  {t.built_in && <Pill tone="gray">Built-in</Pill>}
                  {t.require_attachment && <Pill tone="amber">Attachment required</Pill>}
                </div>
                <p className="mt-0.5 text-xs text-gray-500">
                  {t.checklist.length} checklist item{t.checklist.length === 1 ? '' : 's'}{t.title_prefix ? ` · titles start with “${t.title_prefix}”` : ''}
                </p>
              </div>
              <div className="flex gap-1">
                <IconBtn label={`Edit ${t.name}`} onClick={() => { setErr(null); setForm({ id: t.id, name: t.name, type: t.type, title_prefix: t.title_prefix, description: t.description, checklist: t.checklist.join('\n'), require_attachment: t.require_attachment }); }}><Pencil className="h-4 w-4" /></IconBtn>
                <IconBtn label={`Delete ${t.name}`} danger onClick={() => remove(t)}><Trash2 className="h-4 w-4" /></IconBtn>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal open={!!form} onClose={() => setForm(null)} size="lg" title={form?.id ? `Edit ${form.name || 'template'}` : 'New ticket template'}
        footer={<>
          <Btn variant="secondary" onClick={() => setForm(null)}>Cancel</Btn>
          <Btn onClick={save} disabled={saving || !form?.name.trim()}>{saving ? 'Saving…' : 'Save'}</Btn>
        </>}>
        {form && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Name *" htmlFor="tt-name">
                <input id="tt-name" className={inputCls} value={form.name} maxLength={100} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label="Ticket type" htmlFor="tt-type">
                <select id="tt-type" className={selectCls} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as TicketType })}>
                  {TICKET_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Title prefix" htmlFor="tt-prefix" hint="Optional, e.g. “Bug: ”">
              <input id="tt-prefix" className={inputCls} value={form.title_prefix} maxLength={100} onChange={(e) => setForm({ ...form, title_prefix: e.target.value })} />
            </Field>
            <Field label="Description" htmlFor="tt-desc" hint="Prefilled into new tickets — use headings the reporter fills in.">
              <MarkdownEditor id="tt-desc" value={form.description} onChange={(v) => setForm({ ...form, description: v })} rows={7} />
            </Field>
            <Field label="Checklist" htmlFor="tt-check" hint="One item per line.">
              <textarea id="tt-check" rows={4} className={inputCls} value={form.checklist} onChange={(e) => setForm({ ...form, checklist: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" className="h-4 w-4 rounded border-gray-300" checked={form.require_attachment} onChange={(e) => setForm({ ...form, require_attachment: e.target.checked })} />
              Require an attachment (screenshot or recording)
            </label>
            {err && <p className="text-sm text-red-600">{err}</p>}
          </div>
        )}
      </Modal>
    </SectionCard>
  );
}

// ------------------------------------------------------------------ project templates

interface PtForm { id?: number; name: string; service_type: string; description: string; body: TplBody }

function ProjectTemplates() {
  const { data, error, isLoading, mutate } = usePapi<ProjectTemplate[]>('/api/hr/project-templates');
  const [form, setForm] = useState<PtForm | null>(null);
  const [saveFrom, setSaveFrom] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const confirm = useConfirm();
  const toast = useToast();

  async function save() {
    if (!form) return;
    setErr(null); setSaving(true);
    const body = {
      name: form.name.trim(), service_type: form.service_type || null, description: form.description,
      body: {
        epics: form.body.epics.filter((e) => e.title.trim()).map((e) => ({ ...e, tickets: e.tickets.filter((t) => t.title.trim()) })),
        milestones: form.body.milestones.filter((m) => m.title.trim()),
        vault_placeholders: form.body.vault_placeholders.filter((v) => v.key.trim()),
      },
    };
    try {
      if (form.id) await papi(`/api/hr/project-templates/${form.id}`, { method: 'PATCH', body });
      else await papi('/api/hr/project-templates', { body });
      toast('Template saved');
      setForm(null);
      mutate();
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  }

  async function remove(t: ProjectTemplate) {
    if (!(await confirm({ title: `Delete “${t.name}”?`, body: 'Projects already created from it are not affected.', confirmLabel: 'Delete', danger: true }))) return;
    try { await papi(`/api/hr/project-templates/${t.id}`, { method: 'DELETE' }); mutate(); toast('Deleted'); } catch (e) { toast((e as Error).message, 'error'); }
  }

  return (
    <SectionCard title="Project templates"
      action={
        <div className="flex flex-wrap gap-2">
          <Btn size="sm" variant="secondary" onClick={() => setSaveFrom(true)}><Copy className="h-4 w-4" />Save a project as template</Btn>
          <Btn size="sm" onClick={() => { setErr(null); setForm({ name: '', service_type: '', description: '', body: normBody(null) }); }}><Plus className="h-4 w-4" />New template</Btn>
        </div>
      }>
      {error && <ErrorNote error={error} />}
      {isLoading && !data && <Spinner />}
      {data && !data.length && <p className="text-sm text-gray-500">No project templates yet.</p>}
      {data && data.length > 0 && (
        <ul className="-my-2 divide-y divide-gray-100">
          {data.map((t) => {
            const c = counts(t.body);
            return (
              <li key={t.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gray-900">{t.name}</span>
                    {t.service_type && <Pill tone="blue">{SERVICE_LABELS[t.service_type] || t.service_type}</Pill>}
                    {t.built_in && <Pill tone="gray">Built-in</Pill>}
                  </div>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {c.epics} epics · {c.tickets} tickets · {c.milestones} milestones · {c.vault} vault placeholders
                    {t.description ? ` — ${t.description}` : ''}
                  </p>
                </div>
                <div className="flex gap-1">
                  <IconBtn label={`Edit ${t.name}`} onClick={() => { setErr(null); setForm({ id: t.id, name: t.name, service_type: t.service_type || '', description: t.description, body: normBody(t.body) }); }}><Pencil className="h-4 w-4" /></IconBtn>
                  <IconBtn label={`Delete ${t.name}`} danger onClick={() => remove(t)}><Trash2 className="h-4 w-4" /></IconBtn>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Modal open={!!form} onClose={() => setForm(null)} size="lg" title={form?.id ? `Edit ${form.name || 'template'}` : 'New project template'}
        footer={<>
          <Btn variant="secondary" onClick={() => setForm(null)}>Cancel</Btn>
          <Btn onClick={save} disabled={saving || !form?.name.trim()}>{saving ? 'Saving…' : 'Save'}</Btn>
        </>}>
        {form && <ProjectTemplateEditor form={form} setForm={setForm} />}
        {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      </Modal>

      <SaveFromProject open={saveFrom} onClose={() => setSaveFrom(false)} onSaved={() => { setSaveFrom(false); mutate(); }} />
    </SectionCard>
  );
}

function ProjectTemplateEditor({ form, setForm }: { form: PtForm; setForm: (f: PtForm) => void }) {
  const b = form.body;
  const setBody = (patch: Partial<TplBody>) => setForm({ ...form, body: { ...b, ...patch } });
  const setEpic = (i: number, patch: Partial<TplEpic>) => setBody({ epics: b.epics.map((e, j) => (j === i ? { ...e, ...patch } : e)) });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name *" htmlFor="pt-name">
          <input id="pt-name" className={inputCls} value={form.name} maxLength={100} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Service" htmlFor="pt-service">
          <select id="pt-service" className={selectCls} value={form.service_type} onChange={(e) => setForm({ ...form, service_type: e.target.value })}>
            <option value="">Any</option>
            {Object.entries(SERVICE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Description" htmlFor="pt-desc">
        <input id="pt-desc" className={inputCls} value={form.description} maxLength={2000} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </Field>

      {/* Epics with their tickets */}
      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm font-semibold text-gray-800">Epics and tickets</legend>
        {b.epics.map((e, i) => (
          <div key={i} className="rounded-xl border border-gray-200 p-3">
            <div className="flex items-center gap-2">
              <input type="color" aria-label="Epic colour" value={e.color} onChange={(ev) => setEpic(i, { color: ev.target.value })} className="h-8 w-9 cursor-pointer rounded border border-gray-300" />
              <input aria-label="Epic title" className={cn(inputCls, 'flex-1')} placeholder="Epic title" value={e.title} onChange={(ev) => setEpic(i, { title: ev.target.value })} />
              <RemoveBtn label="Remove epic" onClick={() => setBody({ epics: b.epics.filter((_, j) => j !== i) })} />
            </div>
            <ul className="mt-2 space-y-1.5 pl-2">
              {e.tickets.map((t, k) => (
                <li key={k} className="flex items-center gap-2">
                  <input aria-label="Ticket title" className={cn(inputCls, 'flex-1 py-1.5')} placeholder="Ticket title" value={t.title}
                    onChange={(ev) => setEpic(i, { tickets: e.tickets.map((x, m) => (m === k ? { ...x, title: ev.target.value } : x)) })} />
                  <select aria-label="Ticket type" className={cn(selectCls, 'w-40 py-1.5')} value={t.type}
                    onChange={(ev) => setEpic(i, { tickets: e.tickets.map((x, m) => (m === k ? { ...x, type: ev.target.value } : x)) })}>
                    {TICKET_TYPES.map((ty) => <option key={ty} value={ty}>{TYPE_LABELS[ty]}</option>)}
                  </select>
                  <RemoveBtn label="Remove ticket" onClick={() => setEpic(i, { tickets: e.tickets.filter((_, m) => m !== k) })} />
                </li>
              ))}
            </ul>
            <button type="button" className="mt-2 pl-2 text-xs font-medium text-primary-600 hover:underline"
              onClick={() => setEpic(i, { tickets: [...e.tickets, { title: '', type: 'task' }] })}>+ Add ticket</button>
          </div>
        ))}
        <Btn size="sm" variant="secondary" onClick={() => setBody({ epics: [...b.epics, { title: '', color: '#6366f1', tickets: [] }] })}><Plus className="h-4 w-4" />Add epic</Btn>
      </fieldset>

      {/* Milestones */}
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-semibold text-gray-800">Milestones <span className="font-normal text-gray-500">(days after the work start date)</span></legend>
        {b.milestones.map((m, i) => (
          <div key={i} className="flex items-center gap-2">
            <input aria-label="Milestone title" className={cn(inputCls, 'flex-1')} placeholder="Milestone" value={m.title}
              onChange={(e) => setBody({ milestones: b.milestones.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} />
            <input aria-label="Days after start" type="number" min={0} max={3650} className={cn(inputCls, 'w-24')} value={m.offset_days}
              onChange={(e) => setBody({ milestones: b.milestones.map((x, j) => (j === i ? { ...x, offset_days: Number(e.target.value) || 0 } : x)) })} />
            <span className="text-xs text-gray-500">days</span>
            <RemoveBtn label="Remove milestone" onClick={() => setBody({ milestones: b.milestones.filter((_, j) => j !== i) })} />
          </div>
        ))}
        <Btn size="sm" variant="secondary" onClick={() => setBody({ milestones: [...b.milestones, { title: '', offset_days: 7 }] })}><Plus className="h-4 w-4" />Add milestone</Btn>
      </fieldset>

      {/* Vault placeholders */}
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-semibold text-gray-800">Env placeholders <span className="font-normal text-gray-500">(empty values the team fills in)</span></legend>
        {b.vault_placeholders.map((v, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select aria-label="Environment" className={cn(selectCls, 'w-36')} value={v.environment}
              onChange={(e) => setBody({ vault_placeholders: b.vault_placeholders.map((x, j) => (j === i ? { ...x, environment: e.target.value } : x)) })}>
              {ENVS.map((e) => <option key={e} value={e}>{ENV_LABELS[e]}</option>)}
            </select>
            <input aria-label="Key" className={cn(inputCls, 'w-48 font-mono')} placeholder="KEY_NAME" value={v.key}
              onChange={(e) => setBody({ vault_placeholders: b.vault_placeholders.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)) })} />
            <input aria-label="Note" className={cn(inputCls, 'min-w-[8rem] flex-1')} placeholder="Note, e.g. Waiting on client" value={v.note}
              onChange={(e) => setBody({ vault_placeholders: b.vault_placeholders.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)) })} />
            <RemoveBtn label="Remove placeholder" onClick={() => setBody({ vault_placeholders: b.vault_placeholders.filter((_, j) => j !== i) })} />
          </div>
        ))}
        <Btn size="sm" variant="secondary" onClick={() => setBody({ vault_placeholders: [...b.vault_placeholders, { environment: 'development', key: '', note: '' }] })}><Plus className="h-4 w-4" />Add placeholder</Btn>
      </fieldset>
    </div>
  );
}

function SaveFromProject({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { data } = usePapi<{ projects: { id: number; ticket_no: string; title: string; client_name: string }[] }>(open ? '/api/projects?view=all' : null);
  const projects = data?.projects;
  const [projectId, setProjectId] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  async function save() {
    setErr(null); setSaving(true);
    try {
      await papi('/api/hr/project-templates', { body: { name: name.trim(), from_project_id: Number(projectId) } });
      toast('Template saved');
      setProjectId(''); setName('');
      onSaved();
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Save a project as template"
      footer={<>
        <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
        <Btn onClick={save} disabled={saving || !projectId || !name.trim()}>{saving ? 'Saving…' : 'Save template'}</Btn>
      </>}>
      <div className="space-y-3">
        <Field label="Project" htmlFor="sf-project" hint="Copies its epics, tickets (with checklists), milestones and env key names — never env values.">
          <select id="sf-project" className={selectCls} value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              const p = projects?.find((x) => String(x.id) === e.target.value);
              if (p && !name) setName(p.title);
            }}>
            <option value="">Pick a project…</option>
            {(projects || []).map((p) => <option key={p.id} value={p.id}>{p.ticket_no} — {p.title}</option>)}
          </select>
        </Field>
        <Field label="Template name" htmlFor="sf-name">
          <input id="sf-name" className={inputCls} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
        </Field>
        {err && <p className="text-sm text-red-600">{err}</p>}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ small bits

function IconBtn({ children, label, onClick, danger }: { children: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}
      className={cn('rounded-lg p-1.5 text-gray-500 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
        danger ? 'hover:bg-red-50 hover:text-red-600' : 'hover:bg-gray-100 hover:text-gray-800')}>
      {children}
    </button>
  );
}

function RemoveBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600">
      <X className="h-4 w-4" />
    </button>
  );
}
