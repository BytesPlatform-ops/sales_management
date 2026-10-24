'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, CheckCircle2, Clock, Lock, Phone, Play, ShieldCheck } from 'lucide-react';
import { tapi, useTraining, ApiError, fmtDate } from '@/lib/training/client';
import { PageHeader, Panel, ErrorNote, Spinner, Pill, Btn, ProgressBar, StandardModeBanner, scoreTone, Empty } from '@/components/training/ui';
import { Markdown } from '@/components/training/markdown';
import { AttemptLesson } from '@/components/training/rep/attempt-player';
import { Celebrate, FlipCard, LessonTypeIcon, LESSON_TYPE, REVIEW_STATUS } from '@/components/training/rep/common';
import { cn } from '@/lib/utils';

export default function LessonPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, mutate } = useTraining<any>(`/lessons/${id}`, { shouldRetryOnError: false });

  if (error) {
    const locked = error instanceof ApiError && error.status === 403;
    return (
      <div className="max-w-2xl mx-auto">
        <Panel>
          <Empty
            icon={locked ? <Lock className="h-6 w-6" /> : undefined}
            title={locked ? 'This lesson is still locked' : 'Could not open this lesson'}
            body={(error as Error).message}
            action={<Link href="/agent/training"><Btn variant="secondary"><ArrowLeft className="h-4 w-4" aria-hidden /> Back to my path</Btn></Link>}
          />
        </Panel>
      </div>
    );
  }
  if (!data) return <Spinner label="Opening lesson…" />;

  const l = data.lesson;
  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        back={{ href: '/agent/training', label: 'My path' }}
        title={l.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{l.track_title} · {l.course_title}</span>
            <span className="inline-flex items-center gap-1"><LessonTypeIcon type={l.type} /> {LESSON_TYPE[l.type]?.label || l.type}</span>
            <span className="inline-flex items-center gap-1"><Clock className="h-4 w-4" aria-hidden /> ~{l.est_minutes} min</span>
          </span>
        }
        actions={data.status?.completed ? <Pill tone="green"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Completed</Pill> : undefined}
      />

      <LessonBody data={data} onChange={() => mutate()} />

      <nav aria-label="Lesson navigation" className="mt-8 flex flex-col sm:flex-row gap-3 sm:justify-between">
        {data.prev ? (
          <Link href={`/agent/training/lesson/${data.prev.id}`} className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 min-w-0">
            <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden /> <span className="truncate"><span className="block text-xs text-gray-400">Previous</span>{data.prev.title}</span>
          </Link>
        ) : <span />}
        {data.next ? (
          <Link href={`/agent/training/lesson/${data.next.id}`} className="inline-flex items-center justify-end gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 text-right min-w-0">
            <span className="truncate"><span className="block text-xs text-gray-400">Next</span>{data.next.title}</span> <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
          </Link>
        ) : <span />}
      </nav>
    </div>
  );
}

function LessonBody({ data, onChange }: { data: any; onChange: () => void }) {
  const l = data.lesson;
  if (['quiz', 'exam', 'drill'].includes(l.type)) {
    return (
      <>
        {l.body_md && <Panel className="mb-4"><Markdown source={l.body_md} /></Panel>}
        <AttemptLesson data={data} onChange={onChange} />
      </>
    );
  }
  if (l.type === 'roleplay') return <RoleplayLesson data={data} />;
  if (l.type === 'flashcard_deck') return <DeckLesson data={data} onChange={onChange} />;
  if (l.type === 'checklist') return <ChecklistLesson data={data} onChange={onChange} />;
  return <ReadingLesson data={data} onChange={onChange} />;
}

function useComplete(lessonId: number, onChange: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<any>(null);
  const complete = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await tapi<any>(`/lessons/${lessonId}/complete`, { method: 'POST' });
      setDone(r);
      onChange();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, done, complete };
}

function CompleteBar({ data, c, disabled, hint }: { data: any; c: ReturnType<typeof useComplete>; disabled?: boolean; hint?: string }) {
  const completed = data.status?.completed || c.done;
  return (
    <div className="mt-4">
      <Celebrate certs={c.done?.new_certifications} badges={c.done?.new_badges} />
      <ErrorNote error={c.error} />
      <div className="flex flex-wrap items-center gap-3">
        {completed ? (
          <>
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700"><CheckCircle2 className="h-5 w-5" aria-hidden /> Done</span>
            {data.next && <Link href={`/agent/training/lesson/${data.next.id}`}><Btn>Next lesson <ArrowRight className="h-4 w-4" aria-hidden /></Btn></Link>}
          </>
        ) : (
          <>
            <Btn variant="success" onClick={c.complete} disabled={c.busy || disabled}><CheckCircle2 className="h-4 w-4" aria-hidden /> {c.busy ? 'Saving…' : 'Mark complete'}</Btn>
            {hint && <span className="text-xs text-gray-500">{hint}</span>}
          </>
        )}
      </div>
    </div>
  );
}

