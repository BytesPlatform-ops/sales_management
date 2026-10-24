'use client';

/**
 * Quiz / timed exam / classification drill / objection drill player for the
 * lesson screen: intro → questions → results.
 */
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, ArrowLeft, ArrowRight, CheckCircle2, XCircle, Hourglass, Timer, AlertTriangle, Globe, MapPin, Eye, RotateCcw } from 'lucide-react';
import { tapi, ApiError, fmtDate, SERVICE_LABELS } from '@/lib/training/client';
import { Panel, Btn, ErrorNote, Pill, StandardModeBanner, inputCls, scoreTone, Spinner } from '@/components/training/ui';
import { Celebrate, SelfScore, fmtTime, timeUntil, useTick } from './common';
import { cn } from '@/lib/utils';

type Kind = 'quiz' | 'exam' | 'classification' | 'objection';

function kindOf(lesson: any): Kind {
  if (lesson.type === 'drill') return lesson.config?.kind === 'objection' ? 'objection' : 'classification';
  return lesson.type === 'exam' ? 'exam' : 'quiz';
}

const KIND_INTRO: Record<Kind, string> = {
  quiz: 'A short quiz on this course. Questions and answer options are shuffled every time.',
  exam: 'A timed exam drawn from the whole track. The clock starts when you press Start and the exam submits itself when time runs out.',
  classification: 'You get real SAM.gov rows. For each one pick the service you would lead with and say why in one line.',
  objection: 'You get real objections. Type what you would say on the phone. Use A-C-I-R-R: Acknowledge, Clarify, Isolate, Respond, Re-ask for the meeting.',
};

function useDraft<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [val, setVal] = useState<T>(() => {
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem(key) : null;
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* storage unavailable */ }
  }, [key, val]);
  return [val, setVal];
}

function clearDraft(key: string) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

