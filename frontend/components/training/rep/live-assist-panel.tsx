'use client';

/**
 * Live Assist (E.7 / E.8 / C3.2 / E.11): the side panel a rep keeps open while
 * dialing. Talking points from the narrative, a website scan, a service
 * recommendation, and a follow-up email after a voicemail. Every action works
 * without AI (keyword rules + deterministic checks) and shows the banner then.
 */
import { ReactNode, useEffect, useState } from 'react';
import {
  CheckCircle2, AlertTriangle, HelpCircle, ChevronDown, Copy, Check, Globe, Lightbulb, Mail, MessageSquareText, RefreshCw, Compass, ListChecks, Loader2,
} from 'lucide-react';
import { tapi, SERVICE_LABELS } from '@/lib/training/client';
import { Btn, ErrorNote, Pill, StandardModeBanner, inputCls } from '@/components/training/ui';
import { cn } from '@/lib/utils';

export interface AssistLead { id?: number; firm_name?: string | null; narrative?: string | null; website?: string | null; state?: string | null; city_state?: string | null }

const ANSWER_TOGGLES: { id: string; label: string; hint: string }[] = [
  { id: 'missed_calls_pain', label: 'Misses calls / scheduling pain', hint: '“We miss calls when we are on site.”' },
  { id: 'bids_often', label: 'Bids on lots of contracts', hint: 'Many solicitations a month' },
  { id: 'bd_staff', label: 'Has BD / proposal staff', hint: 'Someone whose job is bidding' },
  { id: 'hiring', label: 'Hiring right now', hint: 'Looking for staff' },
  { id: 'private_customers', label: 'Has private / local customers', hint: 'Not only government work' },
  { id: 'pure_federal', label: 'Pure federal (no private work)', hint: '100% government' },
];

const DIAL_STEPS = [
  'Glance (10 seconds): firm name + capabilities narrative + city/state. Make a one-line guess.',
  'Dial. Don’t research first — most dials don’t connect.',
  'While it rings: open the website (or note “NO SITE”).',
  'Scan for up to 30 seconds with the checklist while it rings or during the gatekeeper.',
  'Voicemail? Use the voicemail script, log VM, and note one website observation (for the follow-up email).',
  'Connected? Use one live observation as a question — never as criticism.',
];

const CHECKLIST: { look: string; say: string }[] = [
  { look: 'Address bar says “Not secure” / no padlock', say: "I noticed Chrome flags your site as 'Not secure.' Has anyone mentioned that to you?" },
  { look: 'Footer © year is 2021 or older', say: 'Looks like the site was last refreshed a few years back. Is that on your list?' },
  { look: 'Tiny text or broken menu on a phone', say: "On a phone your site's a bit hard to read. Do primes ever look you up on mobile?" },
  { look: 'No capability statement, NAICS, CAGE or certifications', say: 'When a CO or prime looks you up, where do they find your capability statement?' },
  { look: 'No social icons, or last post is old', say: 'Do you do anything on social, or is that not a priority?' },
  { look: 'No blog / news / case studies', say: 'Is the site bringing in any private-sector work right now?' },
  { look: 'Looks like a template (Wix, GoDaddy…)', say: 'Did someone build it for you, or was it a template?' },
  { look: 'Takes more than ~3 seconds to load', say: 'It took a while to load on my end. Has that come up before?' },
  { look: 'No contact form, only a phone number', say: 'How do new customers usually reach you, phone or email?' },
  { look: 'No website at all', say: "I couldn't find a website for you. Is that intentional, or just hasn't been a priority?" },
];

function serviceLabel(v?: string | null) {
  return v ? SERVICE_LABELS[v] || v.replace(/_/g, ' ') : '—';
}

