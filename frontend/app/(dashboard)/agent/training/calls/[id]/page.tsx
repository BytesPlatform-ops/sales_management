'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { ChevronDown, MessageSquare, RotateCcw } from 'lucide-react';
import { tapi, useTraining, authedUrl, fmtDate } from '@/lib/training/client';
import { PageHeader, Panel, ErrorNote, Spinner, Pill, Btn, ScoreCardView, StandardModeBanner } from '@/components/training/ui';
import { REVIEW_STATUS, fmtDuration } from '@/components/training/rep/common';
import { cn } from '@/lib/utils';

export default function CallReviewPage() {
  const { id } = useParams<{ id: string }>();
  const { data: r, error, mutate } = useTraining<any>(`/call-reviews/${id}`, { refreshInterval: (d: any) => (d?.status === 'pending' ? 4000 : 0) } as any);
  const [showAi, setShowAi] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [err, setErr] = useState<unknown>(null);

  if (error) return <ErrorNote error={error} />;
  if (!r) return <Spinner label="Loading the call…" />;

  const st = REVIEW_STATUS[r.status] || { label: r.status, tone: 'gray' as const };
  const trainer = r.trainer_override_json;
  const ai = r.ai_score_json;
  const primary = trainer || ai;
  const standardMode = r.error && /standard mode|AI unavailable/i.test(r.error);

  const retry = async () => {
    setRetrying(true);
    setErr(null);
    try { await tapi(`/call-reviews/${r.id}`, { method: 'POST' }); await mutate(); } catch (e) { setErr(e); } finally { setRetrying(false); }
  };

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader back={{ href: '/agent/training/calls', label: 'My calls' }} title={`Call from ${fmtDate(r.created_at, true)}`}
        subtitle={<>{r.source === 'upload' ? 'Uploaded recording' : 'From the QA system'} · {fmtDuration(r.duration_s)}</>}
        actions={<Pill tone={st.tone}>{st.label}</Pill>} />

      {standardMode && <StandardModeBanner message={`${r.error}. Your trainer will grade this call by hand with the same scorecard.`} />}
      {r.status === 'failed' && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p><strong>We could not grade this call.</strong> {r.error}</p>
          <Btn size="sm" variant="secondary" className="mt-2" onClick={retry} disabled={retrying}><RotateCcw className="h-4 w-4" aria-hidden /> {retrying ? 'Retrying…' : 'Try again'}</Btn>
        </div>
      )}
      {r.status === 'pending' && <div className="mb-4 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600">Grading in progress… this page refreshes by itself.</div>}
      {r.status === 'needs_review' && !standardMode && <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Your trainer will take a second look at this one. The score may change.</div>}
      <ErrorNote error={err} />

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3 space-y-4">
          <Panel title={trainer ? 'Trainer score' : 'Score'}>
            {primary ? <ScoreCardView card={primary} /> : <p className="text-sm text-gray-500">{r.status === 'needs_review' ? 'Not scored yet — your trainer will grade it with the 100-point scorecard.' : r.status === 'pending' ? 'Scoring…' : 'No score yet.'}</p>}
            {r.trainer_comment && (
              <div className="mt-4 flex items-start gap-2 rounded-lg bg-gray-50 border border-gray-200 p-3 text-sm">
                <MessageSquare className="h-4 w-4 mt-0.5 text-gray-400 shrink-0" aria-hidden />
                <span><span className="font-semibold text-gray-900">Trainer comment:</span> {r.trainer_comment}</span>
              </div>
            )}
          </Panel>
          {trainer && ai && (
            <section className="bg-white rounded-2xl border border-gray-200 shadow-sm">
              <button type="button" onClick={() => setShowAi(!showAi)} aria-expanded={showAi}
                className="w-full flex items-center justify-between px-5 py-3 text-sm font-semibold uppercase tracking-wide text-gray-500 rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
                Original AI score ({ai.total}) <ChevronDown className={cn('h-4 w-4 transition-transform', showAi && 'rotate-180')} aria-hidden />
              </button>
              {showAi && <div className="px-5 pb-5"><ScoreCardView card={ai} compact /></div>}
            </section>
          )}
        </div>

        <div className="lg:col-span-2 space-y-4">
          <Panel title="Recording">
            {r.has_audio ? (
              <audio controls preload="none" src={authedUrl(`/api/training/call-reviews/${r.id}/audio`)} className="w-full" />
            ) : (
              <p className="text-sm text-gray-500">{r.audio_deleted_at ? `Audio was deleted on ${fmtDate(r.audio_deleted_at)} (we keep transcripts and scores).` : 'No audio stored for this call.'}</p>
            )}
          </Panel>
          <Panel title="Transcript">
            {r.transcript ? (
              <div className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-gray-700">{r.transcript}</div>
            ) : <p className="text-sm text-gray-500">{r.status === 'pending' ? 'Transcribing…' : 'No transcript available.'}</p>}
          </Panel>
        </div>
      </div>
    </div>
  );
}
