'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ChevronLeft, ChevronRight, Download, Phone, Clock, FileAudio, AlertTriangle, FileText, Headphones } from 'lucide-react';

interface CallItem {
  id: number;
  call_time: string;
  phone_number: string | null;
  duration_sec: number;
  call_duration: string;
  rec_id: string | null;
  play_url: string | null;
  download_url: string | null;
  qa: {
    transcript_id: number;
    status: string;
    transcript: string | null;
    overall_score: number | null;
    meeting_scheduled: boolean | null;
    disposition: string | null;
    not_evaluable: boolean | null;
    not_evaluable_reason: string | null;
  } | null;
}

interface CallsData {
  agent: { id: number; full_name: string; username: string; extension_number: string; is_active: boolean };
  date: string;
  start_date: string | null;
  before_start: boolean;
  min_seconds: number;
  shift_window: { start: string; end: string };
  summary: { total_calls: number; long_calls: number; long_talk_seconds: number; with_recording: number; meetings: number };
  recordings_error: string | null;
  calls: CallItem[];
  days: { shift_date: string; calls: number }[];
}

const fmtDuration = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}h ${m}m` : `${m}m ${String(s).padStart(2, '0')}s`;
};
const fmtTimePKT = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { timeZone: 'Asia/Karachi', hour: 'numeric', minute: '2-digit' });
const fmtPhone = (p: string | null) => {
  const d = (p || '').replace(/\D/g, '').slice(-10);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p || 'Unknown';
};
const fmtDay = (ymd: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }) =>
  new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
const shiftDay = (ymd: string, delta: number) => {
  const d = new Date(ymd + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};
const scoreClass = (n: number | null) =>
  n === null ? 'bg-gray-100 text-gray-600' : n >= 7 ? 'bg-green-100 text-green-700' : n >= 4 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700';

export default function AgentCallsPage({ params }: { params: { id: string } }) {
  const [date, setDate] = useState<string | null>(null);
  const [data, setData] = useState<CallsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openTranscript, setOpenTranscript] = useState<number | null>(null);

  // Only the latest request may update the page (fast date clicks can overlap).
  const latest = useRef(0);

  const load = useCallback(async (d: string | null) => {
    const req = ++latest.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/hr/agents/${params.id}/calls${d ? `?date=${d}` : ''}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        cache: 'no-store',
      });
      const json = await res.json();
      if (req !== latest.current) return;
      if (!res.ok || json.status !== 'success') throw new Error(json.message || 'Failed to load calls');
      setData(json.data);
      setDate(json.data.date);
    } catch (e) {
      if (req === latest.current) setError(e instanceof Error ? e.message : 'Failed to load calls');
    } finally {
      if (req === latest.current) setLoading(false);
    }
  }, [params.id]);

  useEffect(() => { load(null); }, [load]);

  const go = (d: string) => {
    setDate(d);
    setOpenTranscript(null);
    load(d);
  };

  const agent = data?.agent;

  return (
    <div className="max-w-5xl mx-auto">
      <Link href="/hr/agents" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3">
        <ArrowLeft className="h-4 w-4" /> Agents
      </Link>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold">
            {agent?.full_name?.charAt(0).toUpperCase() || '·'}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{agent?.full_name || 'Agent calls'}</h1>
            <p className="text-sm text-gray-500">
              {agent ? <>Ext <span className="font-mono">{agent.extension_number}</span> · calls longer than {data?.min_seconds === 60 ? '1 minute' : `${data?.min_seconds}s`} with recordings</> : 'Loading…'}
            </p>
          </div>
        </div>

        {/* Date controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => date && go(shiftDay(date, -1))}
            disabled={!date || loading}
            className="h-9 w-9 inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40"
            aria-label="Previous shift"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <label className="sr-only" htmlFor="shift-date">Shift date</label>
          <input
            id="shift-date"
            type="date"
            value={date || ''}
            onChange={(e) => e.target.value && go(e.target.value)}
            className="h-9 rounded-lg border border-gray-300 px-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
          />
          <button
            onClick={() => date && go(shiftDay(date, 1))}
            disabled={!date || loading}
            className="h-9 w-9 inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40"
            aria-label="Next shift"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Recent shifts */}
      {data && data.days.length > 0 && (
        <div className="mb-5 -mx-1 flex gap-2 overflow-x-auto pb-1 px-1">
          {data.days.map((d) => (
            <button
              key={d.shift_date}
              onClick={() => go(d.shift_date)}
              className={`shrink-0 rounded-lg border px-3 py-1.5 text-left text-xs transition-colors ${
                d.shift_date === date ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              <div className="font-semibold">{fmtDay(d.shift_date)}</div>
              <div>{d.calls} call{d.calls === 1 ? '' : 's'}</div>
            </button>
          ))}
        </div>
      )}

      {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {data && (
        <>
          <p className="text-xs text-gray-500 mb-3">
            Shift of <span className="font-medium text-gray-700">{fmtDay(data.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</span>
            {' '}· {data.shift_window.start.slice(11)} → {data.shift_window.end.slice(11)} PKT
          </p>

          {/* Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            {[
              { label: 'Calls this shift', value: data.summary.total_calls, icon: Phone },
              { label: 'Longer than 1 min', value: data.summary.long_calls, icon: Clock },
              { label: 'Talk time (1 min+)', value: fmtDuration(data.summary.long_talk_seconds), icon: Headphones },
              { label: 'With recording', value: `${data.summary.with_recording}/${data.summary.long_calls}`, icon: FileAudio },
            ].map((s) => (
              <div key={s.label} className="bg-white rounded-xl border border-gray-200 shadow-sm px-4 py-3">
                <div className="flex items-center gap-1.5 text-xs text-gray-500"><s.icon className="h-3.5 w-3.5" /> {s.label}</div>
                <div className="mt-1 text-xl font-bold text-gray-900 tabular-nums">{s.value}</div>
              </div>
            ))}
          </div>

          {data.recordings_error && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {data.recordings_error}
            </div>
          )}
        </>
      )}

      {/* Calls */}
      {loading ? (
        <div className="py-16 text-center text-sm text-gray-400">Loading calls and matching recordings…</div>
      ) : data?.before_start ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center text-sm text-gray-500">
          {agent?.full_name} started on {fmtDay(data.start_date!, { month: 'long', day: 'numeric', year: 'numeric' })}. Earlier calls on extension {agent?.extension_number} belong to its previous user.
        </div>
      ) : data && data.calls.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center">
          <Phone className="mx-auto h-8 w-8 text-gray-300 mb-2" />
          <p className="font-medium text-gray-900">No calls longer than a minute on this shift</p>
          <p className="text-sm text-gray-500 mt-1">{data.summary.total_calls ? `${data.summary.total_calls} shorter calls were made.` : 'Pick another day above.'}</p>
        </div>
      ) : data ? (
        <div className="space-y-3">
          {data.calls.map((c, i) => (
            <div key={c.id} className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs font-semibold text-gray-400 tabular-nums w-6">{i + 1}</span>
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900">{fmtPhone(c.phone_number)}</div>
                    <div className="text-xs text-gray-500">{fmtTimePKT(c.call_time)} PKT · {fmtDuration(c.duration_sec)}</div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {c.qa?.meeting_scheduled && <span className="rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-xs font-medium">Meeting booked</span>}
                  {c.qa?.disposition && <span className="rounded-full bg-gray-100 text-gray-600 px-2 py-0.5 text-xs">{c.qa.disposition.replace(/_/g, ' ')}</span>}
                  {c.qa && c.qa.overall_score !== null && (
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${scoreClass(c.qa.overall_score)}`}>QA {c.qa.overall_score.toFixed(1)}/10</span>
                  )}
                  {c.qa?.transcript && (
                    <button
                      onClick={() => setOpenTranscript(openTranscript === c.id ? null : c.id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50"
                      aria-expanded={openTranscript === c.id}
                    >
                      <FileText className="h-3.5 w-3.5" /> Transcript
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-3 flex items-center gap-2">
                {c.play_url ? (
                  <>
                    <audio controls preload="none" src={c.play_url} className="h-10 w-full min-w-0" />
                    <a href={c.download_url!} className="shrink-0 h-9 w-9 inline-flex items-center justify-center rounded-lg border border-gray-300 hover:bg-gray-50" title="Download recording" aria-label="Download recording">
                      <Download className="h-4 w-4 text-gray-600" />
                    </a>
                  </>
                ) : (
                  <span className="text-xs text-gray-400">No recording found in 3CX for this call</span>
                )}
              </div>

              {openTranscript === c.id && c.qa?.transcript && (
                <div className="mt-3 max-h-72 overflow-y-auto rounded-lg bg-gray-50 border border-gray-200 p-3 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                  {c.qa.transcript}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