function Section({ title, icon, children, defaultOpen = true, compact, right, openSignal }: { title: string; icon: ReactNode; children: ReactNode; defaultOpen?: boolean; compact?: boolean; right?: ReactNode; openSignal?: number }) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => { if (openSignal) setOpen(true); }, [openSignal]);
  return (
    <section className="bg-white rounded-2xl border border-gray-200 shadow-sm">
      <div className={cn('flex items-center justify-between gap-2', compact ? 'px-4 py-2.5' : 'px-5 py-3')}>
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
          className="flex flex-1 items-center gap-2 text-left text-sm font-semibold text-gray-900 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
          <span className="text-primary-600">{icon}</span>{title}
          <ChevronDown className={cn('ml-auto h-4 w-4 text-gray-400 transition-transform', open && 'rotate-180')} aria-hidden />
        </button>
        {right}
      </div>
      {open && <div className={cn('border-t border-gray-100', compact ? 'p-4' : 'p-5')}>{children}</div>}
    </section>
  );
}

export function LiveAssistPanel({ initialLead, compact = false }: { initialLead?: AssistLead | null; compact?: boolean }) {
  const [firm, setFirm] = useState(initialLead?.firm_name || '');
  const [narrative, setNarrative] = useState(initialLead?.narrative || '');
  const [website, setWebsite] = useState(initialLead?.website || '');
  const [state, setState] = useState(initialLead?.state || '');
  const [cityState, setCityState] = useState(initialLead?.city_state || '');
  const [loadingLead, setLoadingLead] = useState(false);
  const [leadNote, setLeadNote] = useState<string | null>(null);

  const [pitch, setPitch] = useState<any>(null);
  const [scan, setScan] = useState<any>(null);
  const [rec, setRec] = useState<any>(null);
  const [answers, setAnswers] = useState<string[]>([]);
  const [email, setEmail] = useState<{ subject: string; body: string; ai_used?: boolean; ai_message?: string | null } | null>(null);
  const [observation, setObservation] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, unknown>>({});
  const [copied, setCopied] = useState(false);
  const [emailSignal, setEmailSignal] = useState(0);

  const loadLead = async () => {
    setLoadingLead(true);
    setLeadNote(null);
    try {
      const l = await tapi<AssistLead | null>('/assist/lead');
      if (!l) setLeadNote('No current lead found in My Leads — paste the row below.');
      else {
        setFirm(l.firm_name || '');
        setNarrative(l.narrative || '');
        setWebsite(l.website || '');
        setState(l.state || '');
        setCityState(l.city_state || '');
        setPitch(null); setScan(null); setRec(null); setEmail(null);
      }
    } catch (e) {
      setLeadNote(e instanceof Error ? e.message : 'Could not load your lead');
    } finally {
      setLoadingLead(false);
    }
  };

  useEffect(() => {
    if (!initialLead) loadLead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setErrors((e) => ({ ...e, [key]: null }));
    try { await fn(); } catch (e) { setErrors((x) => ({ ...x, [key]: e })); } finally { setBusy(null); }
  };

  const scanFlags: string[] = scan?.flags || [];

  const getPitch = () => run('pitch', async () => {
    setPitch(await tapi('/assist/pitch', { body: { capabilities_narrative: narrative, firm, state, flags: scanFlags } }));
  });
  const doScan = () => run('scan', async () => {
    const r = await tapi<any>('/assist/site-scan', { body: { url: website.trim() } });
    setScan(r);
    const issue = (r.checks || []).find((c: any) => c.status === 'issue');
    if (issue && !observation) setObservation(issue.id === 'no_site' ? 'there is no website listed' : String(issue.detail || issue.label).replace(/^./, (c: string) => c.toLowerCase()));
  });
  const recommend = () => run('rec', async () => {
    setRec(await tapi('/assist/classify', { body: { lead_row: { narrative }, flags: scanFlags, answers } }));
  });
  const draft = () => run('email', async () => {
    setEmail(await tapi('/assist/email', { body: { company: firm, observation } }));
    setCopied(false);
  });

  const copyEmail = async () => {
    if (!email) return;
    try {
      await navigator.clipboard.writeText(`Subject: ${email.subject}\n\n${email.body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked */ }
  };

  const standardMsgs = [pitch, scan, email].filter((x) => x && x.ai_used === false && x.ai_message).map((x) => x.ai_message);
  const banner = standardMsgs[0] || null;

  const leadForm = (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-gray-500">{cityState || state ? `${cityState || state}` : 'Edit anything that looks wrong.'}</span>
        <Btn size="sm" variant="ghost" className="whitespace-nowrap shrink-0" onClick={loadLead} disabled={loadingLead}><RefreshCw className={cn('h-3.5 w-3.5', loadingLead && 'animate-spin')} aria-hidden /> My current lead</Btn>
      </div>
      {leadNote && <p className="text-xs text-amber-700">{leadNote}</p>}
      <div className={cn('grid gap-3', !compact && 'sm:grid-cols-3')}>
        <div className={cn(!compact && 'sm:col-span-2')}>
          <label htmlFor="la-firm" className="block text-xs font-medium text-gray-600 mb-1">Firm name</label>
          <input id="la-firm" className={inputCls} value={firm} onChange={(e) => setFirm(e.target.value)} placeholder="e.g. Gulf Coast Duct & Air" />
        </div>
        <div>
          <label htmlFor="la-state" className="block text-xs font-medium text-gray-600 mb-1">State</label>
          <input id="la-state" className={inputCls} value={state} onChange={(e) => setState(e.target.value)} placeholder="TX" />
        </div>
      </div>
      <div>
        <label htmlFor="la-narr" className="block text-xs font-medium text-gray-600 mb-1">Capabilities narrative (from SAM.gov)</label>
        <textarea id="la-narr" rows={compact ? 3 : 4} className={inputCls} value={narrative} onChange={(e) => setNarrative(e.target.value)} placeholder="Paste the Capabilities Narrative…" />
      </div>
      <div>
        <label htmlFor="la-web" className="block text-xs font-medium text-gray-600 mb-1">Website (leave blank if none)</label>
        <input id="la-web" className={inputCls} value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="example.com" />
      </div>
    </div>
  );

  const actions = (
    <div className="grid grid-cols-2 gap-2">
      <ActionBtn onClick={getPitch} busy={busy === 'pitch'} disabled={!narrative.trim()} icon={<MessageSquareText className="h-4 w-4" aria-hidden />} label="Talking points" />
      <ActionBtn onClick={doScan} busy={busy === 'scan'} icon={<Globe className="h-4 w-4" aria-hidden />} label={website.trim() ? 'Scan website' : 'No site? Log it'} />
      <ActionBtn onClick={recommend} busy={busy === 'rec'} icon={<Compass className="h-4 w-4" aria-hidden />} label="Recommend service" />
      <ActionBtn onClick={() => { setEmailSignal((n) => n + 1); setTimeout(() => document.getElementById('la-email')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); }} icon={<Mail className="h-4 w-4" aria-hidden />} label="Follow-up email" />
    </div>
  );

  const results = (
    <div className="space-y-4">
      <StandardModeBanner message={banner} />

      {(pitch || errors.pitch) && (
        <Section title="Talking points" icon={<MessageSquareText className="h-4 w-4" />} compact={compact}
          right={pitch ? <span className="flex gap-1">{pitch.cached && <Pill tone="gray">cached</Pill>}<Pill tone={pitch.ai_used ? 'violet' : 'gray'}>{pitch.ai_used ? 'AI' : 'rules'}</Pill></span> : undefined}>
          <ErrorNote error={errors.pitch} />
          {pitch && (
            <div className="space-y-3 text-sm">
              <dl className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <Info label="Industry" value={pitch.industry} />
                <Info label="Size" value={pitch.size_guess} />
                <Info label="Gov vs private" value={String(pitch.gov_mix_guess || '').replace(/_/g, ' ')} />
              </dl>
              <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2"><span className="text-xs uppercase tracking-wide text-emerald-700">Lead with</span><div className="font-semibold text-emerald-900">{serviceLabel(pitch.lead_service)}</div></div>
              <ol className="space-y-2">
                {(pitch.talking_points || []).map((t: string, i: number) => (
                  <li key={i} className="flex gap-2"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-600 text-[11px] font-bold text-white">{i + 1}</span><span className="text-gray-800">{t}</span></li>
                ))}
              </ol>
              {pitch.first_question && <p className="rounded-lg bg-primary-50 px-3 py-2 text-primary-900"><span className="font-semibold">First question:</span> {pitch.first_question}</p>}
              {pitch.look_for && <p className="text-xs text-gray-500"><span className="font-semibold">On the website, look for:</span> {pitch.look_for}</p>}
            </div>
          )}
        </Section>
      )}

      {(scan || errors.scan) && (
        <Section title="Website scan" icon={<Globe className="h-4 w-4" />} compact={compact}
          right={scan ? <span className="flex gap-1">{scan.cached && <Pill tone="gray">cached</Pill>}{scan.load_ms ? <Pill tone="gray">{(scan.load_ms / 1000).toFixed(1)} s</Pill> : null}</span> : undefined}>
          <ErrorNote error={errors.scan} />
          {scan && (
            <div className="space-y-3 text-sm">
              {!scan.reachable && scan.checks?.[0]?.id !== 'no_site' && <p className="text-amber-800">We couldn&apos;t open the site — that is an observation too.</p>}
              <ul className="space-y-1 text-gray-800">{(scan.summary_lines || []).map((l: string, i: number) => <li key={i}>• {l}</li>)}</ul>
              {scan.suggested_question && <p className="rounded-lg bg-primary-50 px-3 py-2 text-primary-900"><span className="font-semibold">Ask:</span> “{scan.suggested_question}”</p>}
              <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
                {(scan.checks || []).map((c: any) => (
                  <li key={c.id} className="flex items-start gap-2 px-3 py-2">
                    <StatusIcon status={c.status} />
                    <div className="min-w-0">
                      <div className="font-medium text-gray-900">{c.label}</div>
                      {c.detail && <div className="text-xs text-gray-500 break-words">{c.detail}</div>}
                      {c.status === 'issue' && c.say && <div className="mt-1 text-xs text-primary-800">Say: “{c.say}”</div>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      )}

      <Section title="Recommend a service" icon={<Compass className="h-4 w-4" />} compact={compact} defaultOpen={!compact || !!rec}>
        <fieldset>
          <legend className="text-xs text-gray-600 mb-2">What did you learn on the call? Tick what applies{scanFlags.length ? ' (website-scan findings are added automatically)' : ''}.</legend>
          <div className={cn('grid gap-1.5', !compact && 'sm:grid-cols-2')}>
            {ANSWER_TOGGLES.map((t) => {
              const on = answers.includes(t.id);
              return (
                <label key={t.id} className={cn('flex items-start gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer', on ? 'border-primary-300 bg-primary-50' : 'border-gray-200 hover:bg-gray-50')}>
                  <input type="checkbox" className="mt-0.5 accent-primary-600" checked={on} onChange={() => setAnswers((a) => (on ? a.filter((x) => x !== t.id) : [...a, t.id]))} />
                  <span><span className="text-gray-900">{t.label}</span><span className="block text-xs text-gray-500">{t.hint}</span></span>
                </label>
              );
            })}
          </div>
        </fieldset>
        <Btn className="mt-3" size="sm" onClick={recommend} disabled={busy === 'rec'}>{busy === 'rec' ? 'Thinking…' : rec ? 'Update recommendation' : 'Recommend'}</Btn>
        <ErrorNote error={errors.rec} />
        {rec && (
          <div className="mt-3 space-y-2 text-sm">
            <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2">
              <span className="text-xs uppercase tracking-wide text-emerald-700">Lead with</span>
              <div className="font-semibold text-emerald-900">{rec.lead_label || serviceLabel(rec.lead)}</div>
              {rec.runner_up_label && <div className="text-emerald-800 text-xs mt-0.5">“And also”: {rec.runner_up_label}</div>}
            </div>
            {rec.path?.length ? (
              <ol className="flex flex-wrap items-center gap-1 text-xs text-gray-600" aria-label="Decision path">
                {rec.path.map((p: string, i: number) => <li key={i} className="flex items-center gap-1"><span className="rounded-full bg-gray-100 px-2 py-0.5">{p}</span>{i < rec.path.length - 1 && <span aria-hidden>→</span>}</li>)}
              </ol>
            ) : null}
          </div>
        )}
      </Section>

      <div id="la-email">
        <Section title="Follow-up email (after a voicemail)" icon={<Mail className="h-4 w-4" />} compact={compact} defaultOpen={!compact || !!email} openSignal={emailSignal}>
          <div className="space-y-2">
            <label htmlFor="la-obs" className="block text-xs font-medium text-gray-600">One thing you noticed on their website</label>
            <input id="la-obs" className={inputCls} value={observation} onChange={(e) => setObservation(e.target.value)} placeholder="e.g. the site shows “Not secure” in Chrome" />
            <Btn size="sm" onClick={draft} disabled={busy === 'email' || !firm.trim()}>{busy === 'email' ? 'Drafting…' : email ? 'Redraft' : 'Draft email'}</Btn>
            {!firm.trim() && <p className="text-xs text-gray-500">Add the firm name first.</p>}
            <ErrorNote error={errors.email} />
            {email && (
              <div className="space-y-2 pt-1">
                <label htmlFor="la-subj" className="block text-xs font-medium text-gray-600">Subject</label>
                <input id="la-subj" className={inputCls} value={email.subject} onChange={(e) => setEmail({ ...email, subject: e.target.value })} />
                <label htmlFor="la-body" className="block text-xs font-medium text-gray-600">Body — replace {'{CONTACT}'} and check it before sending</label>
                <textarea id="la-body" rows={9} className={inputCls} value={email.body} onChange={(e) => setEmail({ ...email, body: e.target.value })} />
                <Btn size="sm" variant="secondary" onClick={copyEmail}>{copied ? <><Check className="h-4 w-4" aria-hidden /> Copied</> : <><Copy className="h-4 w-4" aria-hidden /> Copy email</>}</Btn>
              </div>
            )}
          </div>
        </Section>
      </div>
    </div>
  );

  const reminders = (
    <>
      <Section title="Dial first, look while it rings" icon={<Lightbulb className="h-4 w-4" />} compact={compact} defaultOpen={!compact}>
        <ol className="list-decimal pl-5 space-y-1.5 text-sm text-gray-700">{DIAL_STEPS.map((s, i) => <li key={i}>{s}</li>)}</ol>
      </Section>
      <Section title="30-second website checklist" icon={<ListChecks className="h-4 w-4" />} compact={compact} defaultOpen={false}>
        <ol className="space-y-2 text-sm">
          {CHECKLIST.map((c, i) => (
            <li key={i} className="rounded-lg bg-gray-50 px-3 py-2">
              <div className="font-medium text-gray-900">{i + 1}. {c.look}</div>
              <div className="text-xs text-gray-600">Say: “{c.say}”</div>
            </li>
          ))}
        </ol>
      </Section>
    </>
  );

  if (compact) {
    return (
      <div className="space-y-3">
        <Section title={firm || 'Lead'} icon={<Globe className="h-4 w-4" />} compact defaultOpen={!firm || !narrative}>{leadForm}</Section>
        {actions}
        {results}
        {reminders}
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="lg:col-span-2 space-y-4">
        <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">The lead</h2>
          {leadForm}
          {actions}
        </section>
        {reminders}
      </div>
      <div className="lg:col-span-3">{results}</div>
    </div>
  );
}

function ActionBtn({ onClick, busy, disabled, icon, label }: { onClick: () => void; busy?: boolean; disabled?: boolean; icon: ReactNode; label: string }) {
  return (
    <button type="button" onClick={onClick} disabled={busy || disabled}
      className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-primary-200 bg-primary-50 px-3 py-2.5 text-sm font-medium text-primary-800 hover:bg-primary-100 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
      {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon} {label}
    </button>
  );
}

function Info({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2">
      <dt className="text-[11px] uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="text-gray-800">{value || '—'}</dd>
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'ok') return <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-emerald-500" aria-label="Looks fine" />;
  if (status === 'issue') return <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" aria-label="Issue found" />;
  return <HelpCircle className="h-4 w-4 mt-0.5 shrink-0 text-gray-300" aria-label="Could not check" />;
}
