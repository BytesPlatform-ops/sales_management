'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, ChevronDown, Download, Phone, Clock, FileAudio, AlertTriangle, Users, ExternalLink, Search } from 'lucide-react';

interface CallItem {
  id: number;
  call_time: string;
  phone_number: string | null;
  duration_sec: number;
  rec_id: string | null;
  play_url: string | null;
  download_url: string | null;
  qa: { overall_score: number | null; meeting_scheduled: boolean | null; disposition: string | null } | null;
}
interface AgentRow {
  id: number;
  full_name: string;
  username: string;
  extension_number: string;
  is_active: boolean;
  summary: { total_calls: number; long_calls: number; long_talk_seconds: number; with_recording: number; meetings: number };
  calls: CallItem[];
}
interface Data {
  date: string;
  min_seconds: number;
  shift_window: { start: string; end: string };
  recordings_error: string | null;
  totals: { agents_with_calls: number; total_calls: number; long_calls: number; with_recording: number; long_talk_seconds: number };
  agents: AgentRow[];
}

const fmtDuration = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}h ${m}m` : `${m}m ${String(s).padStart(2, '0')}s`;
};
const fmtTimePKT = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { timeZone: 'Asia/Karachi', hour: 'numeric', minute: '2-digit' });
const fmtPhone = (p: string | null) => {
  const d = (p || '').replace(/\D/g, '').slice(-10);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p || 'Unknown';
};
const fmtDay = (ymd: string) => new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const shiftDay = (ymd: string, delta: number) => {
  const d = new Date(ymd + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};
const scoreClass = (n: number) => (n >= 7 ? 'bg-green-100 text-green-700' : n >= 4 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700');

export default function RecordingsByAgentPage() {
  const [date, setDate] = useState<string | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState('');
  const [onlyWithCalls, setOnlyWithCalls] = useState(true);
  const latest = useRef(0);

  const load = useCallback(async (d: string | null) => {
    const req = ++latest.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/hr/recordings/by-agent${d ? `?date=${d}` : ''}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        cache: 'no-store',
      });
      const json = await res.json();
      if (req !== latest.current) return;
      if (!res.ok || json.status !== 'success') throw new Error(json.message || 'Failed to load recordings');
      setData(json.data);
      setDate(json.data.date);
      setOpen(new Set());
    } catch (e) {
      if (req === latest.current) setError(e instanceof Error ? e.message : 'Failed to load recordings');
    } finally {
      if (req === latest.current) setLoading(false);
    }
  }, []);

  useEffect(() => { load(null); }, [load]);

  const toggle = (id: number) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const agents = (data?.agents || []).filter((a) =>
    (!onlyWithCalls || a.summary.long_calls > 0) &&
    (!search || `${a.full_name} ${a.username} ${a.extension_number}`.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><FileAudio className="h-6 w-6 text-indigo-600" /> Recordings by Agent</h1>
          <p className="text-sm text-gray-500 mt-1">Every call longer than 1 minute in a shift, grouped by agent, with its 3CX recording.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => date && load(shiftDay(date, -1))} disabled={!date || loading}
            className="h-9 w-9 inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40" aria-label="Previous shift">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <label className="sr-only" htmlFor="shift-date">Shift date</label>
          <input id="shift-date" type="date" value={date || ''} onChange={(e) => e.target.value && load(e.target.value)}
            className="h-9 rounded-lg border border-gray-300 px-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none" />
          <button onClick={() => date && load(shiftDay(date, 1))} disabled={!date || loading}
            className="h-9 w-9 inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40" aria-label="Next shift">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {data && (
        <>
          <p className="text-xs text-gray-500 mb-3">
            Shift of <span className="font-medium text-gray-700">{fmtDay(data.date)}</span> · {data.shift_window.start.slice(11)} → {data.shift_window.end.slice(11)} PKT
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            {[
              { label: 'Agents with calls', value: data.totals.agents_with_calls, icon: Users },
              { label: 'Calls longer than 1 min', value: data.totals.long_calls, icon: Phone },
              { label: 'Talk time (1 min+)', value: fmtDuration(data.totals.long_talk_seconds), icon: Clock },
              { label: 'With recording', value: `${data.totals.with_recording}/${data.totals.long_calls}`, icon: FileAudio },
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
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search agent, username or extension"
                aria-label="Search agents"
                className="w-full h-9 rounded-lg border border-gray-300 pl-9 pr-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none" />
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={onlyWithCalls} onChange={(e) => setOnlyWithCalls(e.target.checked)} className="rounded border-gray-300" />
              Only agents with calls
            </label>
          </div>
        </>
      )}

      {loading ? (
        <div className="py-16 text-center text-sm text-gray-400">Loading calls and matching recordings for every agent…</div>
      ) : data && agents.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center">
          <Phone className="mx-auto h-8 w-8 text-gray-300 mb-2" />
          <p className="font-medium text-gray-900">No calls longer than a minute on this shift</p>
          <p className="text-sm text-gray-500 mt-1">Pick another day, or untick “Only agents with calls”.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {agents.map((a) => {
            const isOpen = open.has(a.id);
            return (
              <div key={a.id} className="bg-white rounded-2xl border border-gray-200 shadow-sm">
                <div className="flex flex-wrap items-center gap-3 p-4">
                  <button onClick={() => toggle(a.id)} aria-expanded={isOpen} disabled={a.summary.long_calls === 0}
                    className="flex flex-1 min-w-0 items-center gap-3 text-left disabled:cursor-default">
                    <div className={`h-10 w-10 shrink-0 rounded-full flex items-center justify-center font-bold text-sm ${a.is_active ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-200 text-gray-500'}`}>
                      {a.full_name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-gray-900 truncate">{a.full_name}{!a.is_active && <span className="ml-2 text-xs font-normal text-gray-400">inactive</span>}</div>
                      <div className="text-xs text-gray-500">Ext <span className="font-mono">{a.extension_number}</span> · {a.summary.total_calls} calls this shift</div>
                    </div>
                  </button>
                  <div className="flex items-center gap-4 text-sm">
                    <div className="text-center"><div className="font-bold text-gray-900 tabular-nums">{a.summary.long_calls}</div><div className="text-[11px] text-gray-500">1 min+</div></div>
                    <div className="text-center"><div className="font-bold text-gray-900 tabular-nums">{a.summary.with_recording}</div><div className="text-[11px] text-gray-500">recorded</div></div>
                    <div className="text-center hidden sm:block"><div className="font-bold text-gray-900 tabular-nums">{fmtDuration(a.summary.long_talk_seconds)}</div><div className="text-[11px] text-gray-500">talk</div></div>
                    <Link href={`/hr/agents/${a.id}/calls${date ? `?date=${date}` : ''}`} title="Open agent's calls page (transcripts, other days)"
                      className="h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-gray-100" aria-label={`Open ${a.full_name}'s calls page`}>
                      <ExternalLink className="h-4 w-4 text-gray-500" />
                    </Link>
                    {a.summary.long_calls > 0 && (
                      <button onClick={() => toggle(a.id)} className="h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-gray-100" aria-label={isOpen ? 'Collapse' : 'Expand'}>
                        <ChevronDown className={`h-4 w-4 text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                      </button>
                    )}
                  </div>
                </div>

                {isOpen && (
                  <div className="border-t border-gray-100 divide-y divide-gray-100">
                    {a.calls.map((c, i) => (
                      <div key={c.id} className="px-4 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="text-xs font-semibold text-gray-400 tabular-nums w-5">{i + 1}</span>
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-gray-900">{fmtPhone(c.phone_number)}</div>
                              <div className="text-xs text-gray-500">{fmtTimePKT(c.call_time)} PKT · {fmtDuration(c.duration_sec)}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {c.qa?.meeting_scheduled && <span className="rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-xs font-medium">Meeting booked</span>}
                            {c.qa && c.qa.overall_score !== null && <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${scoreClass(c.qa.overall_score)}`}>QA {c.qa.overall_score.toFixed(1)}/10</span>}
                          </div>
                        </div>
                        <div className="mt-2 flex items-center gap-2 pl-8">
                          {c.play_url ? (
                            <>
                              <audio controls preload="none" src={c.play_url} className="h-9 w-full min-w-0" />
                              <a href={c.download_url!} className="shrink-0 h-8 w-8 inline-flex items-center justify-center rounded-lg border border-gray-300 hover:bg-gray-50" title="Download recording" aria-label="Download recording">
                                <Download className="h-4 w-4 text-gray-600" />
                              </a>
                            </>
                          ) : (
                            <span className="text-xs text-gray-400">No recording found in 3CX for this call</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
