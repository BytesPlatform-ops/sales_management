'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Bell, CalendarClock, CheckCircle2, ChevronDown, Circle, Clock, Hourglass, Lock, PhoneOff, Sparkles } from 'lucide-react';
import { tapi, useTraining, fmtDate } from '@/lib/training/client';
import { PageHeader, Panel, ErrorNote, Spinner, PhaseBadge, Pill, ProgressBar, DoneMark, LockNote, Empty, Btn, StandardModeBanner } from '@/components/training/ui';
import { LessonTypeIcon, LESSON_TYPE, certTitle, CERT_LABELS, timeUntil } from '@/components/training/rep/common';
import { cn } from '@/lib/utils';

const PHASE_MEANING: Record<string, string> = {
  TRAINING: 'You are in training. No quota yet and no missed-target deductions while you learn.',
  SUPERVISED: 'Your trainer has paused you in supervised mode. No missed-target deductions while supervised.',
  RAMP_50: 'You are live! Ramp-up phase: no missed-target deductions yet.',
  RAMP_75: 'Ramp-up phase: your targets are 75% of the full quota.',
  FULL: 'Full quota.',
};

export default function MyPathPage() {
  const me = useTraining<any>('/me');
  const path = useTraining<any>('/path');
  const certs = useTraining<any>('/certifications');
  const assignments = useTraining<any[]>('/assignments');
  const notes = useTraining<any[]>('/notifications');

  if (me.error || path.error) return <ErrorNote error={me.error || path.error} />;
  if (!me.data || !path.data) return <Spinner label="Loading your training path…" />;

  const m = me.data;
  const tracks: any[] = path.data.tracks || [];
  const next = path.data.next_lesson;
  const phase = m.ramp?.phase || 'FULL';
  const earned = new Set((m.certifications || []).map((c: any) => c.code));
  const firstName = m.user?.full_name?.split(' ')[0] || '';

  return (
    <div>
      <PageHeader
        title={`My training path${firstName ? `, ${firstName}` : ''}`}
        subtitle={m.onboarding_day && phase === 'TRAINING'
          ? <>Day <strong>{Math.min(m.onboarding_day, m.onboarding_days || 3)}</strong> of {m.onboarding_days || 3}{m.onboarding_day > (m.onboarding_days || 3) ? ' (you are past the planned 3 days — keep going, you are close)' : ''}</>
          : 'Work through the lessons in order. Each one takes about 5–10 minutes.'}
        actions={<PhaseBadge phase={phase} className="text-sm px-3 py-1" />}
      />

      {!m.ai?.available && <StandardModeBanner message={`${m.ai?.message || 'AI unavailable — using standard mode'}. Everything still works: roleplays use scripted choices and you rate some answers yourself.`} />}

      {/* Certification chips */}
      <div className="mb-5 flex flex-wrap gap-2" aria-label="Certifications">
        {['PRODUCT_CERT', 'LIVE_CALL_CERT', 'BYTESCON_CERT'].map((code) => (
          <span key={code} className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm',
            earned.has(code) ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-gray-200 bg-white text-gray-500')}>
            {earned.has(code) ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : <Circle className="h-4 w-4" aria-hidden />}
            {certTitle(code)}{code === 'BYTESCON_CERT' && <span className="text-xs text-gray-400">(optional)</span>}
            <span className="sr-only">{earned.has(code) ? 'earned' : 'not earned yet'}</span>
          </span>
        ))}
      </div>

      {phase !== 'FULL' && PHASE_MEANING[phase] && (
        <p className="-mt-2 mb-5 text-sm text-gray-600"><span className="font-medium text-gray-800">What this means for your pay:</span> {PHASE_MEANING[phase]}</p>
      )}

      {m.dialer_blocked && (
        <div className="mb-5 flex items-start gap-3 rounded-2xl border border-violet-200 bg-violet-50 p-4 text-sm text-violet-900">
          <PhoneOff className="h-5 w-5 mt-0.5 shrink-0 text-violet-600" aria-hidden />
          <div>
            <div className="font-semibold">Live calling unlocks after Live-call certification</div>
            <p className="mt-0.5">Until you earn <strong>LIVE_CALL_CERT</strong> (end of Day 3), My Leads stays locked. Practise with roleplays and the daily drill in the meantime — they count.</p>
          </div>
        </div>
      )}

      {/* Continue CTA */}
      {next ? (
        <Link href={`/agent/training/lesson/${next.id}`}
          className="group mb-6 flex flex-col sm:flex-row sm:items-center gap-3 rounded-2xl bg-gradient-to-r from-primary-600 to-primary-700 p-5 text-white shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2">
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-primary-100">Continue where you left off</div>
            <div className="mt-1 text-lg font-bold truncate">{next.title}</div>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-primary-100">
              <span className="inline-flex items-center gap-1"><LessonTypeIcon type={next.type} /> {LESSON_TYPE[next.type]?.label || next.type}</span>
              <span className="inline-flex items-center gap-1"><Clock className="h-4 w-4" aria-hidden /> ~{next.est_minutes} min</span>
              {next.cooldown_until && <span className="inline-flex items-center gap-1"><Hourglass className="h-4 w-4" aria-hidden /> retake in {timeUntil(next.cooldown_until)}</span>}
            </div>
          </div>
          <span className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-primary-700 group-hover:bg-primary-50">
            Continue <ArrowRight className="h-4 w-4" aria-hidden />
          </span>
        </Link>
      ) : (
        <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-800">
          <div className="flex items-center gap-2 font-semibold"><Sparkles className="h-5 w-5" aria-hidden /> All required lessons are done.</div>
          <p className="mt-1 text-sm">Keep sharp with <Link href="/agent/training/today" className="underline">today&apos;s 5-minute drill</Link> and <Link href="/agent/training/roleplay" className="underline">roleplays</Link>.</p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          {tracks.map((t, i) => <TrackCard key={t.id} track={t} defaultOpen={!t.completed && t.unlocked && !t.is_placeholder && i === tracks.findIndex((x) => !x.completed && x.unlocked && !x.is_placeholder)} />)}
        </div>

        <div className="space-y-4">
          <CertRequirements data={certs.data} error={certs.error} />
          <Assignments rows={assignments.data} />
          <Notifications rows={notes.data} onRead={async () => { await tapi('/notifications', { method: 'POST', body: {} }); notes.mutate(); me.mutate(); }} />
        </div>
      </div>
    </div>
  );
}

function TrackCard({ track, defaultOpen }: { track: any; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const placeholder = track.is_placeholder;
  return (
    <section className="bg-white rounded-2xl border border-gray-200 shadow-sm">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="w-full flex items-center gap-4 px-5 py-4 text-left rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
        <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold',
          track.completed ? 'bg-emerald-100 text-emerald-700' : track.unlocked ? 'bg-primary-100 text-primary-700' : 'bg-gray-100 text-gray-400')}>
          {track.code}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold text-gray-900">{track.title}</h2>
            {track.cert && <Pill tone={track.cert.earned ? 'green' : 'gray'}>{track.cert.earned ? '✓ ' : ''}{certTitle(track.cert.code)}</Pill>}
            {placeholder && <Pill tone="violet">Coming soon</Pill>}
          </div>
          {placeholder ? (
            <p className="mt-0.5 text-sm text-gray-500">Coming soon from your trainer.</p>
          ) : (
            <div className="mt-2 flex items-center gap-3">
              <ProgressBar value={track.progress_pct} tone={track.completed ? 'green' : 'primary'} className="max-w-xs" />
              <span className="text-xs tabular-nums text-gray-500">{track.progress_pct}%</span>
            </div>
          )}
          {!track.unlocked && track.lock_hint && <div className="mt-1"><LockNote hint={track.lock_hint} /></div>}
        </div>
        <ChevronDown className={cn('h-5 w-5 text-gray-400 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div className="border-t border-gray-100 px-3 sm:px-5 py-3 space-y-3">
          {placeholder && (
            <p className="px-2 text-sm text-gray-500">Your trainer is still writing this track (tools, handoff to fulfillment, HR &amp; pay). Anything below is an early preview and is optional.</p>
          )}
          {track.courses.map((c: any) => <CourseBlock key={c.id} course={c} />)}
        </div>
      )}
    </section>
  );
}

function CourseBlock({ course }: { course: any }) {
  const [open, setOpen] = useState(course.unlocked && !course.completed);
  return (
    <div className={cn('rounded-xl border', course.unlocked ? 'border-gray-200' : 'border-dashed border-gray-200 bg-gray-50/60')}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
        {course.completed ? <DoneMark /> : course.unlocked ? <Circle className="h-5 w-5 text-primary-400 shrink-0" aria-hidden /> : <Lock className="h-5 w-5 text-gray-300 shrink-0" aria-hidden />}
        <span className="font-medium text-gray-900 flex-1 min-w-0">{course.title}</span>
        {course.day_number && <Pill tone="blue">Day {course.day_number}</Pill>}
        {!course.required && <Pill tone="gray">Optional</Pill>}
        <span className="text-xs tabular-nums text-gray-500">{course.progress_pct}%</span>
        <ChevronDown className={cn('h-4 w-4 text-gray-400 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {!course.unlocked && course.lock_hint && <div className="px-4 -mt-1 pb-2"><LockNote hint={course.lock_hint} /></div>}
      {open && (
        <ul className="border-t border-gray-100 divide-y divide-gray-100">
          {course.lessons.map((l: any) => <LessonRow key={l.id} lesson={l} />)}
        </ul>
      )}
    </div>
  );
}

function LessonRow({ lesson: l }: { lesson: any }) {
  const body = (
    <>
      <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', l.completed ? 'bg-emerald-50 text-emerald-600' : l.unlocked ? 'bg-primary-50 text-primary-600' : 'bg-gray-100 text-gray-400')}>
        <LessonTypeIcon type={l.type} />
      </span>
      <span className="flex-1 min-w-0">
        <span className={cn('block text-sm font-medium', l.unlocked ? 'text-gray-900' : 'text-gray-400')}>{l.title}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-500">
          <span>{LESSON_TYPE[l.type]?.label || l.type}</span>
          <span>~{l.est_minutes} min</span>
          {!l.required && <span>optional</span>}
          {l.best_score !== null && l.best_score !== undefined && <span>best {l.best_score}% (pass {l.pass_pct}%)</span>}
          {l.cooldown_until && <span className="inline-flex items-center gap-1 text-amber-700"><Hourglass className="h-3 w-3" aria-hidden /> retake in {timeUntil(l.cooldown_until)}</span>}
          {!l.unlocked && <LockNote hint={l.lock_hint} />}
        </span>
      </span>
      {l.completed ? <DoneMark /> : l.unlocked ? <ArrowRight className="h-4 w-4 text-gray-300" aria-hidden /> : null}
    </>
  );
  return (
    <li>
      {l.unlocked ? (
        <Link href={`/agent/training/lesson/${l.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 focus:outline-none focus-visible:bg-primary-50">
          {body}
        </Link>
      ) : (
        <div className="flex items-center gap-3 px-4 py-2.5" aria-disabled>{body}</div>
      )}
    </li>
  );
}

function CertRequirements({ data, error }: { data: any; error: unknown }) {
  if (error) return <ErrorNote error={error} />;
  if (!data) return null;
  const reqs: any[] = data.requirements || [];
  return (
    <Panel title="Certification checklist">
      <div className="space-y-5">
        {reqs.map((r) => (
          <div key={r.code}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold text-gray-900 text-sm">{certTitle(r.code)}</h3>
              {r.earned ? <Pill tone="green">Earned</Pill> : <Pill tone="gray">{r.items.filter((i: any) => i.met).length}/{r.items.length} done</Pill>}
            </div>
            {CERT_LABELS[r.code] && <p className="text-xs text-gray-500 mt-0.5">{CERT_LABELS[r.code].blurb}</p>}
            <ul className="mt-2 space-y-1.5">
              {r.items.map((it: any, i: number) => {
                const waiting = !it.met && !r.earned && waitingForTrainer(it.detail || '');
                return (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    {it.met || r.earned ? <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-emerald-500" aria-label="met" /> : <Circle className="h-4 w-4 mt-0.5 shrink-0 text-gray-300" aria-label="not met yet" />}
                    <span className="min-w-0">
                      <span className={cn(it.met || r.earned ? 'text-gray-700' : 'text-gray-900')}>{CERT_LABELS[it.label.replace(/ /g, '_')] ? certTitle(it.label.replace(/ /g, '_')) : it.label}</span>
                      {it.detail && <span className="block text-xs text-gray-500">{it.detail}</span>}
                      {waiting && <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-amber-700"><Hourglass className="h-3 w-3" aria-hidden /> Waiting for trainer review</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {!reqs.length && <p className="text-sm text-gray-500">No certification rules set up yet.</p>}
      </div>
    </Panel>
  );
}

function Assignments({ rows }: { rows?: any[] }) {
  if (!rows) return null;
  return (
    <Panel title="Assigned to you">
      {rows.length === 0 ? <p className="text-sm text-gray-500">Nothing assigned right now.</p> : (
        <ul className="space-y-2.5">
          {rows.map((a) => {
            const overdue = a.due_at && new Date(a.due_at) < new Date();
            return (
              <li key={a.id} className="flex items-start gap-2 text-sm">
                <CalendarClock className={cn('h-4 w-4 mt-0.5 shrink-0', overdue ? 'text-red-500' : 'text-gray-400')} aria-hidden />
                <div className="min-w-0">
                  <div className="font-medium text-gray-900">{a.course_title || a.track_title || 'Training'}</div>
                  <div className={cn('text-xs', overdue ? 'text-red-600' : 'text-gray-500')}>
                    {a.due_at ? `${overdue ? 'Was due' : 'Due'} ${fmtDate(a.due_at)}` : 'No due date'}{a.assigned_by_name ? ` · from ${a.assigned_by_name}` : ''}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function Notifications({ rows, onRead }: { rows?: any[]; onRead: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  if (!rows) return null;
  const unread = rows.filter((n) => !n.read_at).length;
  return (
    <Panel title={<span className="inline-flex items-center gap-1.5"><Bell className="h-4 w-4" aria-hidden /> Updates {unread > 0 && <span className="rounded-full bg-primary-600 px-1.5 text-[11px] text-white normal-case">{unread} new</span>}</span>}
      action={unread > 0 ? <Btn size="sm" variant="ghost" disabled={busy} onClick={async () => { setBusy(true); try { await onRead(); } finally { setBusy(false); } }}>Mark all read</Btn> : undefined}>
      {rows.length === 0 ? <Empty title="No updates yet" body="Certificates, badges and trainer notes show up here." /> : (
        <ul className="space-y-2 max-h-80 overflow-y-auto pr-1">
          {rows.slice(0, 20).map((n) => {
            const inner = (
              <>
                <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.read_at ? 'bg-transparent' : 'bg-primary-500')} aria-hidden />
                <span className="min-w-0">
                  <span className={cn('block text-sm', n.read_at ? 'text-gray-600' : 'text-gray-900 font-medium')}>{n.body}</span>
                  <span className="block text-xs text-gray-400">{fmtDate(n.created_at, true)}</span>
                </span>
              </>
            );
            return (
              <li key={n.id}>
                {n.link && n.link.startsWith('/agent') ? (
                  <Link href={n.link} className="flex items-start gap-2 rounded-lg p-1 hover:bg-gray-50">{inner}</Link>
                ) : <div className="flex items-start gap-2 p-1">{inner}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function waitingForTrainer(detail: string) {
  // e.g. "2/2 scored ≥70 · 0/1 trainer-reviewed": scores are in, only the trainer review is missing.
  const scored = detail.match(/(\d+)\/(\d+) scored/);
  const human = detail.match(/(\d+)\/(\d+) trainer-reviewed/);
  return !!scored && !!human && Number(scored[1]) >= 1 && Number(human[1]) < Number(human[2]);
}
