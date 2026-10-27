'use client';

import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Trash2, Send, Play, Pause, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { peaksFrom, VOICE_MAX_SECONDS } from '@/lib/chat/rules';
import { useSignedUrl } from './signed';

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Pick a recording format the browser supports (Safari records mp4/aac). */
function recorderMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    if (MediaRecorder.isTypeSupported?.(t)) return t;
  }
  return '';
}

export interface Recording { blob: Blob; duration: number; peaks: number[]; mime: string }

/**
 * Click to record, click to stop (max 5 minutes), then send or discard.
 * Peaks for the waveform are computed in the browser from the recorded audio.
 */
export function VoiceRecorder({ onSend, disabled }: { onSend: (r: Recording) => Promise<void>; disabled?: boolean }) {
  const [state, setState] = useState<'idle' | 'recording' | 'review' | 'sending'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [rec, setRec] = useState<Recording | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const mr = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const started = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); mr.current?.stream.getTracks().forEach((t) => t.stop()); }, []);

  async function start() {
    setErr(null);
    const mime = recorderMime();
    if (!navigator.mediaDevices?.getUserMedia || !mime) { setErr('Voice notes aren’t supported in this browser'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream, { mimeType: mime });
      chunks.current = [];
      r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const duration = Math.min(VOICE_MAX_SECONDS, (Date.now() - started.current) / 1000);
        const blob = new Blob(chunks.current, { type: mime.split(';')[0] });
        let peaks: number[] = [];
        try {
          const ctx = new AudioContext();
          const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
          peaks = peaksFrom(buf.getChannelData(0));
          ctx.close();
        } catch { peaks = []; }
        setRec({ blob, duration, peaks, mime: blob.type });
        setState('review');
      };
      mr.current = r;
      started.current = Date.now();
      r.start(250);
      setElapsed(0);
      setState('recording');
      timer.current = setInterval(() => {
        const s = (Date.now() - started.current) / 1000;
        setElapsed(s);
        if (s >= VOICE_MAX_SECONDS) stop();
      }, 250);
    } catch {
      setErr('Microphone permission was denied');
    }
  }

  function stop() {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    if (mr.current?.state === 'recording') mr.current.stop();
  }

  async function send() {
    if (!rec) return;
    setState('sending');
    try { await onSend(rec); setRec(null); setState('idle'); } catch (e) { setErr((e as Error).message); setState('review'); }
  }

  if (state === 'idle') {
    return (
      <div className="flex items-center gap-2">
        <button type="button" disabled={disabled} onClick={start} title="Record a voice note" aria-label="Record a voice note"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40">
          <Mic className="h-4 w-4" />
        </button>
        {err && <span className="text-xs text-red-600">{err}</span>}
      </div>
    );
  }
  return (
    <div className="flex flex-1 items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
      {state === 'recording' ? (
        <>
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" aria-hidden />
          <span className="text-sm tabular-nums text-gray-700">{fmt(elapsed)} / {fmt(VOICE_MAX_SECONDS)}</span>
          <button type="button" onClick={stop} className="ml-auto inline-flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700">
            <Square className="h-3.5 w-3.5" />Stop
          </button>
        </>
      ) : (
        <>
          {rec && <LocalPlayer rec={rec} />}
          <button type="button" onClick={() => { setRec(null); setState('idle'); }} aria-label="Discard recording" className="rounded p-1.5 text-gray-500 hover:bg-gray-200"><Trash2 className="h-4 w-4" /></button>
          <button type="button" onClick={send} disabled={state === 'sending'} className="inline-flex items-center gap-1 rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60">
            {state === 'sending' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}Send
          </button>
          {err && <span className="text-xs text-red-600">{err}</span>}
        </>
      )}
    </div>
  );
}

function LocalPlayer({ rec }: { rec: Recording }) {
  const [url] = useState(() => URL.createObjectURL(rec.blob));
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <WavePlayer src={url} peaks={rec.peaks} duration={rec.duration} className="flex-1" />;
}

/** Voice note in a message: waveform, progress, speed 1x / 1.5x / 2x. */
export function VoiceNote({ fileId, peaks, duration, mine }: { fileId: string; peaks?: number[]; duration?: number; mine?: boolean }) {
  const src = useSignedUrl(fileId);
  if (!src) return <div className="flex h-10 items-center gap-2 text-xs opacity-70"><Loader2 className="h-3.5 w-3.5 animate-spin" />Voice note</div>;
  return <WavePlayer src={src} peaks={peaks} duration={duration} mine={mine} />;
}

const SPEEDS = [1, 1.5, 2];

function WavePlayer({ src, peaks = [], duration = 0, mine, className }: { src: string; peaks?: number[]; duration?: number; mine?: boolean; className?: string }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(duration);
  const [speed, setSpeed] = useState(1);
  const bars = peaks.length ? peaks : Array.from({ length: 40 }, (_, i) => 0.3 + 0.5 * Math.abs(Math.sin(i * 1.7)));
  const frac = dur ? Math.min(1, pos / dur) : 0;

  return (
    <div className={cn('flex min-w-[200px] items-center gap-2', className)}>
      <audio ref={audio} src={src} preload="metadata"
        onLoadedMetadata={(e) => { const d = e.currentTarget.duration; if (Number.isFinite(d) && d > 0) setDur(d); }}
        onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)} onEnded={() => { setPlaying(false); setPos(0); }}
        onPause={() => setPlaying(false)} onPlay={() => setPlaying(true)} />
      <button type="button" aria-label={playing ? 'Pause' : 'Play voice note'}
        onClick={() => { const a = audio.current!; a.playbackRate = speed; if (a.paused) a.play(); else a.pause(); }}
        className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full', mine ? 'bg-white/20 text-white' : 'bg-primary-600 text-white')}>
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-px" />}
      </button>
      <button type="button" aria-label="Seek" className="flex h-8 flex-1 items-center gap-[2px]"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const a = audio.current!;
          if (dur) a.currentTime = ((e.clientX - r.left) / r.width) * dur;
        }}>
        {bars.map((p, i) => (
          <span key={i} className={cn('w-[3px] rounded-full', i / bars.length <= frac
            ? (mine ? 'bg-white' : 'bg-primary-600') : (mine ? 'bg-white/40' : 'bg-gray-300'))}
            style={{ height: `${Math.max(12, p * 100)}%` }} />
        ))}
      </button>
      <span className={cn('w-9 text-right text-[11px] tabular-nums', mine ? 'text-white/80' : 'text-gray-500')}>{fmt(playing || pos ? pos : dur)}</span>
      <button type="button" aria-label="Playback speed"
        onClick={() => { const n = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]; setSpeed(n); if (audio.current) audio.current.playbackRate = n; }}
        className={cn('rounded px-1.5 py-0.5 text-[11px] font-semibold', mine ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-700')}>
        {speed}x
      </button>
    </div>
  );
}
