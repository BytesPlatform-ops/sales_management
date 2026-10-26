'use client';

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, UserCheck, Receipt, Target, X } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';
import { PageHeader, Spinner, ErrorNote, Btn, inputCls, Empty } from '@/components/training/ui';
import { ProjectsPage, Field, SectionCard, selectCls, useToast } from '@/components/projects/ui';
import { usePapi, papi, SERVICE_LABELS, PRIORITY_LABELS, TIMEZONES, RECURRENCE_LABELS, fmtDay, fmtMoney, fmtInTz, tzAbbr } from '@/components/projects/lib';

interface SourceLead {
  id: number; firm_name: string | null; contact_person: string | null; phone_number: string | null; state: string | null;
  email: string | null; website: string | null; pipeline_stage: string | null; deal_value: string | null; notes: string | null;
  agent_name: string | null; existing_ticket: string | null;
}
interface SourceSale {
  id: string; customer_name: string; total_deal_value: number; amount_collected: number; status: string; approval_status: string;
  created_at: string; agent_name: string | null; existing_ticket: string | null;
}

// Rough US state → time zone guess for prefilling (agent can change it).
const STATE_TZ: Record<string, string> = {
  CA: 'America/Los_Angeles', WA: 'America/Los_Angeles', OR: 'America/Los_Angeles', NV: 'America/Los_Angeles',
  AZ: 'America/Phoenix', CO: 'America/Denver', UT: 'America/Denver', NM: 'America/Denver', MT: 'America/Denver', WY: 'America/Denver', ID: 'America/Denver',
  TX: 'America/Chicago', IL: 'America/Chicago', MN: 'America/Chicago', WI: 'America/Chicago', MO: 'America/Chicago', IA: 'America/Chicago',
  LA: 'America/Chicago', OK: 'America/Chicago', KS: 'America/Chicago', NE: 'America/Chicago', AR: 'America/Chicago', MS: 'America/Chicago',
  AL: 'America/Chicago', TN: 'America/Chicago', ND: 'America/Chicago', SD: 'America/Chicago',
};

const EMPTY = {
  title: '', client_name: '', client_company: '', client_email: '', client_phone: '', client_timezone: 'America/New_York',
  service_type: 'website_new', priority: 'normal', deal_value: '', description: '', expected_delivery: '', start_date: '',
  project_type: 'one_time' as 'one_time' | 'recurring', recurrence: 'monthly', recurrence_end: '',
};

export default function NewProjectPage() {
  return (
    <Suspense fallback={<ProjectsPage><Spinner /></ProjectsPage>}>
      <NewProjectForm />
    </Suspense>
  );
}

