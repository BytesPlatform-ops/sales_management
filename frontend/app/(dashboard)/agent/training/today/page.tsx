'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Flame, Layers, Mic, Phone, Headphones, Sun, Upload, Eye } from 'lucide-react';
import { tapi, useTraining, fmtDate } from '@/lib/training/client';
import { useAuth } from '@/hooks/use-auth';
import { PageHeader, Panel, ErrorNote, Spinner, Pill, Btn, ProgressBar, StandardModeBanner, Stat, inputCls, scoreTone } from '@/components/training/ui';
import { FlipCard, RatingButtons, SelfScore, useRecorder, RecordButton, REVIEW_STATUS } from '@/components/training/rep/common';
import { SamRow } from '@/components/training/rep/attempt-player';
import { cn } from '@/lib/utils';

export default function TodayPage() {
  const { user } = useAuth();
  const router = useRouter();
  const drill = useTraining<any>('/drills/today');
  const me = useTraining<any>('/me');
  const due = useTraining<any>('/flashcards/due');
  const rp = useTraining<any>('/roleplays');
  const calls = useTraining<any[]>('/call-reviews');
  const board = useTraining<any[]>('/leaderboard?period=week');
  const [startErr, setStartErr] = useState<unknown>(null);
  const [starting, setStarting] = useState(false);

  // Results are kept locally too, so feedback stays visible after each submit.
  const [local, setLocal] = useState<Record<string, any>>({});
  const [summary, setSummary] = useState<{ done: boolean; score: number | null } | null>(null);

  const results = useMemo(() => ({ ...(drill.data?.results || {}), ...local }), [drill.data, local]);
  const items: any[] = drill.data?.items || [];
  const doneCount = items.filter((i) => results[`${i.kind}:${i.id}`]?.done).length;
  const completed = summary?.done || !!drill.data?.completed_at;
  const score = summary?.score ?? drill.data?.score_pct;
  const myRow = (board.data || []).find((r) => Number(r.user_id) === Number(user?.id));
  const aiAvailable = !!me.data?.ai?.available;

  const persona = useMemo(() => {
    const list = (rp.data?.scenarios || []).filter((s: any) => !s.exam_kind && s.has_script !== false);
    if (!list.length) return null;
    const d = new Date();
    const dayNum = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
    return list[dayNum % list.length];
  }, [rp.data]);

  const applyDrill = (r: any) => {
    setLocal((p) => ({ ...p, [r.item]: r.result }));
    setSummary({ done: r.drill_completed, score: r.score_pct });
    if (r.drill_completed) { board.mutate(); drill.mutate(); }
  };

  const submit = async (item: any, payload: any) => {
    const r = await tapi<any>('/drills/today', { method: 'POST', body: { kind: item.kind, id: item.id, ...payload } });
    setLocal((p) => ({ ...p, [r.item]: r.result }));
    setSummary({ done: r.drill_completed, score: r.score_pct });
    if (r.drill_completed) { board.mutate(); drill.mutate(); }
    if (item.kind === 'flashcard') due.mutate();
    return r.result;
  };

  const startPersona = async () => {
    if (!persona) return;
    setStarting(true);
    setStartErr(null);
    try {
      const r = await tapi<any>('/roleplays', { method: 'POST', body: { scenario_code: persona.code, purpose: 'daily' } });
      router.push(`/agent/training/roleplay/${r.session.id}`);
    } catch (e) {
      setStartErr(e);
      setStarting(false);
    }
  };

  if (drill.error) return <ErrorNote error={drill.error} />;
  if (!drill.data) return <Spinner label="Building today's drill…" />;

  const dueCount = due.data ? due.data.due_total + due.data.cards.filter((c: any) => c.is_new).length : null;

  return (
    <div>
      <PageHeader title="Today" subtitle="Your 5-minute daily drill keeps the basics sharp. Do it before your first call block." />
      {!aiAvailable && me.data && <StandardModeBanner message={`${me.data.ai?.message || 'AI unavailable — using standard mode'}. Objection replies and your tonality recording are self-rated today.`} />}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Stat label="Drill progress" value={`${doneCount}/${items.length}`} hint={completed ? 'Done for today' : 'items done'} />
        <Stat label="Drill score" value={score !== null && score !== undefined ? `${score}%` : '—'} tone={scoreTone(score)} hint={completed ? 'today' : 'shows when finished'} />
        <Stat label="Streak" value={<span className="inline-flex items-center gap-1"><Flame className="h-5 w-5 text-orange-500" aria-hidden />{myRow?.streak ?? 0}</span>} hint="days in a row" />
        <Stat label="Flashcards due" value={dueCount ?? '—'} hint={<Link href="/agent/training/flashcards" className="text-primary-600 underline">review now</Link>} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 inline-flex items-center gap-2"><Sun className="h-5 w-5 text-amber-500" aria-hidden /> Today&apos;s 5-minute drill</h2>
          </div>
          <ProgressBar value={items.length ? (doneCount / items.length) * 100 : 0} tone={completed ? 'green' : 'primary'} />
          {completed && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">
              <div className="flex items-center gap-2 font-semibold"><CheckCircle2 className="h-5 w-5" aria-hidden /> Drill complete — {score}%</div>
              <p className="mt-1 text-sm">Nice. Come back tomorrow to keep your streak going.</p>
            </div>
          )}
          {items.map((item, i) => (
            <DrillItem key={`${item.kind}:${item.id}`} n={i + 1} item={item} result={results[`${item.kind}:${item.id}`]} aiAvailable={aiAvailable}
              serviceOptions={drill.data.service_options} onSubmit={(payload) => submit(item, payload)} onDrillResponse={applyDrill} />
          ))}
        </div>

        <div className="space-y-4">
          <Panel title="Persona of the day">
            {persona ? (
              <div>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  <Pill tone="gray">Difficulty {persona.difficulty}/5</Pill>
                  {persona.state && <Pill tone="blue">{persona.state}</Pill>}
                </div>
                <h3 className="font-semibold text-gray-900">{persona.title}</h3>
                <p className="mt-1 text-sm text-gray-600 line-clamp-4">{persona.objective}</p>
                <ErrorNote error={startErr} />
                <Btn className="mt-3 w-full" onClick={startPersona} disabled={starting}><Phone className="h-4 w-4" aria-hidden /> {starting ? 'Dialing…' : 'Practise this call'}</Btn>
              </div>
            ) : rp.data ? <p className="text-sm text-gray-500">No practice scenarios yet.</p> : <Spinner />}
          </Panel>

          <Panel title="Flashcards" action={<Link href="/agent/training/flashcards" className="text-sm text-primary-600 hover:underline">Open</Link>}>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary-600"><Layers className="h-5 w-5" aria-hidden /></div>
              <div className="text-sm text-gray-700">
                {dueCount === null ? 'Loading…' : dueCount === 0 ? 'All caught up.' : <><strong>{dueCount}</strong> card{dueCount === 1 ? '' : 's'} waiting for you.</>}
                {due.data?.retention_pct !== null && due.data?.retention_pct !== undefined && <div className="text-xs text-gray-500">Retention {due.data.retention_pct}%</div>}
              </div>
            </div>
          </Panel>

          <Panel title="Your recent call scores" action={<Link href="/agent/training/calls" className="text-sm text-primary-600 hover:underline">All calls</Link>}>
            {!calls.data ? <Spinner /> : calls.data.length === 0 ? (
              <p className="text-sm text-gray-500">No graded calls yet. Once you are live, grade a real call in <Link href="/agent/training/calls" className="text-primary-600 underline">My Calls</Link>.</p>
            ) : (
              <ul className="space-y-2">
                {calls.data.slice(0, 4).map((c) => {
                  const st = REVIEW_STATUS[c.status] || { label: c.status, tone: 'gray' as const };
                  return (
                    <li key={c.id}>
                      <Link href={`/agent/training/calls/${c.id}`} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 -mx-2 hover:bg-gray-50">
                        <span className="flex items-center gap-2 text-sm text-gray-700"><Headphones className="h-4 w-4 text-gray-400" aria-hidden /> {fmtDate(c.created_at, true)}</span>
                        <span className="flex items-center gap-2">
                          <Pill tone={st.tone}>{st.label}</Pill>
                          <span className={cn('w-8 text-right font-semibold tabular-nums', scoreTone(c.final_score === null ? null : Number(c.final_score)))}>{c.final_score === null ? '—' : Math.round(Number(c.final_score))}</span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

const KIND_TITLE: Record<string, string> = {
  flashcard: 'Flashcard',
  objection: 'Handle the objection',
  classification: 'Classify this SAM.gov row',
  tonality: 'Tonality: read the opener out loud',
};

function DrillItem({ n, item, result, aiAvailable, serviceOptions, onSubmit, onDrillResponse }: {
  n: number; item: any; result: any; aiAvailable: boolean; serviceOptions: any[]; onSubmit: (payload: any) => Promise<any>; onDrillResponse: (r: any) => void;
}) {
  const done = !!result?.done;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = async (payload: any) => {
    setBusy(true);
    setError(null);
    try { await onSubmit(payload); } catch (e) { setError(e); } finally { setBusy(false); }
  };

  return (
    <section className={cn('bg-white rounded-2xl border shadow-sm', done ? 'border-emerald-200' : 'border-gray-200')} aria-label={`Drill item ${n}`}>
      <div className="flex items-center justify-between gap-2 px-5 pt-4 pb-3 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-900"><span className="text-gray-400 mr-1.5">{n}.</span>{KIND_TITLE[item.kind] || item.kind}</h3>
        {done && <Pill tone="green"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Done</Pill>}
      </div>
      <div className="p-5">
        {item.kind === 'flashcard' && <FlashcardItem item={item} result={result} busy={busy} onRate={(r) => run({ result: r })} />}
        {item.kind === 'objection' && <ObjectionItem item={item} result={result} busy={busy} aiAvailable={aiAvailable} onSend={run} />}
        {item.kind === 'classification' && <ClassifyItem item={item} result={result} busy={busy} options={serviceOptions} onSend={run} />}
        {item.kind === 'tonality' && <TonalityItem item={item} result={result} onSubmit={onSubmit} onDrillResponse={onDrillResponse} />}
        <div className="mt-3"><ErrorNote error={error} /></div>
      </div>
    </section>
  );
}

function FlashcardItem({ item, result, busy, onRate }: { item: any; result: any; busy: boolean; onRate: (r: any) => void }) {
  const [flipped, setFlipped] = useState(!!result?.done);
  if (!item.front) return <p className="text-sm text-gray-500">This card is no longer available.</p>;
  if (result?.done) return <p className="text-sm text-gray-700"><strong>{item.front}</strong> — {item.back}<span className="block text-xs text-gray-500 mt-1">Rated. Next review {result.next_due ? fmtDate(result.next_due) : 'soon'}.</span></p>;
  return (
    <div className="space-y-3">
      <FlipCard front={item.front} back={item.back} flipped={flipped} onFlip={() => setFlipped(!flipped)} />
      {result?.done ? (
        <p className="text-sm text-gray-600">Rated. Next review {result.next_due ? fmtDate(result.next_due) : 'soon'}.</p>
      ) : flipped ? (
        <RatingButtons onRate={onRate} disabled={busy} />
      ) : (
        <p className="text-xs text-gray-500">Say the answer in your head, then flip the card and rate yourself honestly.</p>
      )}
    </div>
  );
}

function ObjectionItem({ item, result, busy, aiAvailable, onSend }: { item: any; result: any; busy: boolean; aiAvailable: boolean; onSend: (p: any) => void }) {
  const [reply, setReply] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [self, setSelf] = useState<number | null>(null);
  if (!item.objection) return <p className="text-sm text-gray-500">This objection is no longer available.</p>;
  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-gray-900 px-4 py-3 text-white">
        <div className="text-[11px] uppercase tracking-wide text-gray-400">The prospect says</div>
        <p className="mt-1 font-semibold">“{item.objection}”</p>
      </div>
      {result?.done ? (
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2"><span className={cn('text-xl font-bold tabular-nums', scoreTone((result.score_10 ?? 0) * 10))}>{result.score_10 ?? Math.round((result.score || 0) * 10)}/10</span>{result.engine === 'self' && <Pill tone="gray">self-rated</Pill>}</div>
          {result.feedback && <p className="text-gray-600">{result.feedback}</p>}
          {result.better_line && <p className="rounded-lg bg-primary-50 px-3 py-2 text-primary-900"><span className="font-semibold">Try this:</span> “{unquote(result.better_line)}”</p>}
        </div>
      ) : (
        <>
          <label htmlFor={`obj-${item.id}`} className="block text-sm font-medium text-gray-700">Your reply</label>
          <textarea id={`obj-${item.id}`} rows={3} className={inputCls} value={reply} onChange={(e) => setReply(e.target.value)} disabled={revealed}
            placeholder="Acknowledge, clarify, isolate, respond, re-ask…" />
          {aiAvailable ? (
            <Btn onClick={() => onSend({ reply })} disabled={busy || !reply.trim()}>{busy ? 'Checking…' : 'Check my reply'}</Btn>
          ) : !revealed ? (
            <Btn variant="secondary" onClick={() => setRevealed(true)} disabled={!reply.trim()}><Eye className="h-4 w-4" aria-hidden /> Compare with model answer</Btn>
          ) : (
            <div className="space-y-3">
              <div className="rounded-xl border border-primary-100 bg-primary-50 p-4 text-sm text-primary-900">
                {item.principle && <p><span className="font-semibold">Principle:</span> {item.principle}</p>}
                {item.quick_response && <p className="mt-1"><span className="font-semibold">Quick response:</span> “{unquote(item.quick_response)}”</p>}
                {item.model_answers?.length ? (
                  <ol className="mt-2 list-decimal pl-5 space-y-1">{item.model_answers.map((m: string, i: number) => <li key={i}>{m}</li>)}</ol>
                ) : null}
              </div>
              <SelfScore value={self} onChange={setSelf} />
              <Btn onClick={() => onSend({ reply, self_score: self })} disabled={busy || self === null}>{busy ? 'Saving…' : 'Save my score'}</Btn>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ClassifyItem({ item, result, busy, options, onSend }: { item: any; result: any; busy: boolean; options: any[]; onSend: (p: any) => void }) {
  const [service, setService] = useState('');
  const [reason, setReason] = useState('');
  if (!item.firm_name) return <p className="text-sm text-gray-500">This row is no longer available.</p>;
  return (
    <div className="space-y-3">
      <SamRow item={item} />
      {result?.done ? (
        <div className={cn('rounded-lg px-3 py-2 text-sm', result.correct ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900')}>
          <p className="font-semibold">{result.correct ? 'Correct!' : `Best answer: ${result.correct_label}`}</p>
          {result.explanation && <p className="mt-0.5">{result.explanation}</p>}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div>
            <label htmlFor={`cls-${item.id}`} className="block text-sm font-medium text-gray-700 mb-1">Lead with</label>
            <select id={`cls-${item.id}`} className={inputCls} value={service} onChange={(e) => setService(e.target.value)}>
              <option value="">Choose a service…</option>
              {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`clsr-${item.id}`} className="block text-sm font-medium text-gray-700 mb-1">Why? (one line)</label>
            <input id={`clsr-${item.id}`} className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <Btn onClick={() => onSend({ service, reason })} disabled={busy || !service}>{busy ? 'Checking…' : 'Check'}</Btn>
        </div>
      )}
    </div>
  );
}

function TonalityItem({ item, result, onSubmit, onDrillResponse }: { item: any; result: any; onSubmit: (p: any) => Promise<any>; onDrillResponse: (r: any) => void }) {
  const rec = useRecorder();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [analysis, setAnalysis] = useState<any>(null);
  const [selfRate, setSelfRate] = useState<string | null>(null);
  const [self, setSelf] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [skipRecording, setSkipRecording] = useState(false);

  useEffect(() => { if (rec.state === 'error') setSkipRecording(true); }, [rec.state]);

  const upload = async () => {
    if (!rec.blob) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('audio', rec.blob, `opener.${(rec.blob.type.split('/')[1] || 'webm').split(';')[0]}`);
      form.append('seconds', String(rec.seconds));
      const r = await tapi<any>('/drills/tonality', { form });
      if (r.self_rate || r.ai_used === false) setSelfRate(r.ai_message || 'AI unavailable — using standard mode');
      else {
        setAnalysis(r);
        if (r.drill) onDrillResponse(r.drill); // the server already saved this drill item
      }
    } catch (e) {
      setError(e);
    } finally {
      setUploading(false);
    }
  };

  const saveSelf = async () => {
    setSaving(true);
    setError(null);
    try { await onSubmit({ self_score: self }); } catch (e) { setError(e); } finally { setSaving(false); }
  };

  if (result?.done && !analysis) {
    return (
      <div className="text-sm text-gray-700">
        {result.self_rated ? <>Self-rated <strong>{Math.round((result.score || 0) * 10)}/10</strong>.</> : (
          <>Pace <strong>{result.wpm} wpm</strong> ({result.pace}) · <strong>{result.fillers}</strong> filler word{result.fillers === 1 ? '' : 's'}.</>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">Read this out loud like you are on a real call. Aim for about <strong>{item.target_wpm || 140} words per minute</strong>, end statements on a lower note, and pause after the question.</p>
      <blockquote className="rounded-xl border-l-4 border-primary-300 bg-primary-50/60 px-4 py-3 text-gray-800">{item.script}</blockquote>

      {analysis ? (
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-gray-50 p-3"><div className="text-xs text-gray-400">Pace</div><div className="text-xl font-bold tabular-nums">{analysis.wpm}</div><div className="text-xs text-gray-500">wpm · {analysis.pace}</div></div>
          <div className="rounded-xl bg-gray-50 p-3"><div className="text-xs text-gray-400">Filler words</div><div className="text-xl font-bold tabular-nums">{analysis.fillers}</div><div className="text-xs text-gray-500">um, like, basically…</div></div>
          <div className="rounded-xl bg-gray-50 p-3"><div className="text-xs text-gray-400">Words</div><div className="text-xl font-bold tabular-nums">{analysis.words}</div></div>
          {analysis.transcript && <p className="col-span-3 text-left text-xs text-gray-500">We heard: “{analysis.transcript}”</p>}
        </div>
      ) : selfRate || skipRecording ? (
        <div className="space-y-3">
          {selfRate && <StandardModeBanner message={`${selfRate}. Play your recording back and rate yourself.`} />}
          {rec.error && <p className="text-sm text-amber-800">{rec.error}</p>}
          {rec.url && <audio src={rec.url} controls className="w-full" />}
          <SelfScore value={self} onChange={setSelf} label="How did it sound? (0–10): calm pace, lower ending, no fillers" />
          <Btn onClick={saveSelf} disabled={saving || self === null}>{saving ? 'Saving…' : 'Save my rating'}</Btn>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <RecordButton state={rec.state} seconds={rec.seconds} onStart={rec.start} onStop={rec.stop} />
            {rec.state === 'done' && <Btn variant="secondary" onClick={upload} disabled={uploading}><Upload className="h-4 w-4" aria-hidden /> {uploading ? 'Analysing…' : 'Check my pace'}</Btn>}
            <button type="button" onClick={() => setSkipRecording(true)} className="text-sm text-gray-500 underline hover:text-gray-700">Can&apos;t record? Rate yourself</button>
          </div>
          {rec.url && <audio src={rec.url} controls className="w-full" aria-label="Your recording" />}
          {rec.state === 'idle' && <p className="text-xs text-gray-500 inline-flex items-center gap-1"><Mic className="h-3.5 w-3.5" aria-hidden /> Your browser will ask to use the microphone.</p>}
        </div>
      )}
      <ErrorNote error={error} />
    </div>
  );
}

function unquote(t: string) {
  return String(t || '').trim().replace(/^["“]+|["”]+$/g, '');
}
