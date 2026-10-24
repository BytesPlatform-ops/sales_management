'use client';

import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  BookOpen, PlayCircle, Layers, ListChecks, GraduationCap, Phone, Lightbulb, CheckSquare, Target, Award, PartyPopper, Mic, Square,
  CalendarCheck, Flame, Shield, Briefcase, Star, Medal,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export const LESSON_TYPE: Record<string, { label: string; icon: typeof BookOpen }> = {
  reading: { label: 'Reading', icon: BookOpen },
  video: { label: 'Video', icon: PlayCircle },
  flashcard_deck: { label: 'Flashcards', icon: Layers },
  quiz: { label: 'Quiz', icon: ListChecks },
  exam: { label: 'Timed exam', icon: GraduationCap },
  roleplay: { label: 'Roleplay', icon: Phone },
  scenario: { label: 'Scenario', icon: Lightbulb },
  checklist: { label: 'Checklist', icon: CheckSquare },
  drill: { label: 'Drill', icon: Target },
};

export function LessonTypeIcon({ type, className }: { type: string; className?: string }) {
  const Icon = LESSON_TYPE[type]?.icon || BookOpen;
  return <Icon className={cn('h-4 w-4', className)} aria-hidden />;
}

export const CERT_LABELS: Record<string, { title: string; blurb: string }> = {
  PRODUCT_CERT: { title: 'Product certified', blurb: 'You know what we sell and who to sell it to.' },
  LIVE_CALL_CERT: { title: 'Live-call certified', blurb: 'You can now take live leads in My Leads.' },
  BYTESCON_CERT: { title: 'Bytescon specialist', blurb: 'Optional: you can pitch the contract-management build.' },
};

export function certTitle(code: string) {
  return CERT_LABELS[code]?.title || code.replace(/_/g, ' ');
}