function ReadingLesson({ data, onChange }: { data: any; onChange: () => void }) {
  const l = data.lesson;
  const c = useComplete(l.id, onChange);
  const media = l.media_url as string | null;
  const isFile = media && /\.(mp4|webm|ogg|mov)(\?|$)/i.test(media);
  const embed = media && !isFile ? toEmbed(media) : null;
  return (
    <>
      {l.type === 'video' && media && (
        <Panel className="mb-4">
          {isFile ? (
            <video src={media} controls className="w-full rounded-xl bg-black" />
          ) : embed ? (
            <div className="relative w-full overflow-hidden rounded-xl bg-black" style={{ paddingTop: '56.25%' }}>
              <iframe src={embed} title={l.title} className="absolute inset-0 h-full w-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture" allowFullScreen />
            </div>
          ) : (
            <a href={media} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-primary-600 underline"><Play className="h-4 w-4" aria-hidden /> Watch the video</a>
          )}
        </Panel>
      )}
      <Panel><Markdown source={l.body_md || ''} /></Panel>
      <CompleteBar data={data} c={c} hint="Finished reading? Mark it complete to unlock the next lesson." />
    </>
  );
}

function toEmbed(url: string): string | null {
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`;
  const vm = url.match(/vimeo\.com\/(\d+)/);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`;
  if (/loom\.com\/share\//.test(url)) return url.replace('/share/', '/embed/');
  return null;
}

function ChecklistLesson({ data, onChange }: { data: any; onChange: () => void }) {
  const l = data.lesson;
  const items: string[] = l.config?.items || [];
  const key = `training-checklist-${l.id}`;
  const [ticked, setTicked] = useState<boolean[]>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return items.map(() => !!data.status?.completed);
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(ticked)); } catch { /* ignore */ } }, [key, ticked]);
  const c = useComplete(l.id, onChange);
  const all = items.length > 0 && items.every((_, i) => ticked[i]);
  return (
    <>
      {l.body_md && <Panel className="mb-4"><Markdown source={l.body_md} /></Panel>}
      <Panel title={`Checklist · ${ticked.filter(Boolean).length}/${items.length}`}>
        <ul className="space-y-2">
          {items.map((it, i) => (
            <li key={i}>
              <label className={cn('flex items-start gap-3 rounded-xl border px-4 py-3 text-sm cursor-pointer', ticked[i] ? 'border-emerald-200 bg-emerald-50' : 'border-gray-200 hover:bg-gray-50')}>
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-emerald-600" checked={!!ticked[i]} onChange={() => setTicked((p) => items.map((_, j) => (j === i ? !p[j] : !!p[j])))} />
                <span className="text-gray-800">{it.replace(/\*\*/g, '')}</span>
              </label>
            </li>
          ))}
        </ul>
      </Panel>
      <CompleteBar data={data} c={c} disabled={!all} hint={all ? undefined : 'Tick every item once you have actually done it.'} />
    </>
  );
}

function DeckLesson({ data, onChange }: { data: any; onChange: () => void }) {
  const l = data.lesson;
  const cards: any[] = data.cards || [];
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [seen, setSeen] = useState<Set<number>>(new Set([0]));
  const c = useComplete(l.id, onChange);

  const go = useCallback((n: number) => {
    if (n < 0 || n >= cards.length) return;
    setI(n);
    setFlipped(false);
    setSeen((s) => new Set(s).add(n));
  }, [cards.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); setFlipped((f) => !f); }
      else if (e.key === 'ArrowRight') go(i + 1);
      else if (e.key === 'ArrowLeft') go(i - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, i]);

  if (!cards.length) return <Panel><Empty title="This deck has no cards yet" body="Ask your trainer to add some." /></Panel>;
  const card = cards[i];
  return (
    <>
      {l.body_md && <Panel className="mb-4"><Markdown source={l.body_md} /></Panel>}
      <Panel>
        <div className="mb-3 flex items-center justify-between text-sm text-gray-500">
          <span>Card {i + 1} of {cards.length}</span>
          <span>{seen.size}/{cards.length} seen</span>
        </div>
        <ProgressBar value={(seen.size / cards.length) * 100} className="mb-4" />
        <FlipCard front={card.front} back={card.back} flipped={flipped} onFlip={() => setFlipped(!flipped)} />
        <div className="mt-4 flex items-center justify-between gap-2">
          <Btn variant="secondary" onClick={() => go(i - 1)} disabled={i === 0}><ArrowLeft className="h-4 w-4" aria-hidden /> Previous</Btn>
          <span className="hidden sm:inline text-xs text-gray-400">Space = flip · ← → = move</span>
          <Btn variant="secondary" onClick={() => go(i + 1)} disabled={i >= cards.length - 1}>Next <ArrowRight className="h-4 w-4" aria-hidden /></Btn>
        </div>
      </Panel>
      <p className="mt-3 text-sm text-gray-500">These cards now also show up in your <Link href="/agent/training/flashcards" className="text-primary-600 underline">spaced-repetition queue</Link>, so you will see them again right before you would forget them.</p>
      <CompleteBar data={data} c={c} disabled={seen.size < cards.length} hint={seen.size < cards.length ? 'Look at every card once to finish the deck.' : undefined} />
    </>
  );
}

