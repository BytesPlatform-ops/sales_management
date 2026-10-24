'use client';

/**
 * Optional voice roleplay over the OpenAI Realtime API (WebRTC). Best effort:
 * the server mints a short-lived client secret; the browser talks directly to
 * the model. Transcripts are collected from data-channel events and sent to
 * /finish when the rep hangs up.
 */
import { useEffect, useRef, useState } from 'react';
import { Mic, PhoneOff, Loader2 } from 'lucide-react';
import { tapi, ApiError } from '@/lib/training/client';
import { Btn } from '@/components/training/ui';
import { fmtDuration, useTick } from './common';

export interface VoiceTurn { role: 'rep' | 'prospect'; text: string; at: string }

export function VoiceCall({ sessionId, onTurns, onEnd, onFallback }: {
  sessionId: number;
  onTurns: (t: VoiceTurn[]) => void;
  onEnd: (turns: VoiceTurn[], durationS: number) => void;
  onFallback: (message: string) => void;
}) {
  const [state, setState] = useState<'idle' | 'connecting' | 'live' | 'ended' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const pc = useRef<RTCPeerConnection | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const audioEl = useRef<HTMLAudioElement | null>(null);
  const turns = useRef<VoiceTurn[]>([]);
  const startedAt = useRef(0);
  useTick(1000, state === 'live');

  const cleanup = () => {
    try { pc.current?.close(); } catch { /* ignore */ }
    stream.current?.getTracks().forEach((t) => t.stop());
    pc.current = null;
    stream.current = null;
  };
  useEffect(() => cleanup, []);

  const push = (role: VoiceTurn['role'], text: string) => {
    if (!text?.trim()) return;
    turns.current = [...turns.current, { role, text: text.trim(), at: new Date().toISOString() }];
    onTurns(turns.current);
  };

  const connect = async () => {
    setState('connecting');
    setError(null);
    try {
      const tok = await tapi<any>(`/roleplays/${sessionId}/voice-token`, { method: 'POST' });
      setSecondsLeft(tok.seconds_left_today ?? null);
      if (!tok.client_secret) throw new Error('Voice service did not return a session key');

      const conn = new RTCPeerConnection();
      pc.current = conn;
      const el = audioEl.current!;
      conn.ontrack = (e) => { el.srcObject = e.streams[0]; el.play().catch(() => undefined); };
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = mic;
      mic.getTracks().forEach((t) => conn.addTrack(t, mic));

      const dc = conn.createDataChannel('oai-events');
      dc.onopen = () => {
        // Ask for rep-side transcripts, then let the prospect pick up the phone.
        try {
          dc.send(JSON.stringify({ type: 'session.update', session: { type: 'realtime', audio: { input: { transcription: { model: 'gpt-4o-mini-transcribe' } } } } }));
          dc.send(JSON.stringify({ type: 'response.create' }));
        } catch { /* ignore */ }
      };
      dc.onmessage = (e) => {
        try {
          const ev = JSON.parse(e.data);
          if (ev.type === 'conversation.item.input_audio_transcription.completed') push('rep', ev.transcript);
          else if (ev.type === 'response.output_audio_transcript.done' || ev.type === 'response.audio_transcript.done') push('prospect', ev.transcript);
        } catch { /* ignore malformed */ }
      };

      const offer = await conn.createOffer();
      await conn.setLocalDescription(offer);
      const res = await fetch(`https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(tok.model || '')}`, {
        method: 'POST',
        body: offer.sdp,
        headers: { Authorization: `Bearer ${tok.client_secret}`, 'Content-Type': 'application/sdp' },
      });
      if (!res.ok) throw new Error(`Voice connection failed (${res.status})`);
      await conn.setRemoteDescription({ type: 'answer', sdp: await res.text() });
      startedAt.current = Date.now();
      setState('live');
    } catch (e) {
      cleanup();
      setState('error');
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      if (e instanceof ApiError && (e.status === 429 || e.status === 503 || e.status === 400)) onFallback(msg);
    }
  };

  const hangUp = () => {
    const dur = startedAt.current ? Math.round((Date.now() - startedAt.current) / 1000) : 0;
    cleanup();
    setState('ended');
    onEnd(turns.current, dur);
  };

  const elapsed = state === 'live' ? Math.round((Date.now() - startedAt.current) / 1000) : 0;
  const left = secondsLeft !== null ? Math.max(0, secondsLeft - elapsed) : null;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <audio ref={audioEl} autoPlay className="hidden" />
      {state === 'idle' && (
        <div className="flex flex-wrap items-center gap-3">
          <Btn onClick={connect}><Mic className="h-4 w-4" aria-hidden /> Start voice call</Btn>
          <span className="text-sm text-gray-500">Use headphones. Your browser will ask for the microphone.</span>
        </div>
      )}
      {state === 'connecting' && <div className="flex items-center gap-2 text-sm text-gray-600"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Connecting the call…</div>}
      {state === 'live' && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-gray-700">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" aria-hidden />
            Live · {fmtDuration(elapsed)}{left !== null && <span className="text-gray-500"> · {Math.floor(left / 60)} min left today</span>}
          </div>
          <Btn variant="danger" onClick={hangUp}><PhoneOff className="h-4 w-4" aria-hidden /> End call &amp; get score</Btn>
        </div>
      )}
      {state === 'error' && <p className="text-sm text-red-700">{error} — you can switch to text mode below.</p>}
      {state === 'ended' && <p className="text-sm text-gray-600">Call ended.</p>}
    </div>
  );
}
