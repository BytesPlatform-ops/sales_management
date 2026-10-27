'use client';

import { useEffect, useState } from 'react';
import { Github, Palmtree, Trash2 } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Btn, Pill, PageHeader, Spinner, ErrorNote, inputCls } from '@/components/training/ui';
import { Field, ProjectsPage, ProjectsProvider, SectionCard, selectCls, useToast } from '@/components/projects/ui';
import { papi, usePapi, fmtDay, TIMEZONES } from '@/components/projects/lib';

interface Profile {
  user_id: number; name: string; role: string;
  profile: { skills: string[]; timezone: string; weekly_capacity_hours: number | null; is_guest: boolean; guest_expires_at: string | null };
  out_of_office: { id: number; starts_on: string; ends_on: string; note: string | null }[];
}

function ProfilePage() {
  const toast = useToast();
  const { data, error, mutate } = usePapi<Profile>('/api/profile');
  const [skills, setSkills] = useState('');
  const [tz, setTz] = useState('Asia/Karachi');
  const [cap, setCap] = useState('');
  const [ooo, setOoo] = useState({ starts_on: '', ends_on: '', note: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data) return;
    setSkills(data.profile.skills.join(', '));
    setTz(data.profile.timezone);
    setCap(data.profile.weekly_capacity_hours == null ? '' : String(data.profile.weekly_capacity_hours));
  }, [data]);

  async function save() {
    setSaving(true);
    try {
      await papi('/api/profile', { method: 'PUT', body: { skills: skills.split(',').map((s) => s.trim()).filter(Boolean), timezone: tz, weekly_capacity_hours: cap === '' ? null : Number(cap) } });
      toast('Profile saved'); mutate();
    } catch (e) { toast((e as Error).message, 'error'); } finally { setSaving(false); }
  }
  async function addOoo() {
    try { await papi('/api/profile/availability', { method: 'POST', body: ooo }); setOoo({ starts_on: '', ends_on: '', note: '' }); toast('Out-of-office added'); mutate(); }
    catch (e) { toast((e as Error).message, 'error'); }
  }
  async function delOoo(id: number) {
    try { await papi(`/api/profile/availability?id=${id}`, { method: 'DELETE' }); mutate(); } catch (e) { toast((e as Error).message, 'error'); }
  }

  if (error) return <ProjectsPage><ErrorNote error={error} /></ProjectsPage>;
  if (!data) return <ProjectsPage><Spinner /></ProjectsPage>;
  const tzKnown = TIMEZONES.some((t) => t.value === tz);
  return (
    <ProjectsPage>
      <PageHeader title="My profile" subtitle={data.name} />
      {data.profile.is_guest && (
        <p className="mb-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Guest developer — you see only the projects you’re put on or that are shared with you{data.profile.guest_expires_at ? `, until ${fmtDay(data.profile.guest_expires_at.slice(0, 10))}` : ''}.
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Skills & capacity">
          <div className="space-y-3">
            <Field label="Skills (comma separated)" htmlFor="pf-skills" hint="Help requests are matched on these.">
              <input id="pf-skills" className={inputCls} value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="react, wordpress, shopify" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Time zone" htmlFor="pf-tz">
                <select id="pf-tz" className={selectCls} value={tz} onChange={(e) => setTz(e.target.value)}>
                  <option value="Asia/Karachi">Pakistan (Karachi)</option>
                  {TIMEZONES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  {!tzKnown && tz !== 'Asia/Karachi' && <option value={tz}>{tz}</option>}
                </select>
              </Field>
              <Field label="Hours per week" htmlFor="pf-cap">
                <input id="pf-cap" type="number" min={0} max={80} className={inputCls} value={cap} onChange={(e) => setCap(e.target.value)} />
              </Field>
            </div>
            <div className="flex justify-end"><Btn onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Btn></div>
          </div>
        </SectionCard>
        <SectionCard title="Out of office">
          <p className="mb-3 text-sm text-gray-600">While you’re out you’re skipped for reviews and triage, and your tickets show a banner.</p>
          {data.out_of_office.length > 0 && (
            <ul className="mb-3 divide-y divide-gray-100 rounded-xl border border-gray-200">
              {data.out_of_office.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="flex items-center gap-2"><Palmtree className="h-4 w-4 text-amber-600" />{fmtDay(o.starts_on)} – {fmtDay(o.ends_on)}{o.note && <Pill tone="gray">{o.note}</Pill>}</span>
                  <button aria-label="Remove" onClick={() => delOoo(o.id)} className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                </li>
              ))}
            </ul>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="From" htmlFor="oo-from"><input id="oo-from" type="date" className={inputCls} value={ooo.starts_on} onChange={(e) => setOoo({ ...ooo, starts_on: e.target.value })} /></Field>
            <Field label="To" htmlFor="oo-to"><input id="oo-to" type="date" className={inputCls} value={ooo.ends_on} onChange={(e) => setOoo({ ...ooo, ends_on: e.target.value })} /></Field>
          </div>
          <Field label="Note (optional)" htmlFor="oo-note" className="mt-3"><input id="oo-note" className={inputCls} value={ooo.note} maxLength={200} onChange={(e) => setOoo({ ...ooo, note: e.target.value })} /></Field>
          <div className="mt-3 flex justify-end"><Btn variant="secondary" disabled={!ooo.starts_on || !ooo.ends_on} onClick={addOoo}>Add</Btn></div>
        </SectionCard>
        {(data.role === 'developer' || data.role === 'hr') && <GitHubCard />}
      </div>
    </ProjectsPage>
  );
}

/** Link a GitHub account so pushes and pull requests are credited to you and repo access can be granted. */
function GitHubCard() {
  const toast = useToast();
  const search = useSearchParams();
  const { data, mutate } = usePapi<{ link: { github_login: string; linked_at: string } | null; oauth_configured: boolean }>('/api/profile/github');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const g = search.get('github');
    if (g === 'linked') toast('GitHub account linked');
    if (g === 'error') toast(search.get('message') || 'GitHub linking failed', 'error');
  }, [search, toast]);
  async function connect() {
    setBusy(true);
    try { window.location.href = (await papi<{ url: string }>('/api/profile/github/connect', { method: 'POST' })).url; }
    catch (e) { toast((e as Error).message, 'error'); setBusy(false); }
  }
  async function unlink() {
    try { await papi('/api/profile/github', { method: 'DELETE' }); toast('GitHub account unlinked'); mutate(); } catch (e) { toast((e as Error).message, 'error'); }
  }
  return (
    <SectionCard title={<span className="inline-flex items-center gap-1.5"><Github className="h-4 w-4" />GitHub</span>}>
      {!data ? <Spinner /> : data.link ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>Linked as <a className="font-medium text-gray-900 hover:underline" href={`https://github.com/${data.link.github_login}`} target="_blank" rel="noreferrer">@{data.link.github_login}</a> since {fmtDay(data.link.linked_at.slice(0, 10))}</span>
          <Btn size="sm" variant="ghost" onClick={unlink}>Unlink</Btn>
        </div>
      ) : (
        <div className="space-y-2 text-sm text-gray-600">
          <p>Link your GitHub account so your branches, pull requests and merges move tickets automatically and you get access to project repos.</p>
          <Btn disabled={busy || !data.oauth_configured} onClick={connect}><Github className="h-4 w-4" />Connect GitHub</Btn>
          {!data.oauth_configured && <p className="text-xs text-gray-500">GitHub sign-in isn’t configured on the server yet.</p>}
        </div>
      )}
    </SectionCard>
  );
}

export default function Page() {
  return <ProjectsProvider><ProfilePage /></ProjectsProvider>;
}
