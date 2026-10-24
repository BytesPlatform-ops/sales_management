'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Layers, RefreshCw } from 'lucide-react';
import { tapi, useTraining } from '@/lib/training/client';
import { PageHeader, Panel, ErrorNote, Spinner, Pill, Btn, ProgressBar, Stat, Empty } from '@/components/training/ui';
import { FlipCard, RatingButtons } from '@/components/training/rep/common';

function intervalText(r: any) {
  if (!r) return '';
  if (Number(r.interval_days) === 0) return 'in about 10 minutes';
  return `in ${r.interval_days} day${Number(r.interval_days) === 1 ? '' : 's'}`;
}

export default function FlashcardsPage() {
  const { data, error, mutate, isValidating } = useTraining<any>('/flashcards/due?limit=50');
  const [queue, setQueue] = useState<any[] | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [last, setLast] = useState<{ front: string; text: string } | null>(null);
  const [reviewed, setReviewed] = useState(0);

  useEffect(() => { if (data) setQueue(data.cards || []); }, [data]);

  const card = queue?.[0];
  const rate = useCallback(async (result: 'again' | 'hard' | 'good' | 'easy') => {
    if (!card || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await tapi<any>(`/flashcards/${card.id}/review`, { method: 'POST', body: { result } });
      setLast({ front: card.front, text: `Next review ${intervalText(r)}` });
      setReviewed((n) => n + 1);
      setQueue((q) => (q || []).slice(1));
      setFlipped(false);
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }, [card, busy]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      if (!card) return;
      if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); setFlipped((f) => !f); }
      else if (flipped && ['1', '2', '3', '4'].includes(e.key)) rate((['again', 'hard', 'good', 'easy'] as const)[Number(e.key) - 1]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [card, flipped, rate]);

  if (error) return <ErrorNote error={error} />;
  if (!data || queue === null) return <Spinner label="Loading your cards…" />;

  const total = reviewed + queue.length;

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title="Flashcards" subtitle="Spaced repetition: cards you know come back less often, cards you miss come back soon. A few minutes a day is enough." />

      <div className="grid grid-cols-3 gap-3 mb-6">
        <Stat label="Left today" value={queue.length} />
        <Stat label="Reviewed now" value={reviewed} />
        <Stat label="Retention" value={data.retention_pct === null ? '—' : `${data.retention_pct}%`} hint="cards you knew" />
      </div>

      {last && <p role="status" className="mb-3 text-sm text-gray-600"><CheckCircle2 className="inline h-4 w-4 text-emerald-500 mr-1" aria-hidden />Saved. {last.text}.</p>}
      <ErrorNote error={err} />

      {card ? (
        <Panel>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-gray-500">
            <span className="inline-flex items-center gap-1.5"><Layers className="h-4 w-4" aria-hidden /> {card.deck_title}</span>
            {card.is_new ? <Pill tone="violet">New card</Pill> : <Pill tone="blue">Review</Pill>}
          </div>
          <ProgressBar value={total ? (reviewed / total) * 100 : 0} className="mb-4" />
          <FlipCard front={card.front} back={card.back} flipped={flipped} onFlip={() => setFlipped(!flipped)} />
          <div className="mt-4">
            {flipped ? <RatingButtons onRate={rate} disabled={busy} /> : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-gray-500">Answer in your head first, then flip.</p>
                <Btn onClick={() => setFlipped(true)}>Show answer</Btn>
              </div>
            )}
          </div>
          <p className="mt-3 hidden sm:block text-xs text-gray-400">Keyboard: Space flips · 1 Again · 2 Hard · 3 Good · 4 Easy</p>
        </Panel>
      ) : (
        <Panel>
          <Empty icon={<CheckCircle2 className="h-6 w-6" />} title="All caught up!"
            body={data.seen === 0 && reviewed === 0
              ? 'Cards appear here once you open a flashcard lesson on your path.'
              : 'No cards are due right now. Come back tomorrow — or check again in a few minutes if you pressed “Again”.'}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Btn variant="secondary" onClick={() => { setReviewed(0); setLast(null); mutate(); }} disabled={isValidating}><RefreshCw className="h-4 w-4" aria-hidden /> Check again</Btn>
                <Link href="/agent/training/today"><Btn>Go to Today</Btn></Link>
              </div>
            } />
        </Panel>
      )}
    </div>
  );
}