export function AttemptLesson({ data, onChange }: { data: any; onChange: () => void }) {
  const lesson = data.lesson;
  const kind = kindOf(lesson);
  const [stage, setStage] = useState<'intro' | 'active' | 'results'>('intro');
  const [attempt, setAttempt] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<unknown>(null);
  const [cooldown, setCooldown] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    setError(null);
    setCooldown(null);
    try {
      const r = await tapi<any>(`/lessons/${lesson.id}/attempts`, { method: 'POST' });
      setAttempt(r.attempt);
      setStage('active');
      window.scrollTo({ top: 0 });
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) setCooldown(e.message);
      else setError(e);
    } finally {
      setBusy(false);
    }
  };

  const submit = useCallback(async (body: any) => {
    const r = await tapi<any>(`/attempts/${attempt.id}`, { method: 'PUT', body });
    clearDraft(`training-attempt-${attempt.id}`);
    setResult(r);
    setStage('results');
    window.scrollTo({ top: 0 });
    onChange();
  }, [attempt, onChange]);

  if (stage === 'active' && attempt) {
    const props = { attempt, lesson, onSubmit: submit };
    if (kind === 'classification') return <ClassificationRunner {...props} />;
    if (kind === 'objection') return <ObjectionRunner {...props} />;
    return <QuestionRunner {...props} timed={kind === 'exam'} />;
  }

  if (stage === 'results' && result) {
    return (
      <ResultsView result={result} attempt={attempt} kind={kind} next={data.next}
        onRetake={() => { setStage('intro'); setResult(null); setAttempt(null); }} />
    );
  }

  // ---- intro
  const attempts: any[] = data.attempts || [];
  const open = attempts.find((a) => !a.finished_at);
  const cooldownUntil = data.status?.cooldown_until;
  const count = kind === 'classification' || kind === 'objection' ? Number(lesson.config?.count || 10) : data.question_count;
  const passed = data.status?.completed;

  return (
    <Panel>
      <p className="text-gray-700">{KIND_INTRO[kind]}</p>
      <dl className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Fact label={kind === 'classification' ? 'Rows' : kind === 'objection' ? 'Objections' : 'Questions'} value={count ?? '—'} />
        <Fact label="To pass" value={`${lesson.pass_pct}%`} />
        <Fact label="Time limit" value={kind === 'exam' && lesson.config?.time_limit_min ? `${lesson.config.time_limit_min} min` : 'None'} />
        <Fact label="Best so far" value={data.status?.best_score !== null && data.status?.best_score !== undefined ? `${data.status.best_score}%` : '—'} />
      </dl>

      {passed && <div className="mt-4 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800">You already passed this. You can retake it any time for practice.</div>}
      {(cooldown || cooldownUntil) && (
        <div className="mt-4 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
          <Hourglass className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
          <span>{cooldown || `Short break after a missed attempt: you can retake at ${fmtTime(cooldownUntil)} (in ${timeUntil(cooldownUntil)}). Re-read the lessons meanwhile — that is what the break is for.`}</span>
        </div>
      )}
      <ErrorNote error={error} />

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Btn onClick={start} disabled={busy /* the server enforces the cooldown (429) */}>
          {busy ? 'Starting…' : open ? 'Resume attempt' : attempts.length ? 'Start a new attempt' : kind === 'exam' ? 'Start exam' : 'Start'}
        </Btn>
        {kind === 'exam' && <span className="text-xs text-gray-500">Find a quiet spot first: the timer keeps running if you leave the page.</span>}
      </div>

      {attempts.filter((a) => a.finished_at).length > 0 && (
        <div className="mt-6">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Previous attempts</h3>
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
            {attempts.filter((a) => a.finished_at).map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="text-gray-600">{fmtDate(a.finished_at, true)}</span>
                <span className="flex items-center gap-2">
                  <span className={cn('font-semibold tabular-nums', scoreTone(Number(a.score_pct)))}>{Math.round(Number(a.score_pct))}%</span>
                  {a.passed ? <Pill tone="green">Passed</Pill> : <Pill tone="amber">Not yet</Pill>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2">
      <dt className="text-[11px] uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="text-lg font-bold text-gray-900 tabular-nums">{value}</dd>
    </div>
  );
}

// ------------------------------------------------------------------ shared stepper

function Stepper({ count, index, setIndex, answered, label }: { count: number; index: number; setIndex: (i: number) => void; answered: boolean[]; label: string }) {
  return (
    <nav aria-label={`${label} navigator`} className="flex flex-wrap gap-1.5">
      {Array.from({ length: count }, (_, i) => (
        <button key={i} type="button" onClick={() => setIndex(i)} aria-current={i === index ? 'step' : undefined}
          aria-label={`${label} ${i + 1}${answered[i] ? ', answered' : ', not answered'}`}
          className={cn('h-8 min-w-[2rem] rounded-lg px-2 text-xs font-semibold tabular-nums border focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
            i === index ? 'bg-primary-600 text-white border-primary-600' : answered[i] ? 'bg-primary-50 text-primary-700 border-primary-200' : 'bg-white text-gray-500 border-gray-300 hover:bg-gray-50')}>
          {i + 1}
        </button>
      ))}
    </nav>
  );
}

function RunnerShell({ title, count, index, setIndex, answered, label, children, onSubmit, submitting, error, topRight, extraWarning }: {
  title: string; count: number; index: number; setIndex: (i: number) => void; answered: boolean[]; label: string; children: ReactNode;
  onSubmit: (force: boolean) => void; submitting: boolean; error: unknown; topRight?: ReactNode; extraWarning?: string | null;
}) {
  const [confirm, setConfirm] = useState(false);
  const missing = answered.filter((a) => !a).length;
  const trySubmit = () => {
    if (missing > 0 || extraWarning) setConfirm(true);
    else onSubmit(false);
  };
  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 -mx-1 px-1 py-2 bg-gray-50/95 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-gray-600"><span className="font-semibold text-gray-900">{title}</span> · {label} {index + 1} of {count} · {count - missing} answered</div>
          {topRight}
        </div>
        <div className="mt-2"><Stepper count={count} index={index} setIndex={setIndex} answered={answered} label={label} /></div>
      </div>

      <Panel>{children}</Panel>

      <ErrorNote error={error} />
      {confirm && (
        <div role="alertdialog" aria-label="Submit with gaps?" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
            <div>
              {missing > 0 && <p><strong>{missing}</strong> {label.toLowerCase()}{missing > 1 ? 's are' : ' is'} still unanswered. Unanswered ones count as wrong.</p>}
              {extraWarning && <p>{extraWarning}</p>}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Btn size="sm" variant="secondary" onClick={() => { setConfirm(false); const first = answered.findIndex((a) => !a); if (first >= 0) setIndex(first); }}>Go back and finish</Btn>
            <Btn size="sm" onClick={() => { setConfirm(false); onSubmit(true); }} disabled={submitting}>Submit anyway</Btn>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <Btn variant="secondary" onClick={() => setIndex(Math.max(0, index - 1))} disabled={index === 0}><ArrowLeft className="h-4 w-4" aria-hidden /> Previous</Btn>
          <Btn variant="secondary" onClick={() => setIndex(Math.min(count - 1, index + 1))} disabled={index >= count - 1}>Next <ArrowRight className="h-4 w-4" aria-hidden /></Btn>
        </div>
        <Btn onClick={trySubmit} disabled={submitting}>{submitting ? 'Grading…' : 'Submit answers'}</Btn>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ quiz / exam

function QuestionRunner({ attempt, lesson, onSubmit, timed }: { attempt: any; lesson: any; onSubmit: (b: any) => Promise<void>; timed: boolean }) {
  const items: any[] = attempt.items || [];
  const [answers, setAnswers] = useDraft<Record<string, any>>(`training-attempt-${attempt.id}`, {});
  const [index, setIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const autoSent = useRef(false);

  const fullAnswers = useMemo(() => {
    const out: Record<string, any> = { ...answers };
    for (const q of items) if (q.type === 'order' && out[q.id] === undefined) out[q.id] = q.options.map((_: any, i: number) => i);
    return out;
  }, [answers, items]);

  const isAnswered = (q: any) => {
    const a = fullAnswers[q.id];
    if (q.type === 'multi') return Array.isArray(a) && a.length > 0;
    if (q.type === 'short_answer') return typeof a === 'string' && a.trim().length > 0;
    return a !== undefined && a !== null;
  };

  const send = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ answers: fullAnswers });
    } catch (e) {
      setError(e);
      setSubmitting(false);
    }
  }, [fullAnswers, onSubmit]);

  // Exam countdown + auto-submit.
  useTick(1000, timed && !!attempt.expires_at);
  const remaining = attempt.expires_at ? new Date(attempt.expires_at).getTime() - Date.now() : null;
  useEffect(() => {
    if (timed && remaining !== null && remaining <= 0 && !autoSent.current && !submitting) {
      autoSent.current = true;
      send();
    }
  }, [timed, remaining, submitting, send]);

  const q = items[index];
  if (!q) return <Spinner />;
  const set = (v: any) => setAnswers((p) => ({ ...p, [q.id]: v }));

  const timer = timed && remaining !== null ? (
    <div role="timer" aria-live="off" className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold tabular-nums',
      remaining < 5 * 60_000 ? 'bg-red-100 text-red-700' : 'bg-white border border-gray-200 text-gray-700')}>
      <Timer className="h-4 w-4" aria-hidden />
      {remaining <= 0 ? 'Time is up — submitting…' : `${Math.floor(remaining / 60000)}:${String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0')} left`}
    </div>
  ) : null;

  return (
    <RunnerShell title={lesson.title} count={items.length} index={index} setIndex={setIndex} answered={items.map(isAnswered)} label="Question"
      onSubmit={() => send()} submitting={submitting} error={error} topRight={timer}>
      <fieldset key={q.id}>
        <legend className="text-lg font-semibold text-gray-900 whitespace-pre-wrap">{q.prompt}</legend>
        <p className="mt-1 mb-4 text-xs text-gray-500">
          {q.type === 'multi' ? 'Pick every answer that is right.' : q.type === 'order' ? 'Put these in the right order using the arrows (top = first).' : q.type === 'short_answer' ? 'Answer in your own words — a sentence or two is enough.' : 'Pick one answer.'}
        </p>
        {(q.type === 'mcq' || q.type === 'true_false') && (
          <div className="space-y-2">
            {q.options.map((o: string, i: number) => (
              <label key={i} className={cn('flex items-start gap-3 rounded-xl border px-4 py-3 cursor-pointer text-sm transition-colors',
                fullAnswers[q.id] === i ? 'border-primary-400 bg-primary-50' : 'border-gray-200 hover:bg-gray-50')}>
                <input type="radio" name={`q-${q.id}`} className="mt-0.5 accent-primary-600" checked={fullAnswers[q.id] === i} onChange={() => set(i)} />
                <span className="text-gray-800">{o}</span>
              </label>
            ))}
          </div>
        )}
        {q.type === 'multi' && (
          <div className="space-y-2">
            {q.options.map((o: string, i: number) => {
              const cur: number[] = Array.isArray(fullAnswers[q.id]) ? fullAnswers[q.id] : [];
              const on = cur.includes(i);
              return (
                <label key={i} className={cn('flex items-start gap-3 rounded-xl border px-4 py-3 cursor-pointer text-sm transition-colors',
                  on ? 'border-primary-400 bg-primary-50' : 'border-gray-200 hover:bg-gray-50')}>
                  <input type="checkbox" className="mt-0.5 accent-primary-600" checked={on} onChange={() => set(on ? cur.filter((x) => x !== i) : [...cur, i].sort((a, b) => a - b))} />
                  <span className="text-gray-800">{o}</span>
                </label>
              );
            })}
          </div>
        )}
        {q.type === 'order' && (
          <ol className="space-y-2">
            {(fullAnswers[q.id] as number[]).map((optIdx, pos, arr) => {
              const move = (dir: -1 | 1) => {
                const next = [...arr];
                [next[pos], next[pos + dir]] = [next[pos + dir], next[pos]];
                set(next);
              };
              return (
                <li key={optIdx} className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-600">{pos + 1}</span>
                  <span className="flex-1 text-gray-800">{q.options[optIdx]}</span>
                  <span className="flex gap-1">
                    <button type="button" onClick={() => move(-1)} disabled={pos === 0} aria-label={`Move "${q.options[optIdx]}" up`}
                      className="rounded-md border border-gray-200 p-1.5 text-gray-600 hover:bg-gray-50 disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"><ArrowUp className="h-4 w-4" /></button>
                    <button type="button" onClick={() => move(1)} disabled={pos === arr.length - 1} aria-label={`Move "${q.options[optIdx]}" down`}
                      className="rounded-md border border-gray-200 p-1.5 text-gray-600 hover:bg-gray-50 disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"><ArrowDown className="h-4 w-4" /></button>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
        {q.type === 'short_answer' && (
          <>
            <label htmlFor={`sa-${q.id}`} className="sr-only">Your answer</label>
            <textarea id={`sa-${q.id}`} rows={4} className={inputCls} value={fullAnswers[q.id] || ''} onChange={(e) => set(e.target.value)} placeholder="Type your answer…" />
          </>
        )}
      </fieldset>
    </RunnerShell>
  );
}

// ------------------------------------------------------------------ classification drill

export function SamRow({ item }: { item: any }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold text-gray-900">{item.firm_name}</h3>
        {item.city_state && <span className="inline-flex items-center gap-1 text-xs text-gray-500"><MapPin className="h-3.5 w-3.5" aria-hidden /> {item.city_state}</span>}
      </div>
      <div className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Capabilities narrative</div>
      <p className="text-sm text-gray-700 whitespace-pre-wrap">{item.narrative || '—'}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <Globe className="h-4 w-4 text-gray-400" aria-hidden />
        {item.website_url ? <span className="text-gray-700 break-all">{item.website_url}</span> : <Pill tone="amber">NO SITE</Pill>}
      </div>
      {(item.scan_summary || item.scan_flags?.length) && (
        <div className="mt-3 rounded-lg bg-white border border-gray-200 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">What the 30-second website scan found</div>
          {item.scan_summary && <p className="mt-1 text-sm text-gray-700">{item.scan_summary}</p>}
          {item.scan_flags?.length ? (
            <div className="mt-2 flex flex-wrap gap-1">{item.scan_flags.map((f: string) => <Pill key={f} tone="gray">{f.replace(/_/g, ' ')}</Pill>)}</div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ClassificationRunner({ attempt, lesson, onSubmit }: { attempt: any; lesson: any; onSubmit: (b: any) => Promise<void> }) {
  const items: any[] = attempt.items || [];
  const options: { value: string; label: string }[] = attempt.service_options || Object.entries(SERVICE_LABELS).map(([value, label]) => ({ value, label }));
  const [answers, setAnswers] = useDraft<Record<string, { service?: string; reason?: string }>>(`training-attempt-${attempt.id}`, {});
  const [index, setIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const item = items[index];
  if (!item) return <Spinner />;
  const a = answers[item.id] || {};
  const set = (patch: any) => setAnswers((p) => ({ ...p, [item.id]: { ...(p[item.id] || {}), ...patch } }));

  const send = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ items: items.map((it) => ({ id: it.id, service: answers[it.id]?.service || null, reason: answers[it.id]?.reason || '' })) });
    } catch (e) {
      setError(e);
      setSubmitting(false);
    }
  };

  return (
    <RunnerShell title={lesson.title} count={items.length} index={index} setIndex={setIndex} answered={items.map((it) => !!answers[it.id]?.service)} label="Row"
      onSubmit={send} submitting={submitting} error={error}>
      <SamRow item={item} />
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`svc-${item.id}`} className="block text-sm font-medium text-gray-700 mb-1">Service to lead with</label>
          <select id={`svc-${item.id}`} className={inputCls} value={a.service || ''} onChange={(e) => set({ service: e.target.value })}>
            <option value="">Choose a service…</option>
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`why-${item.id}`} className="block text-sm font-medium text-gray-700 mb-1">Why? (one line)</label>
          <input id={`why-${item.id}`} className={inputCls} value={a.reason || ''} onChange={(e) => set({ reason: e.target.value })} placeholder="e.g. No site at all, so start with a new website" />
        </div>
      </div>
    </RunnerShell>
  );
}

// ------------------------------------------------------------------ objection drill

function ObjectionRunner({ attempt, lesson, onSubmit }: { attempt: any; lesson: any; onSubmit: (b: any) => Promise<void> }) {
  const items: any[] = attempt.items || [];
  const standard = attempt.ai_available === false;
  const [answers, setAnswers] = useDraft<Record<string, { reply?: string; self_score?: number | null }>>(`training-attempt-${attempt.id}`, {});
  const [models, setModels] = useState<Record<string, any>>({});
  const [loadingModel, setLoadingModel] = useState<number | null>(null);
  const [index, setIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const item = items[index];
  if (!item) return <Spinner />;
  const a = answers[item.id] || {};
  const set = (patch: any) => setAnswers((p) => ({ ...p, [item.id]: { ...(p[item.id] || {}), ...patch } }));

  const reveal = async () => {
    setLoadingModel(item.id);
    setError(null);
    try {
      const m = await tapi<any>(`/attempts/${attempt.id}/objections/${item.id}`);
      setModels((p) => ({ ...p, [item.id]: m }));
    } catch (e) {
      setError(e);
    } finally {
      setLoadingModel(null);
    }
  };

  const answered = items.map((it) => {
    const x = answers[it.id];
    return !!x?.reply?.trim() && (!standard || (x.self_score !== null && x.self_score !== undefined));
  });

  const send = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ items: items.map((it) => ({ id: it.id, reply: answers[it.id]?.reply || '', self_score: answers[it.id]?.self_score ?? undefined })) });
    } catch (e) {
      setError(e);
      setSubmitting(false);
    }
  };

  const model = models[item.id];
  return (
    <div>
      {standard && <StandardModeBanner message={`${attempt.ai_message || 'AI unavailable — using standard mode'}. After you type each reply, compare it with the model answer and score yourself honestly.`} />}
      <RunnerShell title={lesson.title} count={items.length} index={index} setIndex={setIndex} answered={answered} label="Objection"
        onSubmit={send} submitting={submitting} error={error}>
        <div className="rounded-xl bg-gray-900 px-4 py-3 text-white">
          <div className="text-[11px] uppercase tracking-wide text-gray-400">The prospect says</div>
          <p className="mt-1 text-lg font-semibold">“{item.objection}”</p>
        </div>
        <label htmlFor={`reply-${item.id}`} className="mt-4 block text-sm font-medium text-gray-700">What do you say?</label>
        <p className="text-xs text-gray-500 mb-1">Acknowledge → Clarify → Isolate → Respond → Re-ask for the meeting.</p>
        <textarea id={`reply-${item.id}`} rows={4} className={inputCls} value={a.reply || ''} onChange={(e) => set({ reply: e.target.value })}
          placeholder="Totally fair… Just so I understand, … Other than that, … Would it hurt to …?" />

        {standard && (
          <div className="mt-4">
            {!model ? (
              <Btn variant="secondary" onClick={reveal} disabled={!a.reply?.trim() || loadingModel === item.id}>
                <Eye className="h-4 w-4" aria-hidden /> {loadingModel === item.id ? 'Loading…' : 'Compare with model answer'}
              </Btn>
            ) : (
              <div className="space-y-4">
                <div className="rounded-xl border border-primary-100 bg-primary-50 p-4 text-sm">
                  {model.principle && <p className="text-primary-900"><span className="font-semibold">Principle:</span> {model.principle}</p>}
                  {model.why && <p className="mt-1 text-primary-900"><span className="font-semibold">Why they say it:</span> {model.why}</p>}
                  {model.quick_response && <p className="mt-2 text-primary-900"><span className="font-semibold">Quick response:</span> “{String(model.quick_response).trim().replace(/^["“]+|["”]+$/g, '')}”</p>}
                  {model.responses?.length ? (
                    <div className="mt-2">
                      <div className="font-semibold text-primary-900">Model answers</div>
                      <ol className="mt-1 list-decimal pl-5 space-y-1 text-primary-900">{model.responses.map((r: string, i: number) => <li key={i}>{r}</li>)}</ol>
                    </div>
                  ) : null}
                </div>
                <SelfScore value={a.self_score ?? null} onChange={(n) => set({ self_score: n })} />
              </div>
            )}
            {!a.reply?.trim() && <p className="mt-2 text-xs text-gray-500">Type your reply first — then you can see the model answer.</p>}
          </div>
        )}
      </RunnerShell>
    </div>
  );
}

// ------------------------------------------------------------------ results

function describeAnswer(q: any, ans: any): string {
  if (ans === null || ans === undefined || ans === '') return 'No answer';
  if (!q) return String(ans);
  if (q.type === 'mcq' || q.type === 'true_false') return q.options?.[Number(ans)] ?? String(ans);
  if (q.type === 'multi') return (Array.isArray(ans) ? ans : []).map((i: number) => q.options?.[i]).join(' + ') || 'No answer';
  if (q.type === 'order') return (Array.isArray(ans) ? ans : []).map((i: number) => q.options?.[i]).join(' → ');
  return String(ans);
}

function ResultsView({ result, attempt, kind, next, onRetake }: { result: any; attempt: any; kind: Kind; next: any; onRetake: () => void }) {
  useTick(15000, !!result.retake_after);
  const items: any[] = attempt?.items || [];
  const byId = new Map(items.map((i) => [Number(i.id), i]));
  const score = Math.round(Number(result.score_pct));
  const canRetake = !result.retake_after || new Date(result.retake_after) <= new Date();
  const right = (result.results || []).filter((r: any) => (kind === 'objection' ? r.score >= 7 : r.correct)).length;
  const serviceLabel = (v: string | null) => (v ? attempt?.service_options?.find((o: any) => o.value === v)?.label || SERVICE_LABELS[v] || v : 'No answer');

  return (
    <div className="space-y-4">
      <Celebrate certs={result.new_certifications} badges={result.new_badges} />
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-400">Your score</div>
            <div className={cn('text-5xl font-extrabold tabular-nums', scoreTone(score))}>{score}%</div>
            <div className="mt-1 text-sm text-gray-500">
              {kind === 'objection' ? `${right} of ${result.results?.length || 0} replies scored 7/10 or better` : `${right} of ${result.results?.length || 0} correct`} · pass mark {result.pass_pct}%
            </div>
          </div>
          <div className="text-right">
            {result.passed ? (
              <div className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-4 py-2 font-semibold text-emerald-700"><CheckCircle2 className="h-5 w-5" aria-hidden /> Passed</div>
            ) : (
              <div className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-4 py-2 font-semibold text-amber-800"><XCircle className="h-5 w-5" aria-hidden /> Not yet</div>
            )}
          </div>
        </div>
        {result.late && <p className="mt-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">This was submitted after the time limit, so it can&apos;t count as a pass.</p>}
        {!result.passed && (
          <p className="mt-3 text-sm text-gray-600">
            Read the explanations below, review the lessons, then try again{!canRetake ? <> at <strong>{fmtTime(result.retake_after)}</strong> (in {timeUntil(result.retake_after)})</> : ''}. You get unlimited retakes.
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {result.passed && next && <Link href={`/agent/training/lesson/${next.id}`}><Btn>Next lesson: {next.title} <ArrowRight className="h-4 w-4" aria-hidden /></Btn></Link>}
          <Btn variant={result.passed ? 'secondary' : 'primary'} onClick={onRetake} disabled={!canRetake}><RotateCcw className="h-4 w-4" aria-hidden /> {canRetake ? 'Retake' : `Retake in ${timeUntil(result.retake_after)}`}</Btn>
          <Link href="/agent/training"><Btn variant="ghost">Back to my path</Btn></Link>
        </div>
      </Panel>

      <Panel title="Review your answers">
        <ol className="space-y-4">
          {(result.results || []).map((r: any, i: number) => {
            if (kind === 'objection') {
              return (
                <li key={i} className="rounded-xl border border-gray-200 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="font-semibold text-gray-900">“{r.objection}”</p>
                    <span className={cn('text-lg font-bold tabular-nums', scoreTone(r.score * 10))}>{r.score}/10</span>
                  </div>
                  <p className="mt-2 text-sm text-gray-600"><span className="font-medium text-gray-800">You said:</span> {r.reply || <em>nothing</em>}</p>
                  {r.feedback && <p className="mt-1 text-sm text-gray-600">{r.feedback}</p>}
                  {r.missing_steps?.length ? (
                    <div className="mt-2 flex flex-wrap items-center gap-1 text-xs text-gray-500">Missing steps: {r.missing_steps.map((s: string) => <Pill key={s} tone="amber">{s.replace(/_/g, ' ')}</Pill>)}</div>
                  ) : null}
                  {r.better_line && <p className="mt-2 rounded-lg bg-primary-50 px-3 py-2 text-sm text-primary-900"><span className="font-semibold">Try this:</span> “{String(r.better_line).trim().replace(/^["“]+|["”]+$/g, '')}”</p>}
                </li>
              );
            }
            if (kind === 'classification') {
              const it = byId.get(Number(r.id));
              return (
                <li key={i} className="rounded-xl border border-gray-200 p-4">
                  <div className="flex items-start gap-2">
                    {r.correct ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" aria-label="Correct" /> : <XCircle className="h-5 w-5 shrink-0 text-red-500" aria-label="Incorrect" />}
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900">{it?.firm_name || `Row ${i + 1}`}</p>
                      <p className="text-sm text-gray-600">You picked: <strong>{serviceLabel(r.answer)}</strong>{r.reason_given ? ` — “${r.reason_given}”` : ''}</p>
                      {!r.correct && <p className="text-sm text-gray-600">Best answer: <strong>{r.correct_label}</strong></p>}
                      {r.explanation && <p className="mt-1 text-sm text-gray-500">{r.explanation}</p>}
                    </div>
                  </div>
                </li>
              );
            }
            const q = byId.get(Number(r.id));
            return (
              <li key={i} className="rounded-xl border border-gray-200 p-4">
                <div className="flex items-start gap-2">
                  {r.correct ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" aria-label="Correct" /> : <XCircle className="h-5 w-5 shrink-0 text-red-500" aria-label="Incorrect" />}
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 whitespace-pre-wrap">{q?.prompt || `Question ${i + 1}`}</p>
                    <p className="mt-1 text-sm text-gray-600">Your answer: {describeAnswer(q, r.answer)}</p>
                    {!r.correct && r.correct_answer && <p className="text-sm text-gray-600">Correct answer: <strong>{r.correct_answer}</strong></p>}
                    {r.feedback && <p className="mt-1 text-sm text-gray-500">{r.feedback}</p>}
                    {r.explanation && <p className="mt-1 text-sm text-gray-500">{r.explanation}</p>}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </Panel>
    </div>
  );
}