function RoleplayLesson({ data }: { data: any }) {
  const l = data.lesson;
  const router = useRouter();
  const cfg = l.config || {};
  const scenarios: any[] = data.scenarios || [];
  const sessions: any[] = data.my_sessions || [];
  const minScore = Number(cfg.min_score || 0);
  const need = Number(cfg.min_sessions || 1);
  const isExam = cfg.purpose === 'exam';
  const graded = sessions.filter((s) => ['scored', 'needs_review', 'reviewed'].includes(s.status));
  const qualifying = graded.filter((s) => (Number(s.final_score) || 0) >= minScore);
  const reviewed = qualifying.filter((s) => s.human_reviewed).length;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const start = async (code: string) => {
    setBusy(code);
    setError(null);
    try {
      const r = await tapi<any>('/roleplays', { method: 'POST', body: { scenario_code: code, purpose: cfg.purpose || 'practice', lesson_id: l.id, mode: 'text' } });
      router.push(`/agent/training/roleplay/${r.session.id}`);
    } catch (e) {
      setError(e);
      setBusy(null);
    }
  };

  return (
    <>
      {data.ai && !data.ai.available && <StandardModeBanner message={`${data.ai.message || 'AI unavailable — using standard mode'}. Roleplays run as scripted calls: you pick what to say from the options.`} />}
      {l.body_md && <Panel className="mb-4"><Markdown source={l.body_md} /></Panel>}

      <Panel className="mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-gray-900">Your progress</div>
            <p className="text-sm text-gray-600">
              {need} {isExam ? 'graded ' : ''}roleplay{need > 1 ? 's' : ''}{minScore ? ` scoring ${minScore}/100 or more` : ''} needed · you have <strong>{Math.min(qualifying.length, need)}</strong>
            </p>
          </div>
          {data.status?.completed ? <Pill tone="green">Lesson complete</Pill> : <Pill tone="gray">{qualifying.length}/{need}</Pill>}
        </div>
        <ProgressBar value={(Math.min(qualifying.length, need) / need) * 100} className="mt-3" tone={data.status?.completed ? 'green' : 'primary'} />
        {isExam && (
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-violet-50 border border-violet-200 px-3 py-2 text-sm text-violet-900">
            <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
            <span>These are graded certification calls. Every exam roleplay goes to your trainer, and at least one must be <strong>trainer-reviewed</strong> before it counts ({reviewed} reviewed so far). You will get a notification when it is done.</span>
          </div>
        )}
      </Panel>

      <ErrorNote error={error} />
      <Panel title="Pick a call to practise" className="mb-4">
        {scenarios.length === 0 ? <p className="text-sm text-gray-500">No scenarios are set up for this lesson yet.</p> : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {scenarios.map((s) => {
              const mine = sessions.filter((x) => x.scenario_code === s.code);
              const best = mine.reduce((m, x) => Math.max(m, Number(x.final_score) || 0), 0);
              return (
                <li key={s.id} className="flex flex-col rounded-xl border border-gray-200 p-4">
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    <Pill tone="gray">Difficulty {s.difficulty}/5</Pill>
                    {s.exam_kind && <Pill tone="violet">Exam: {s.exam_kind}</Pill>}
                    {s.state && <Pill tone="blue">{s.state}</Pill>}
                  </div>
                  <h3 className="font-semibold text-gray-900">{s.title}</h3>
                  {s.firm_type && <p className="text-xs text-gray-500 mt-0.5">{s.firm_type}</p>}
                  <p className="mt-2 text-sm text-gray-600 line-clamp-4">{s.objective}</p>
                  <div className="mt-auto pt-3 flex items-center justify-between gap-2">
                    <span className="text-xs text-gray-500">{mine.length ? <>Best <span className={cn('font-semibold', scoreTone(best))}>{best}</span> · {mine.length} tries</> : 'Not tried yet'}</span>
                    <Btn size="sm" onClick={() => start(s.code)} disabled={!!busy}><Phone className="h-4 w-4" aria-hidden /> {busy === s.code ? 'Dialing…' : 'Start call'}</Btn>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {sessions.length > 0 && (
        <Panel title="Your sessions">
          <ul className="divide-y divide-gray-100">
            {sessions.map((s) => {
              const st = REVIEW_STATUS[s.status] || { label: s.status, tone: 'gray' as const };
              return (
                <li key={s.id}>
                  <Link href={`/agent/training/roleplay/${s.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5 hover:bg-gray-50 -mx-2 px-2 rounded-lg">
                    <span className="text-sm text-gray-700">{s.scenario_code} · {fmtDate(s.started_at, true)}</span>
                    <span className="flex items-center gap-2">
                      {s.human_reviewed && <Pill tone="green">Trainer reviewed</Pill>}
                      <Pill tone={st.tone}>{st.label}</Pill>
                      <span className={cn('w-10 text-right font-semibold tabular-nums', scoreTone(s.final_score === null ? null : Number(s.final_score)))}>{s.final_score === null ? '—' : Math.round(Number(s.final_score))}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
    </>
  );
}
