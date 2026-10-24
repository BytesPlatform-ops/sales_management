'use client';

import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Award, CheckCircle2, FileAudio, ChevronRight } from 'lucide-react';
import { tapi, useTraining, authedUrl, fmtDate } from '@/lib/training/client';
import { Panel, Spinner, ErrorNote, Pill, ScoreCardView, StandardModeBanner, Empty } from '@/components/training/ui';
import { TrainerPage, useToast } from '@/components/training/hr/kit';
import { RubricGradeForm, RubricRow, GradeSubmit, QueueRow, queuePath } from '@/components/training/hr/review';
import { cn } from '@/lib/utils';

export default function ReviewDetailPage() {
  return <Suspense fallback={<Spinner />}><ReviewDetail /></Suspense>;
}

function ReviewDetail() {
  const { kind, id } = useParams<{ kind: string; id: string }>();
  const sp = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const sort = sp.get('sort') || 'lowest';
  const status = sp.get('status') || 'needs_review';
  const savedMsg = sp.get('saved');
  const newCerts = (sp.get('certs') || '').split(',').filter(Boolean);
  const isCall = kind === 'call';
  const item = useTraining<any>(isCall ? `/call-reviews/${id}` : `/roleplays/${id}`);
  const rubrics = useTraining<RubricRow[]>('/admin/rubrics');
  const [busy, setBusy] = useState(false);
  const rubric = rubrics.data?.find((r) => r.code === 'CALL_SCORECARD_100') || rubrics.data?.[0];
  const back = { href: `/hr/training/reviews?sort=${sort}&status=${status}`, label: 'Review queue' };

  // Normalise roleplay vs call payloads.
  const s = item.data?.session;
  const c = isCall ? item.data : null;
  const aiCard = isCall ? c?.ai_score_json : s?.ai_score;
  const trainerCard = isCall ? c?.trainer_override_json : s?.trainer_score;
  const reviewed = isCall ? c?.status === 'reviewed' : !!s?.human_reviewed;
  const comment = isCall ? c?.trainer_comment : item.data?.trainer_comment;
  const repName = isCall ? c?.full_name : null;

  async function goNext(message: string, certs: string[]) {
    let next: QueueRow | undefined;
    try {
      const rows = await tapi<QueueRow[]>(queuePath(sort, status));
      const isMe = (r: QueueRow) => r.kind === kind && String(r.id) === String(id);
      const pending = rows.filter((r) => isMe(r) || status === 'all' || !r.human_reviewed);
      const at = pending.findIndex(isMe);
      // The item after this one in queue order, wrapping around; never this one.
      next = [...pending.slice(at + 1), ...pending.slice(0, Math.max(at, 0))].find((r) => !isMe(r));
    } catch { /* fall back to the list */ }
    const q = new URLSearchParams({ sort, status, saved: message });
    if (certs.length) q.set('certs', certs.join(','));
    router.push(next ? `/hr/training/reviews/${next.kind}/${next.id}?${q}` : `/hr/training/reviews?${q}`);
  }

  async function submit(g: GradeSubmit) {
    setBusy(true);
    try {
      if (isCall) {
        const r = await tapi<any>(`/call-reviews/${id}/override`, { method: 'PUT', body: g });
        await goNext(`Call #${id} graded ${r.card.total}/100`, []);
      } else {
        const r = await tapi<any>(`/roleplays/${id}/review`, { body: g });
        await goNext(`Roleplay #${id} graded ${r.card?.total}/100`, r.new_certifications || []);
      }
    } catch (e) { toast.error(e); setBusy(false); }
  }
  async function confirmAi(commentText: string) {
    setBusy(true);
    try {
      const r = await tapi<any>(`/roleplays/${id}/review`, { body: { confirm: true, comment: commentText || undefined } });
      await goNext(`Roleplay #${id}: AI score confirmed`, r.new_certifications || []);
    } catch (e) { toast.error(e); setBusy(false); }
  }

  const title = isCall ? `Live call #${id}` : (s?.title || `Roleplay #${id}`);

  return (
    <TrainerPage title={title} back={back}
      subtitle={item.data && (isCall
        ? <>{repName} · {c.source === 'qa_transcript' ? 'from the QA pipeline' : 'uploaded recording'}{c.duration_s ? ` · ${Math.round(c.duration_s / 60)} min` : ''} · {fmtDate(c.created_at, true)}</>
        : <>{s.purpose} roleplay · {s.engine === 'script' ? 'scripted (standard mode)' : 'AI prospect'} · {s.mode} · {fmtDate(s.started_at, true)}</>)}>
      {toast.node}
      {savedMsg && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 flex flex-wrap items-center gap-2">
          <CheckCircle2 className="h-4 w-4" /> {savedMsg}.
          {newCerts.length > 0 && <span className="inline-flex items-center gap-1 font-semibold"><Award className="h-4 w-4" /> New certification: {newCerts.map((x) => x.replace(/_/g, ' ')).join(', ')}</span>}
          <span className="text-emerald-700">Next item below.</span>
        </div>
      )}
      <ErrorNote error={item.error || rubrics.error} />
      {!item.data || !rubric ? (!item.error && <Spinner />) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-6 min-w-0">
            {!isCall && (
              <Panel title="Prospect">
                <div className="text-sm text-gray-700 space-y-1">
                  <div className="font-semibold text-gray-900">{s.persona?.name ? `${s.persona.name}, ` : ''}{s.persona?.firm_name || '—'}</div>
                  <div className="text-gray-500">{[s.persona?.firm_type, s.persona?.state, s.persona?.mood && `mood: ${s.persona.mood}`].filter(Boolean).join(' · ')}</div>
                  {s.persona?.narrative && <p className="text-xs text-gray-500">{s.persona.narrative}</p>}
                  {s.persona?.website_observation && <p className="text-xs text-gray-500">Website: {s.persona.website_observation}</p>}
                  {s.objective && <p className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600"><strong>Objective:</strong> {s.objective}</p>}
                </div>
              </Panel>
            )}

            <Panel title={isCall ? 'Recording & transcript' : 'Transcript'}>
              {isCall && (
                <div className="mb-4">
                  {c.has_audio ? (
                    <audio controls preload="none" className="w-full" src={authedUrl(`/api/training/call-reviews/${id}/audio`)}>Your browser cannot play this recording.</audio>
                  ) : (
                    <div className="flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                      <FileAudio className="h-4 w-4 shrink-0" />
                      {c.source === 'qa_transcript'
                        ? <span>This call came from the QA pipeline, so the audio lives in <Link href="/hr/recordings" className="text-primary-600 underline">Recordings</Link>{c.call_transcript_id ? ` (transcript #${c.call_transcript_id})` : ''}.</span>
                        : c.audio_deleted_at ? <span>Audio was deleted on {fmtDate(c.audio_deleted_at)} after the retention period. Transcript and scores are kept.</span>
                        : <span>No audio stored for this call.</span>}
                    </div>
                  )}
                  {c.error && c.status !== 'reviewed' && <StandardModeBanner message={c.error} />}
                </div>
              )}
              {isCall ? (
                c.transcript ? <div className="max-h-[560px] overflow-y-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm leading-relaxed text-gray-700">{c.transcript}</div> : <Empty title="No transcript yet" />
              ) : (
                <div className="max-h-[560px] overflow-y-auto space-y-2 pr-1">
                  {(s.transcript || []).length === 0 && <Empty title="Empty transcript" />}
                  {(s.transcript || []).map((t: any, i: number) => (
                    <div key={i} className={cn('flex', t.role === 'rep' ? 'justify-end' : 'justify-start')}>
                      <div className={cn('max-w-[85%] rounded-2xl px-3 py-2 text-sm', t.role === 'rep' ? 'bg-primary-600 text-white rounded-br-sm' : 'bg-gray-100 text-gray-800 rounded-bl-sm')}>
                        <div className={cn('text-[10px] font-semibold uppercase tracking-wide mb-0.5', t.role === 'rep' ? 'text-primary-100' : 'text-gray-400')}>{t.role === 'rep' ? 'Rep' : 'Prospect'}</div>
                        {t.text}
                        {t.feedback && <div className={cn('mt-1 text-xs italic', t.role === 'rep' ? 'text-primary-100' : 'text-gray-500')}>Script note: {t.feedback}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title={aiCard?.engine === 'script' ? 'Scripted score (standard mode)' : 'AI scorecard'}>
              {aiCard ? <ScoreCardView card={aiCard} /> : <Empty title="Not graded by AI" body="AI was unavailable, so grade it yourself with the rubric." />}
            </Panel>
          </div>

          <div className="min-w-0">
            <Panel>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">{reviewed ? 'Your grade' : 'Grade with the rubric'}</h2>
                {reviewed && <Pill tone="green"><CheckCircle2 className="h-3 w-3" /> Reviewed{(isCall ? c.reviewed_at : null) ? ` ${fmtDate(c.reviewed_at)}` : ''}</Pill>}
              </div>
              {reviewed && trainerCard && <p className="mb-3 text-xs text-gray-500">Already graded {trainerCard.total}/100. Saving again replaces your grade.</p>}
              <RubricGradeForm
                rubric={rubric}
                initial={trainerCard || aiCard}
                ai={aiCard}
                initialComment={comment}
                busy={busy}
                onSubmit={submit}
                onConfirm={!isCall && aiCard && s?.final_score !== null ? confirmAi : undefined}
                submitLabel={reviewed ? 'Update my grade' : 'Save my grade'}
              />
              <div className="mt-4 border-t border-gray-100 pt-3 text-right">
                <button type="button" onClick={() => goNext('Skipped', [])} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">Skip to next <ChevronRight className="h-4 w-4" /></button>
              </div>
            </Panel>
          </div>
        </div>
      )}
    </TrainerPage>
  );
}
