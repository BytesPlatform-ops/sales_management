'use client';

import { KeyboardEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Building2, Globe, MapPin, PhoneOff, Send, Target, User, Lightbulb, ShieldCheck, RotateCcw } from 'lucide-react';
import { tapi, useTraining, ApiError, fmtDate } from '@/lib/training/client';
import { PageHeader, Panel, ErrorNote, Spinner, Pill, Btn, StandardModeBanner, ScoreCardView, inputCls } from '@/components/training/ui';
import { Celebrate, REVIEW_STATUS, fmtDuration } from '@/components/training/rep/common';
import { VoiceCall, VoiceTurn } from '@/components/training/rep/voice-call';
import { cn } from '@/lib/utils';

export default function RoleplayCallPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, mutate } = useTraining<any>(`/roleplays/${id}`);
  const [transcript, setTranscript] = useState<any[] | null>(null);
  const [scriptView, setScriptView] = useState<any>(undefined);
  const [done, setDone] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [aiDown, setAiDown] = useState<string | null>(null);
  const [finished, setFinished] = useState<any>(null);
  const [voiceFallback, setVoiceFallback] = useState<string | null>(null);
  const [voiceTurns, setVoiceTurns] = useState<VoiceTurn[]>([]);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!data) return;
    setTranscript(data.session.transcript || []);
    setScriptView(data.script_view);
    setDone(!!data.done);
  }, [data]);

  const turns = (data?.session?.mode === 'voice' && !voiceFallback ? voiceTurns : transcript) || [];
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [turns.length]);

  if (error) return <ErrorNote error={error} />;
  if (!data || transcript === null) return <Spinner label="Connecting the call…" />;

  const s = data.session;
  const p = s.persona || {};
  const active = s.status === 'active' && !finished;
  const isScript = s.engine === 'script';
  const isVoice = s.mode === 'voice' && s.engine === 'ai' && !voiceFallback;

  const say = async (body: { text?: string; choice?: number }) => {
    setSending(true);
    setErr(null);
    try {
      const r = await tapi<any>(`/roleplays/${s.id}/turn`, { method: 'POST', body });
      setTranscript(r.transcript);
      setScriptView(r.script_view);
      setDone(!!r.done);
      if (body.text) setText('');
    } catch (e) {
      if (e instanceof ApiError && e.status === 503) {
        setAiDown(e.message || 'AI unavailable — using standard mode');
        if (body.text) setTranscript((t) => [...(t || []), { role: 'rep', text: body.text, at: new Date().toISOString() }]);
        setText('');
      } else setErr(e);
    } finally {
      setSending(false);
    }
  };

  const finish = async (voice?: { turns: VoiceTurn[]; duration: number }) => {
    setFinishing(true);
    setErr(null);
    try {
      const r = await tapi<any>(`/roleplays/${s.id}/finish`, { method: 'POST', body: voice ? { transcript: voice.turns, duration_s: voice.duration } : {} });
      setFinished(r);
      mutate();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setErr(e);
    } finally {
      setFinishing(false);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (text.trim() && !sending) say({ text: text.trim() });
    }
  };

  const session = finished?.session || s;
  const card = session.trainer_score || session.ai_score;
  const status = REVIEW_STATUS[session.status] || { label: session.status, tone: 'gray' as const };

  return (
    <div>
      <PageHeader back={{ href: '/agent/training/roleplay', label: 'Roleplays' }} title={s.title || 'Roleplay'}
        subtitle={<>{s.purpose === 'exam' ? 'Graded certification call' : 'Practice call'} · {isScript ? 'scripted (standard mode)' : s.mode === 'voice' ? 'voice' : 'text chat'} · started {fmtDate(s.started_at, true)}</>}
        actions={<Pill tone={status.tone}>{status.label}</Pill>} />

      {isScript && active && <StandardModeBanner message="AI unavailable — using standard mode. Pick what you would say; you get coaching on every choice." />}
      {aiDown && <StandardModeBanner message={`${aiDown}. The prospect can't reply right now — end the call to save it, and your trainer will grade it.`} />}
      {voiceFallback && <StandardModeBanner message={`${voiceFallback} Switched to text mode.`} />}

      <div className="grid gap-6 lg:grid-cols-3">
        <aside className="space-y-4 lg:order-2">
          <Panel title="Who you are calling">
            <div className="space-y-2 text-sm">
              <div className="flex items-start gap-2"><Building2 className="h-4 w-4 mt-0.5 text-gray-400 shrink-0" aria-hidden /><span><span className="font-semibold text-gray-900">{p.firm_name || '—'}</span>{p.firm_type && <span className="block text-gray-500">{p.firm_type}</span>}</span></div>
              {p.name && <div className="flex items-center gap-2"><User className="h-4 w-4 text-gray-400" aria-hidden /><span className="text-gray-700">{p.name}</span></div>}
              {p.state && <div className="flex items-center gap-2"><MapPin className="h-4 w-4 text-gray-400" aria-hidden /><span className="text-gray-700">{p.state}</span></div>}
              {p.website_observation && <div className="flex items-start gap-2"><Globe className="h-4 w-4 mt-0.5 text-gray-400 shrink-0" aria-hidden /><span className="text-gray-700">Website: {p.website_observation}</span></div>}
              {p.mood && <div><Pill tone="gray">Mood: {p.mood}</Pill></div>}
              {p.narrative && <p className="rounded-lg bg-gray-50 border border-gray-100 p-2 text-xs text-gray-600 line-clamp-6">{p.narrative}</p>}
            </div>
          </Panel>
          {s.objective && (
            <Panel title={<span className="inline-flex items-center gap-1.5"><Target className="h-4 w-4" aria-hidden /> Your goal</span>}>
              <p className="text-sm text-gray-700">{s.objective}</p>
            </Panel>
          )}
          {s.purpose === 'exam' && (
            <div className="flex items-start gap-2 rounded-xl bg-violet-50 border border-violet-200 px-3 py-2 text-sm text-violet-900">
              <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0" aria-hidden /> Exam calls always go to your trainer for review before they count.
            </div>
          )}
        </aside>

        <div className="lg:col-span-2 lg:order-1 space-y-4">
          {!active && (
            <Panel title="Your score">
              <Celebrate certs={finished?.new_certifications} badges={finished?.new_badges} />
              {session.status === 'needs_review' && (
                <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
                  {s.purpose === 'exam' ? 'Exam roleplays are always checked by your trainer.' : 'This one goes to your trainer for a second look.'} You will get a notification when it has been reviewed{card ? '; the score below may still change' : ''}.
                </div>
              )}
              {session.status === 'abandoned' && <p className="text-sm text-gray-500">This call ended without anything to grade.</p>}
              {card ? <ScoreCardView card={card} /> : session.status !== 'abandoned' && <p className="text-sm text-gray-600">No automatic score — your trainer will grade this call with the same 100-point scorecard.</p>}
              {data.trainer_comment && <div className="mt-4 rounded-lg bg-gray-50 border border-gray-200 p-3 text-sm"><span className="font-semibold text-gray-900">Trainer comment:</span> {data.trainer_comment}</div>}
              <div className="mt-5 flex flex-wrap gap-2">
                <Link href="/agent/training/roleplay"><Btn><RotateCcw className="h-4 w-4" aria-hidden /> Another roleplay</Btn></Link>
                {s.lesson_id && <Link href={`/agent/training/lesson/${s.lesson_id}`}><Btn variant="secondary">Back to the lesson</Btn></Link>}
              </div>
            </Panel>
          )}

          <section aria-label="Call transcript" className="bg-white rounded-2xl border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-5 py-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">{active ? 'On the call' : 'Transcript'}</h2>
              {session.duration_s ? <span className="text-xs text-gray-400">{fmtDuration(session.duration_s)}</span> : null}
            </div>
            <ol className="space-y-3 px-4 py-4 max-h-[60vh] overflow-y-auto" aria-live="polite">
              {turns.length === 0 && <li className="text-sm text-gray-400 text-center py-6">{isVoice ? 'Start the call — the prospect will pick up.' : 'The prospect picks up…'}</li>}
              {turns.map((t: any, i: number) => (
                <li key={i} className={cn('flex flex-col', t.role === 'rep' ? 'items-end' : 'items-start')}>
                  <span className="mb-0.5 text-[11px] text-gray-400">{t.role === 'rep' ? 'You' : p.name || 'Prospect'}</span>
                  <div className={cn('max-w-[85%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap', t.role === 'rep' ? 'bg-primary-600 text-white rounded-br-sm' : 'bg-gray-100 text-gray-900 rounded-bl-sm')}>{t.text}</div>
                  {t.feedback && (
                    <div className="mt-1 max-w-[85%] flex items-start gap-1.5 rounded-lg bg-amber-50 border border-amber-100 px-3 py-1.5 text-xs text-amber-900">
                      <Lightbulb className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden /> <span>{t.feedback}</span>
                    </div>
                  )}
                </li>
              ))}
              <div ref={bottom} />
            </ol>

            {active && (
              <div className="border-t border-gray-100 p-4 space-y-3">
                <ErrorNote error={err} />
                {isVoice ? (
                  <VoiceCall sessionId={s.id} onTurns={setVoiceTurns}
                    onEnd={(vt, dur) => finish({ turns: vt, duration: dur })}
                    onFallback={(m) => setVoiceFallback(m)} />
                ) : isScript ? (
                  scriptView && !done && scriptView.choices?.length ? (
                    <fieldset>
                      <legend className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">What do you say?</legend>
                      <div className="grid gap-2">
                        {scriptView.choices.map((c: any) => (
                          <button key={c.index} type="button" disabled={sending} onClick={() => say({ choice: c.index })}
                            className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-left text-sm text-gray-800 hover:border-primary-300 hover:bg-primary-50 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
                            {c.label}
                          </button>
                        ))}
                      </div>
                    </fieldset>
                  ) : (
                    <p className="text-sm text-gray-600">The call has ended. Get your score below.</p>
                  )
                ) : (
                  <div>
                    <label htmlFor="say" className="sr-only">What you say</label>
                    <div className="flex items-end gap-2">
                      <textarea id="say" rows={2} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} disabled={sending || !!aiDown || done}
                        placeholder={done ? 'The prospect hung up — get your score.' : 'Type what you would say… (Enter to send, Shift+Enter for a new line)'} className={cn(inputCls, 'resize-none')} />
                      <Btn onClick={() => text.trim() && say({ text: text.trim() })} disabled={sending || !text.trim() || !!aiDown || done}><Send className="h-4 w-4" aria-hidden /><span className="sr-only sm:not-sr-only">Send</span></Btn>
                    </div>
                    {sending && <p className="mt-1 text-xs text-gray-400">The prospect is replying…</p>}
                  </div>
                )}
                {!isVoice && (
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <span className="text-xs text-gray-500">{done ? 'Call over.' : 'Hang up whenever you have booked the meeting, or the prospect says no.'}</span>
                    <Btn variant={done ? 'primary' : 'danger'} onClick={() => finish()} disabled={finishing || sending}>
                      <PhoneOff className="h-4 w-4" aria-hidden /> {finishing ? 'Scoring…' : 'End call & get score'}
                    </Btn>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