/** Celebrates certifications and badges earned by the last action. */
export function Celebrate({ certs, badges }: { certs?: string[] | null; badges?: string[] | null }) {
  if (!certs?.length && !badges?.length) return null;
  return (
    <div role="status" className="mb-4 rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-primary-50 p-4">
      <div className="flex items-center gap-2 font-semibold text-emerald-800">
        <PartyPopper className="h-5 w-5" aria-hidden /> Congratulations!
      </div>
      <ul className="mt-2 space-y-1 text-sm text-emerald-900">
        {(certs || []).map((c) => (
          <li key={c} className="flex items-start gap-2">
            <Award className="h-4 w-4 mt-0.5 shrink-0 text-emerald-600" aria-hidden />
            <span><strong>{certTitle(c)}</strong> — {CERT_LABELS[c]?.blurb || 'certification earned.'}</span>
          </li>
        ))}
        {(badges || []).map((b) => (
          <li key={b} className="flex items-start gap-2">
            <Award className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" aria-hidden />
            <span>New badge: <strong>{b.replace(/_/g, ' ').toLowerCase()}</strong></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A flip card. The parent controls `flipped`; click / Enter flips. */
export function FlipCard({ front, back, flipped, onFlip, label }: { front: ReactNode; back: ReactNode; flipped: boolean; onFlip: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onFlip}
      aria-pressed={flipped}
      aria-label={label || (flipped ? 'Answer shown. Press to see the question again' : 'Press to reveal the answer')}
      className={cn(
        'w-full min-h-[200px] rounded-2xl border-2 p-6 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2',
        flipped ? 'border-primary-200 bg-primary-50' : 'border-gray-200 bg-white hover:border-primary-200'
      )}
    >
      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">{flipped ? 'Answer' : 'Question'}</div>
      <div className={cn('whitespace-pre-wrap text-gray-900', flipped ? 'text-base' : 'text-lg font-semibold')}>{flipped ? back : front}</div>
      {!flipped && <div className="mt-6 text-xs text-gray-400">Click or press Space to flip</div>}
    </button>
  );
}

export const RATINGS = [
  { value: 'again', label: 'Again', hint: 'I forgot', cls: 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100' },
  { value: 'hard', label: 'Hard', hint: 'Took a while', cls: 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100' },
  { value: 'good', label: 'Good', hint: 'Got it', cls: 'bg-primary-50 text-primary-700 border-primary-200 hover:bg-primary-100' },
  { value: 'easy', label: 'Easy', hint: 'Instant', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100' },
] as const;

export function RatingButtons({ onRate, disabled }: { onRate: (r: 'again' | 'hard' | 'good' | 'easy') => void; disabled?: boolean }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="group" aria-label="How well did you know it?">
      {RATINGS.map((r, i) => (
        <button key={r.value} type="button" disabled={disabled} onClick={() => onRate(r.value)}
          className={cn('rounded-xl border px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500', r.cls)}>
          {r.label}
          <span className="block text-[11px] font-normal opacity-80">{r.hint} · key {i + 1}</span>
        </button>
      ))}
    </div>
  );
}

/** 0–10 self-score picker (standard mode). */
export function SelfScore({ value, onChange, label = 'How close was your answer to the model answer? (0–10)' }: { value: number | null; onChange: (n: number) => void; label?: string }) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-gray-700 mb-2">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: 11 }, (_, n) => (
          <button key={n} type="button" onClick={() => onChange(n)} aria-pressed={value === n}
            className={cn('h-9 w-9 rounded-lg border text-sm font-semibold tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
              value === n ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50')}>
            {n}
          </button>
        ))}
      </div>
      <p className="mt-1 text-xs text-gray-500">0 = nothing like it · 5 = had the idea · 10 = hit every step</p>
    </fieldset>
  );
}

export function fmtDuration(s: number | null | undefined) {
  if (!s && s !== 0) return '—';
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function timeUntil(iso: string | null | undefined) {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'now';
  const m = Math.ceil(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

export function fmtTime(iso: string | null | undefined) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** Re-renders every `ms` (for countdowns). */
export function useTick(ms = 1000, enabled = true) {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => setN((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms, enabled]);
}

/** MediaRecorder wrapper for short practice recordings. */
export function useRecorder() {
  const [state, setState] = useState<'idle' | 'recording' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const started = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const start = useCallback(async () => {
    setError(null);
    if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setState('error');
      setError('Recording is not supported in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: BlobPart[] = [];
      const r = new MediaRecorder(stream);
      r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const b = new Blob(chunks, { type: r.mimeType || 'audio/webm' });
        setBlob(b);
        setUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(b); });
        setSeconds(Math.max(1, Math.round((Date.now() - started.current) / 1000)));
        setState('done');
      };
      rec.current = r;
      started.current = Date.now();
      setSeconds(0);
      r.start();
      setState('recording');
      timer.current = setInterval(() => setSeconds(Math.round((Date.now() - started.current) / 1000)), 500);
    } catch (e) {
      setState('error');
      setError('Microphone permission was blocked. Allow the microphone, or rate yourself instead.');
    }
  }, []);

  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    if (rec.current && rec.current.state !== 'inactive') rec.current.stop();
  }, []);

  const reset = useCallback(() => {
    setBlob(null);
    setUrl((old) => { if (old) URL.revokeObjectURL(old); return null; });
    setSeconds(0);
    setState('idle');
  }, []);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  return { state, error, blob, url, seconds, start, stop, reset };
}

export function RecordButton({ state, seconds, onStart, onStop }: { state: string; seconds: number; onStart: () => void; onStop: () => void }) {
  return state === 'recording' ? (
    <button type="button" onClick={onStop} className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-1">
      <Square className="h-4 w-4" aria-hidden /> Stop ({fmtDuration(seconds)})
      <span className="h-2 w-2 rounded-full bg-white animate-pulse" aria-hidden />
    </button>
  ) : (
    <button type="button" onClick={onStart} className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1">
      <Mic className="h-4 w-4" aria-hidden /> {state === 'done' ? 'Record again' : 'Start recording'}
    </button>
  );
}

export const REVIEW_STATUS: Record<string, { label: string; tone: 'gray' | 'green' | 'amber' | 'red' | 'blue' | 'violet' }> = {
  pending: { label: 'Grading…', tone: 'gray' },
  active: { label: 'In progress', tone: 'blue' },
  scored: { label: 'Scored', tone: 'blue' },
  needs_review: { label: 'Waiting for trainer', tone: 'amber' },
  reviewed: { label: 'Trainer reviewed', tone: 'green' },
  failed: { label: 'Could not grade', tone: 'red' },
  abandoned: { label: 'Abandoned', tone: 'gray' },
};

const BADGE_ICONS: Record<string, typeof Award> = {
  'calendar-check': CalendarCheck, flame: Flame, shield: Shield, award: Award, phone: Phone, briefcase: Briefcase, star: Star, layers: Layers,
};

/** Badge icons are stored as lucide icon names. */
export function BadgeIcon({ icon, className }: { icon?: string | null; className?: string }) {
  const Icon = (icon && BADGE_ICONS[icon]) || Medal;
  return <Icon className={cn('h-3.5 w-3.5', className)} aria-hidden />;
}