function NewProjectForm() {
  const { user } = useAuth();
  const router = useRouter();
  const sp = useSearchParams();
  const toast = useToast();
  const { data: sources, error: sourcesError, isLoading: sourcesLoading } = usePapi<{ leads: SourceLead[]; sales: SourceSale[] }>(
    user && user.role !== 'developer' ? '/api/projects/sources' : null
  );
  const [form, setForm] = useState(EMPTY);
  const [source, setSource] = useState<{ kind: 'lead' | 'sale'; id: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const preselected = useRef(false);

  const set = <K extends keyof typeof EMPTY>(k: K, v: (typeof EMPTY)[K]) => setForm((f) => ({ ...f, [k]: v }));

  // Lead ids are numbers and sale ids are UUIDs, so ids are compared as strings.
  const pick = (kind: 'lead' | 'sale', id: string) => {
    if (!sources) return;
    if (kind === 'lead') {
      const l = sources.leads.find((x) => String(x.id) === id);
      if (!l) return;
      setSource({ kind, id });
      setForm((f) => ({
        ...f,
        title: f.title || `${SERVICE_LABELS[f.service_type]} — ${l.firm_name || l.contact_person || 'client'}`,
        client_name: l.contact_person || l.firm_name || '',
        client_company: l.firm_name || '',
        client_email: l.email || '',
        client_phone: l.phone_number || '',
        client_timezone: (l.state && STATE_TZ[l.state.toUpperCase()]) || 'America/New_York',
        deal_value: l.deal_value ? String(Number(l.deal_value)) : f.deal_value,
        description: f.description || l.notes || '',
      }));
    } else {
      const s = sources.sales.find((x) => String(x.id) === id);
      if (!s) return;
      setSource({ kind, id });
      setForm((f) => ({
        ...f,
        title: f.title || `${SERVICE_LABELS[f.service_type]} — ${s.customer_name}`,
        client_name: s.customer_name,
        deal_value: s.total_deal_value ? String(s.total_deal_value) : f.deal_value,
      }));
    }
  };

  // ?lead_id= / ?sale_id= preselect once sources load.
  useEffect(() => {
    if (!sources || preselected.current) return;
    preselected.current = true;
    const lead = sp.get('lead_id');
    const sale = sp.get('sale_id');
    if (lead) pick('lead', lead);
    else if (sale) pick('sale', sale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources]);

  const chosen = useMemo(() => {
    if (!source || !sources) return null;
    return source.kind === 'lead' ? sources.leads.find((l) => String(l.id) === source.id) : sources.sales.find((s) => String(s.id) === source.id);
  }, [source, sources]);

  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.title.trim()) errs.title = 'Give the project a short title';
    if (!form.client_name.trim()) errs.client_name = 'Client name is required';
    if (form.client_email && !/^\S+@\S+\.\S+$/.test(form.client_email)) errs.client_email = 'That doesn’t look like an email address';
    if (form.start_date && form.expected_delivery && form.start_date > form.expected_delivery) errs.expected_delivery = 'Delivery is before the start date';
    if (form.project_type === 'recurring' && form.recurrence_end && form.start_date && form.recurrence_end < form.start_date) errs.recurrence_end = '“Repeat until” is before the start date';
    setErrors(errs);
    if (Object.keys(errs).length) {
      document.getElementById(`f-${Object.keys(errs)[0]}`)?.focus();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        ...form,
        title: form.title.trim(),
        deal_value: form.deal_value ? Number(form.deal_value) : null,
        lead_id: source?.kind === 'lead' ? Number(source.id) : undefined,
        sale_id: source?.kind === 'sale' ? source.id : undefined,
        recurrence: form.project_type === 'recurring' ? form.recurrence : undefined,
        recurrence_end: form.project_type === 'recurring' ? form.recurrence_end || null : undefined,
      };
      const p = await papi<{ id: number; ticket_no: string }>('/api/projects', { body });
      toast(`Ticket ${p.ticket_no} opened`);
      router.push(`/projects/${p.id}`);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  if (user?.role === 'developer') {
    return (
      <ProjectsPage>
        <PageHeader title="New ticket" back={{ href: '/projects', label: 'Projects' }} />
        <div className="bg-white rounded-2xl border border-gray-200">
          <Empty title="Developers don’t open tickets" body="Tickets are opened by the agent who converted the client, or by HR." />
        </div>
      </ProjectsPage>
    );
  }

  const leads = sources?.leads || [];
  const sales = sources?.sales || [];
  const err = (k: string) => errors[k] && <p className="mt-1 text-xs text-red-600" id={`e-${k}`}>{errors[k]}</p>;
  const aria = (k: string) => ({ id: `f-${k}`, 'aria-invalid': !!errors[k] || undefined, 'aria-describedby': errors[k] ? `e-${k}` : undefined });

  return (
    <ProjectsPage className="max-w-3xl">
      <PageHeader title="Open a project ticket" subtitle="Hand a converted client over to the development team. HR assigns developers and sets the dates." back={{ href: '/projects', label: 'Projects' }} />

      <form onSubmit={submit} className="space-y-5" noValidate>
        <SectionCard title="Converting a client?">
          {sourcesLoading ? <Spinner label="Loading your clients…" /> : sourcesError ? <ErrorNote error={sourcesError} /> : (leads.length + sales.length === 0) ? (
            <p className="text-sm text-gray-500">No interested pipeline leads or logged sales to pick from. Fill in the client below.</p>
          ) : (
            <div className="space-y-3">
              <Field label="Pick from your Pipeline or Sales to prefill the client" htmlFor="f-source">
                <select id="f-source" className={selectCls} value={source ? `${source.kind}:${source.id}` : ''}
                  onChange={(e) => {
                    const [k, id] = e.target.value.split(':');
                    if (!k) { setSource(null); return; }
                    pick(k as 'lead' | 'sale', id);
                  }}>
                  <option value="">— Not from a lead or sale —</option>
                  {leads.length > 0 && (
                    <optgroup label="Pipeline (interested leads)">
                      {leads.map((l) => (
                        <option key={`l${l.id}`} value={`lead:${l.id}`}>
                          {l.firm_name || l.contact_person}{l.contact_person && l.firm_name ? ` — ${l.contact_person}` : ''}{l.deal_value ? ` · ${fmtMoney(l.deal_value)}` : ''}{l.existing_ticket ? ` (has ${l.existing_ticket})` : ''}{user?.role === 'hr' && l.agent_name ? ` · ${l.agent_name}` : ''}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {sales.length > 0 && (
                    <optgroup label="Sales you logged">
                      {sales.map((s) => (
                        <option key={`s${s.id}`} value={`sale:${s.id}`}>
                          {s.customer_name} · {fmtMoney(s.total_deal_value)} · {fmtDay(s.created_at)}{s.existing_ticket ? ` (has ${s.existing_ticket})` : ''}{user?.role === 'hr' && s.agent_name ? ` · ${s.agent_name}` : ''}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </Field>
              {chosen && (
                <div className="flex items-start gap-3 rounded-xl border border-primary-100 bg-primary-50 px-4 py-3 text-sm">
                  {source?.kind === 'lead' ? <Target className="h-4 w-4 mt-0.5 text-primary-600 shrink-0" /> : <Receipt className="h-4 w-4 mt-0.5 text-primary-600 shrink-0" />}
                  <div className="min-w-0 flex-1 text-primary-900">
                    <div className="font-medium">Linked to {source?.kind === 'lead' ? 'pipeline lead' : 'sale'}: {'firm_name' in chosen ? chosen.firm_name || chosen.contact_person : chosen.customer_name}</div>
                    <div className="text-primary-800/80">Client details below were filled in for you — check them before opening the ticket.</div>
                  </div>
                  <button type="button" onClick={() => setSource(null)} className="rounded p-1 text-primary-700 hover:bg-primary-100" aria-label="Unlink"><X className="h-4 w-4" /></button>
                </div>
              )}
              {chosen?.existing_ticket && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>This client already has ticket <strong>{chosen.existing_ticket}</strong>. Only open another one for separate, new work (e.g. an extra service). Otherwise, post in the existing ticket.</span>
                </div>
              )}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Project">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Title *" htmlFor="f-title" className="sm:col-span-2" hint="What are we building? e.g. “New website + online booking”">
              <input {...aria('title')} className={inputCls} value={form.title} onChange={(e) => set('title', e.target.value)} maxLength={200} required />
              {err('title')}
            </Field>
            <Field label="Service" htmlFor="f-service_type">
              <select id="f-service_type" className={selectCls} value={form.service_type} onChange={(e) => set('service_type', e.target.value)}>
                {Object.entries(SERVICE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Priority" htmlFor="f-priority">
              <select id="f-priority" className={selectCls} value={form.priority} onChange={(e) => set('priority', e.target.value)}>
                {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Deal value (USD)" htmlFor="f-deal_value">
              <input id="f-deal_value" type="number" min="0" step="0.01" inputMode="decimal" className={inputCls} value={form.deal_value} onChange={(e) => set('deal_value', e.target.value)} placeholder="0" />
            </Field>
            <Field label="Brief for the team" htmlFor="f-description" className="sm:col-span-2" hint="Posted as the first message in the project thread. What did the client ask for? Any must-haves, logins, examples they like?">
              <textarea id="f-description" rows={5} className={inputCls} value={form.description} onChange={(e) => set('description', e.target.value)} />
            </Field>
          </div>
        </SectionCard>

        <SectionCard title="Client">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Client name *" htmlFor="f-client_name">
              <input {...aria('client_name')} className={inputCls} value={form.client_name} onChange={(e) => set('client_name', e.target.value)} autoComplete="off" required />
              {err('client_name')}
            </Field>
            <Field label="Company" htmlFor="f-client_company">
              <input id="f-client_company" className={inputCls} value={form.client_company} onChange={(e) => set('client_company', e.target.value)} autoComplete="off" />
            </Field>
            <Field label="Email" htmlFor="f-client_email">
              <input {...aria('client_email')} type="email" className={inputCls} value={form.client_email} onChange={(e) => set('client_email', e.target.value)} autoComplete="off" />
              {err('client_email')}
            </Field>
            <Field label="Phone" htmlFor="f-client_phone">
              <input id="f-client_phone" type="tel" className={inputCls} value={form.client_phone} onChange={(e) => set('client_phone', e.target.value)} autoComplete="off" />
            </Field>
            <Field label="Client’s time zone" htmlFor="f-client_timezone" className="sm:col-span-2"
              hint={<>Client’s time now: <strong>{fmtInTz(now, form.client_timezone, { date: false, zone: false })} {tzAbbr(form.client_timezone, now)}</strong> · Pakistan: {fmtInTz(now, 'Asia/Karachi', { date: false, zone: false })} PKT. Meetings are scheduled in this zone.</>}>
              <select id="f-client_timezone" className={selectCls} value={form.client_timezone} onChange={(e) => set('client_timezone', e.target.value)}>
                {TIMEZONES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>
          </div>
        </SectionCard>

        <SectionCard title="Schedule">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Work start date" htmlFor="f-start_date" hint="Optional — HR can set it later.">
              <input id="f-start_date" type="date" className={inputCls} value={form.start_date} onChange={(e) => set('start_date', e.target.value)} />
            </Field>
            <Field label="Expected delivery to client" htmlFor="f-expected_delivery" hint="The date you promised the client, if any.">
              <input {...aria('expected_delivery')} type="date" className={inputCls} value={form.expected_delivery} onChange={(e) => set('expected_delivery', e.target.value)} />
              {err('expected_delivery')}
            </Field>
            <fieldset className="sm:col-span-2">
              <legend className="block text-sm font-medium text-gray-700 mb-1">Type of work</legend>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {([['one_time', 'One-time', 'Built once and delivered (e.g. a new website).'], ['recurring', 'Recurring', 'Repeats every period with its own deadline (e.g. monthly SEO or social media).']] as const).map(([v, label, help]) => (
                  <label key={v} className={cn('flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2.5 text-sm focus-within:ring-2 focus-within:ring-primary-500',
                    form.project_type === v ? 'border-primary-400 bg-primary-50' : 'border-gray-200 hover:bg-gray-50')}>
                    <input type="radio" name="project_type" value={v} checked={form.project_type === v} onChange={() => set('project_type', v)} className="mt-0.5" />
                    <span><span className="font-medium text-gray-900">{label}</span><span className="block text-xs text-gray-500">{help}</span></span>
                  </label>
                ))}
              </div>
            </fieldset>
            {form.project_type === 'recurring' && (
              <>
                <Field label="Repeats" htmlFor="f-recurrence" hint="Each period is a “cycle” with its own deadline. The first cycle starts on the work start date (or today).">
                  <select id="f-recurrence" className={selectCls} value={form.recurrence} onChange={(e) => set('recurrence', e.target.value)}>
                    {Object.entries(RECURRENCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </Field>
                <Field label="Repeat until (optional)" htmlFor="f-recurrence_end" hint="Leave empty to keep going until the project is closed.">
                  <input {...aria('recurrence_end')} type="date" className={inputCls} value={form.recurrence_end} onChange={(e) => set('recurrence_end', e.target.value)} />
                  {err('recurrence_end')}
                </Field>
              </>
            )}
          </div>
        </SectionCard>

        <ErrorNote error={error} />
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <Link href="/projects" className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</Link>
          <Btn type="submit" disabled={saving}><UserCheck className="h-4 w-4" />{saving ? 'Opening ticket…' : 'Open ticket'}</Btn>
        </div>
      </form>
    </ProjectsPage>
  );
}
