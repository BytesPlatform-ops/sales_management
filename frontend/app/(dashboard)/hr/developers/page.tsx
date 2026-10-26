'use client';

import { useState } from 'react';
import { UserPlus, KeyRound, UserX, UserCheck, Code2, Info } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';
import { PageHeader, Spinner, ErrorNote, Empty, Btn, Pill, inputCls } from '@/components/training/ui';
import { ProjectsPage, ProjectsProvider, Modal, Field, Avatar, useConfirm, useToast } from '@/components/projects/ui';
import { usePapi, papi, fmtDay } from '@/components/projects/lib';

interface Developer {
  id: string | number; username: string; full_name: string; email: string | null; is_active: boolean; created_at: string;
  open_projects: number; total_projects: number;
}

export default function DevelopersPage() {
  return <ProjectsProvider><Developers /></ProjectsProvider>;
}

function Developers() {
  const { user } = useAuth();
  const isHr = user?.role === 'hr';
  const { data, error, isLoading, mutate } = usePapi<Developer[]>(isHr ? '/api/hr/developers' : null);
  const confirm = useConfirm();
  const toast = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ username: '', full_name: '', email: '', password: '' });
  const [formErr, setFormErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [resetFor, setResetFor] = useState<Developer | null>(null);
  const [newPw, setNewPw] = useState('');

  if (user && !isHr) {
    return <ProjectsPage><PageHeader title="Developers" /><div className="bg-white rounded-2xl border"><Empty title="HR only" body="Only HR can manage developer accounts." /></div></ProjectsPage>;
  }

  const create = async () => {
    if (!form.username.trim() || !form.full_name.trim() || !form.password) return setFormErr('Username, full name and password are required');
    if (!/^[a-zA-Z0-9._-]+$/.test(form.username.trim())) return setFormErr('Username can only use letters, numbers, dots, dashes and underscores');
    if (form.password.length < 6) return setFormErr('Password must be at least 6 characters');
    setSaving(true);
    setFormErr(null);
    try {
      await papi('/api/hr/developers', { body: { ...form, username: form.username.trim(), full_name: form.full_name.trim(), email: form.email.trim() || null } });
      toast(`${form.full_name.trim()} can now log in as “${form.username.trim()}”`);
      setCreateOpen(false);
      mutate();
    } catch (e) {
      setFormErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (d: Developer) => {
    if (d.is_active && !(await confirm({
      title: `Deactivate ${d.full_name}?`,
      body: <>They won’t be able to log in. {d.open_projects > 0 && <strong>They’re on {d.open_projects} open project{d.open_projects === 1 ? '' : 's'} — reassign that work.</strong>} You can reactivate them any time.</>,
      confirmLabel: 'Deactivate', danger: true,
    }))) return;
    try {
      await papi(`/api/hr/developers/${d.id}`, { method: 'PATCH', body: { is_active: !d.is_active } });
      toast(d.is_active ? `${d.full_name} deactivated` : `${d.full_name} reactivated`);
      mutate();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const resetPw = async () => {
    if (!resetFor) return;
    if (newPw.length < 6) return setFormErr('Password must be at least 6 characters');
    setSaving(true);
    setFormErr(null);
    try {
      await papi(`/api/hr/developers/${resetFor.id}`, { method: 'PATCH', body: { password: newPw } });
      toast(`Password reset for ${resetFor.full_name}`);
      setResetFor(null);
    } catch (e) {
      setFormErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const devs = data || [];
  return (
    <ProjectsPage>
      <PageHeader title="Developers" subtitle="Accounts for the development team who work on client projects."
        actions={<Btn onClick={() => { setForm({ username: '', full_name: '', email: '', password: '' }); setFormErr(null); setCreateOpen(true); }}><UserPlus className="h-4 w-4" />Add developer</Btn>} />

      <div className="mb-4 flex items-start gap-2 rounded-xl border border-primary-100 bg-primary-50 px-4 py-3 text-sm text-primary-900">
        <Info className="h-4 w-4 mt-0.5 shrink-0 text-primary-600" />
        <p>Developers log in on the same login page with the username and password you set here. They only see <strong>Projects</strong> and the project calendar — and only the projects you assign them to. They’re not part of agent payroll, leaderboards or lead distribution.</p>
      </div>

      <ErrorNote error={error} />
      {isLoading ? <Spinner /> : devs.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200">
          <Empty icon={<Code2 className="h-6 w-6" />} title="No developers yet" body="Add your first developer, then assign them to projects from the project page." />
        </div>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {devs.map((d) => (
            <li key={String(d.id)} className={cn('rounded-2xl border bg-white p-4 shadow-sm min-w-0', d.is_active ? 'border-gray-200' : 'border-gray-200 opacity-75')}>
              <div className="flex items-start gap-3">
                <Avatar name={d.full_name} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-gray-900 truncate">{d.full_name}</span>
                    {d.is_active ? <Pill tone="green">Active</Pill> : <Pill tone="gray">Deactivated</Pill>}
                  </div>
                  <div className="text-sm text-gray-500 truncate">@{d.username}{d.email && <> · {d.email}</>}</div>
                  <div className="mt-1 text-xs text-gray-500">Added {fmtDay(d.created_at)}</div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-center">
                <div className="rounded-lg bg-gray-50 py-2"><div className={cn('text-lg font-bold tabular-nums', d.open_projects >= 4 ? 'text-amber-600' : 'text-gray-900')}>{d.open_projects}</div><div className="text-[11px] uppercase tracking-wide text-gray-500">Open projects</div></div>
                <div className="rounded-lg bg-gray-50 py-2"><div className="text-lg font-bold tabular-nums text-gray-900">{d.total_projects}</div><div className="text-[11px] uppercase tracking-wide text-gray-500">All time</div></div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Btn size="sm" variant="secondary" onClick={() => { setNewPw(''); setFormErr(null); setResetFor(d); }}><KeyRound className="h-4 w-4" />Reset password</Btn>
                <Btn size="sm" variant={d.is_active ? 'ghost' : 'secondary'} onClick={() => toggle(d)} className={d.is_active ? 'text-red-600 hover:bg-red-50' : ''}>
                  {d.is_active ? <><UserX className="h-4 w-4" />Deactivate</> : <><UserCheck className="h-4 w-4" />Reactivate</>}
                </Btn>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Add a developer"
        footer={<><Btn variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Btn><Btn onClick={create} disabled={saving}>{saving ? 'Creating…' : 'Create account'}</Btn></>}>
        <form className="grid grid-cols-1 sm:grid-cols-2 gap-4" onSubmit={(e) => { e.preventDefault(); create(); }}>
          <Field label="Full name *" htmlFor="dv-name"><input id="dv-name" className={inputCls} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} autoComplete="off" /></Field>
          <Field label="Username *" htmlFor="dv-user" hint="Used to log in."><input id="dv-user" className={inputCls} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoComplete="off" autoCapitalize="none" /></Field>
          <Field label="Email" htmlFor="dv-email" className="sm:col-span-2"><input id="dv-email" type="email" className={inputCls} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="off" /></Field>
          <Field label="Password *" htmlFor="dv-pw" className="sm:col-span-2" hint="At least 6 characters. Share it with the developer privately."><input id="dv-pw" type="text" className={inputCls} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" /></Field>
          {formErr && <p className="sm:col-span-2 text-sm text-red-600" role="alert">{formErr}</p>}
          <button type="submit" className="hidden" />
        </form>
      </Modal>

      <Modal open={!!resetFor} onClose={() => setResetFor(null)} title={`Reset password for ${resetFor?.full_name || ''}`} size="sm"
        footer={<><Btn variant="secondary" onClick={() => setResetFor(null)}>Cancel</Btn><Btn onClick={resetPw} disabled={saving}>{saving ? 'Saving…' : 'Set new password'}</Btn></>}>
        <Field label="New password" htmlFor="dv-newpw" hint={`At least 6 characters. ${resetFor?.username ? `They log in as “${resetFor.username}”.` : ''}`}>
          <input id="dv-newpw" type="text" className={inputCls} value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" onKeyDown={(e) => e.key === 'Enter' && resetPw()} />
        </Field>
        {formErr && <p className="mt-2 text-sm text-red-600" role="alert">{formErr}</p>}
      </Modal>
    </ProjectsPage>
  );
}
