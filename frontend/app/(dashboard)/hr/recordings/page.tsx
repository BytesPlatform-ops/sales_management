'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api-client';
import {
  Loader2,
  Check,
  X,
  Clock,
  Phone,
  FileAudio,
  MessageSquare,
  User,
  RefreshCw,
  Search,
  Link2,
  Unlink,
  Play,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface RecordingRequest {
  id: number;
  agent_id: number;
  agent_name: string;
  agent_full_name: string | null;
  agent_extension: string | null;
  phone_number: string;
  status: 'pending' | 'approved' | 'rejected';
  rec_id: string | null;
  play_url: string | null;
  notes: string | null;
  hr_notes: string | null;
  approved_by_name: string | null;
  created_at: string;
  call_time: string | null;
  call_duration: string | null;
}

interface Candidate {
  rec_id: string;
  start_time: string;
  end_time: string;
  duration_sec: number;
  from: string;
  to: string;
  from_name: string;
  call_type: string;
  minutes_from_call: number | null;
  play_url: string;
}

type Filter = 'pending' | 'approved' | 'missing' | 'rejected' | 'all';

const pkt = (iso: string, withDate = true) =>
  new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Asia/Karachi',
    ...(withDate ? { day: '2-digit', month: 'short' } : {}),
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

export default function HRRecordingsPage() {
  useAuth();
  const [requests, setRequests] = useState<RecordingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('pending');
  const [processing, setProcessing] = useState<number | 'all' | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [finder, setFinder] = useState<{ requestId: number; loading: boolean; callTime: string | null; items: Candidate[]; error?: string } | null>(null);
  const [manualId, setManualId] = useState('');

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch('/api/hr/recordings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${api.getToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json();
  };

  const fetchRequests = useCallback(async () => {
    try {
      const res = await fetch(`/api/hr/recordings?status=${filter}`, {
        headers: { Authorization: `Bearer ${api.getToken()}` },
        cache: 'no-store',
      });
      const data = await res.json();
      if (data.status === 'success') setRequests(data.data);
    } catch (err) {
      console.error('Failed to fetch requests:', err);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { setLoading(true); fetchRequests(); }, [fetchRequests]);

  const runAction = async (requestId: number | 'all', body: Record<string, unknown>) => {
    setProcessing(requestId);
    setMessage(null);
    try {
      const data = await post(body);
      const ok = data.status === 'success';
      const notFound = ok && data.data && 'has_recording' in data.data && !data.data.has_recording;
      setMessage({ type: !ok ? 'error' : notFound ? 'info' : 'success', text: data.message || (ok ? 'Done' : 'Failed') });
      if (ok) {
        await fetchRequests();
        if (finder && body.action === 'link') setFinder(null);
      }
    } catch {
      setMessage({ type: 'error', text: 'Request failed' });
    } finally {
      setProcessing(null);
    }
  };

  const openFinder = async (req: RecordingRequest) => {
    if (finder?.requestId === req.id) { setFinder(null); return; }
    setManualId('');
    setFinder({ requestId: req.id, loading: true, callTime: req.call_time, items: [] });
    const data = await post({ action: 'candidates', request_id: req.id });
    setFinder({
      requestId: req.id,
      loading: false,
      callTime: data.call_time || req.call_time,
      items: data.status === 'success' ? data.data : [],
      error: data.status === 'success' ? undefined : data.message,
    });
  };

  const statusConfig = {
    pending: { icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200', label: 'Pending' },
    approved: { icon: Check, color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200', label: 'Approved' },
    rejected: { icon: X, color: 'text-red-500', bg: 'bg-red-50 border-red-200', label: 'Rejected' },
  };

  const filters: { value: Filter; label: string }[] = [
    { value: 'pending', label: 'Pending' },
    { value: 'approved', label: 'Approved' },
    { value: 'missing', label: 'Missing recording' },
    { value: 'rejected', label: 'Rejected' },
    { value: 'all', label: 'All' },
  ];

  const btn = 'flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors disabled:opacity-50';

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <FileAudio className="h-5 w-5 text-indigo-600" />
          <h1 className="text-lg font-bold text-gray-900">Recording Requests</h1>
        </div>
        <button
          onClick={() => runAction('all', { action: 'retry_all' })}
          disabled={processing !== null}
          title="Look up every approved request that still has no recording (last 45 days)"
          className={cn(btn, 'text-indigo-700 bg-indigo-50 border-indigo-200 hover:bg-indigo-100')}
        >
          {processing === 'all' ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Retry all missing
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {filters.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={cn(
              'px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors',
              filter === f.value
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {message && (
        <div className={cn(
          'px-4 py-2 rounded-lg text-xs border',
          message.type === 'success' && 'bg-emerald-50 border-emerald-200 text-emerald-800',
          message.type === 'info' && 'bg-amber-50 border-amber-200 text-amber-800',
          message.type === 'error' && 'bg-red-50 border-red-200 text-red-700',
        )}>
          {message.text}
        </div>
      )}

      {/* Requests List */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-lg overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-indigo-600" />
          </div>
        ) : requests.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-gray-400">
            No {filter !== 'all' ? filter : ''} recording requests
          </div>
        ) : (
          <div className="divide-y">
            {requests.map((req) => {
              const cfg = statusConfig[req.status];
              const StatusIcon = cfg.icon;
              const busy = processing === req.id;
              return (
                <div key={req.id} className="px-5 py-4">
                  <div className="flex items-center gap-4">
                    {/* Status */}
                    <div className={cn('flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center border', cfg.bg)}>
                      <StatusIcon className={cn('h-4 w-4', cfg.color)} />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold font-mono text-gray-900 flex items-center gap-1">
                          <Phone className="h-3 w-3 text-gray-400" />
                          {req.phone_number}
                        </span>
                        <span className="text-xs text-indigo-600 font-medium flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {req.agent_full_name || req.agent_name}
                          {req.agent_extension && <span className="text-gray-400">· ext {req.agent_extension}</span>}
                        </span>
                        <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-bold border', cfg.bg, cfg.color)}>
                          {cfg.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 flex-wrap">
                        {req.call_time && (
                          <span className="text-[10px] text-gray-600">
                            Call: {pkt(req.call_time)} PKT{req.call_duration ? ` · ${req.call_duration}` : ''}
                          </span>
                        )}
                        <span className="text-[10px] text-gray-400">Requested {pkt(req.created_at)}</span>
                        {req.notes && (
                          <span className="text-[10px] text-gray-500 flex items-center gap-0.5">
                            <MessageSquare className="h-2.5 w-2.5" /> {req.notes}
                          </span>
                        )}
                        {req.status === 'approved' && !req.rec_id && (
                          <span className="text-[10px] text-amber-600 font-medium">Recording not found yet</span>
                        )}
                        {req.rec_id && (
                          <span className="text-[10px] text-emerald-600 font-medium">Recording #{req.rec_id}</span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      {req.play_url && (
                        <button
                          onClick={() => setPlaying(playing === req.play_url ? null : req.play_url)}
                          className={cn(btn, 'text-gray-700 bg-gray-50 border-gray-200 hover:bg-gray-100')}
                        >
                          <Play className="h-3 w-3" /> Listen
                        </button>
                      )}
                      {req.status === 'pending' && (
                        <>
                          <button
                            onClick={() => runAction(req.id, { action: 'approve', request_id: req.id })}
                            disabled={busy}
                            className={cn(btn, 'text-emerald-700 bg-emerald-50 border-emerald-200 hover:bg-emerald-100')}
                          >
                            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                            Approve
                          </button>
                          <button
                            onClick={() => runAction(req.id, { action: 'reject', request_id: req.id })}
                            disabled={busy}
                            className={cn(btn, 'text-red-600 bg-red-50 border-red-200 hover:bg-red-100')}
                          >
                            <X className="h-3 w-3" /> Reject
                          </button>
                        </>
                      )}
                      {req.status === 'approved' && !req.rec_id && (
                        <button
                          onClick={() => runAction(req.id, { action: 'retry', request_id: req.id })}
                          disabled={busy}
                          className={cn(btn, 'text-amber-700 bg-amber-50 border-amber-200 hover:bg-amber-100')}
                        >
                          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                          Retry
                        </button>
                      )}
                      {req.status !== 'rejected' && (
                        <button
                          onClick={() => openFinder(req)}
                          className={cn(btn, 'text-indigo-700 bg-white border-indigo-200 hover:bg-indigo-50')}
                          title="See every 3CX recording for this number around the call and pick the right one"
                        >
                          <Search className="h-3 w-3" /> {req.rec_id ? 'Wrong recording?' : 'Find recording'}
                        </button>
                      )}
                    </div>
                  </div>

                  {req.play_url && playing === req.play_url && (
                    <audio controls autoPlay src={req.play_url} className="w-full mt-3 h-9" onError={() => setMessage({ type: 'error', text: 'Could not play — refresh the page (links expire after 15 min) or the recording was removed from 3CX.' })} />
                  )}

                  {/* Manual finder */}
                  {finder?.requestId === req.id && (
                    <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50/40 p-3 space-y-2">
                      <p className="text-[11px] text-gray-600">
                        3CX recordings for <span className="font-mono">{req.phone_number}</span> within 2 days
                        {finder.callTime ? <> of the call ({pkt(finder.callTime)} PKT)</> : null}. Pick the one that is this call.
                      </p>
                      {finder.loading ? (
                        <div className="flex items-center gap-2 text-xs text-gray-500"><Loader2 className="h-3 w-3 animate-spin" /> Asking 3CX…</div>
                      ) : finder.error ? (
                        <p className="text-xs text-red-600">{finder.error}</p>
                      ) : finder.items.length === 0 ? (
                        <p className="text-xs text-amber-700">3CX has no recording for this number in that period — the call was not recorded (or 3CX already deleted it).</p>
                      ) : (
                        <div className="divide-y divide-indigo-100 bg-white rounded-lg border border-indigo-100">
                          {finder.items.map(c => (
                            <div key={c.rec_id} className="px-3 py-2">
                              <div className="flex items-center gap-3 flex-wrap text-xs">
                                <span className="font-mono text-gray-500">#{c.rec_id}</span>
                                <span className="text-gray-900">{pkt(c.start_time)} PKT</span>
                                <span className="font-mono bg-gray-100 px-1.5 rounded">{mmss(c.duration_sec)}</span>
                                <span className="text-gray-600">{c.from} → {c.to}</span>
                                {c.minutes_from_call !== null && (
                                  <span className={cn('text-[10px]', Math.abs(c.minutes_from_call) <= 10 ? 'text-emerald-600 font-semibold' : 'text-gray-400')}>
                                    {c.minutes_from_call === 0 ? 'ends at call time' : `${Math.abs(c.minutes_from_call)} min ${c.minutes_from_call > 0 ? 'after' : 'before'} call`}
                                  </span>
                                )}
                                {String(c.rec_id) === String(req.rec_id) && <span className="text-[10px] text-emerald-600 font-bold">linked</span>}
                                <div className="ml-auto flex gap-2">
                                  <button onClick={() => setPlaying(playing === c.play_url ? null : c.play_url)} className={cn(btn, 'text-gray-700 bg-gray-50 border-gray-200 hover:bg-gray-100')}>
                                    <Play className="h-3 w-3" /> Listen
                                  </button>
                                  {String(c.rec_id) !== String(req.rec_id) && (
                                    <button
                                      onClick={() => runAction(req.id, { action: 'link', request_id: req.id, rec_id: c.rec_id })}
                                      disabled={busy}
                                      className={cn(btn, 'text-emerald-700 bg-emerald-50 border-emerald-200 hover:bg-emerald-100')}
                                    >
                                      <Link2 className="h-3 w-3" /> Link
                                    </button>
                                  )}
                                </div>
                              </div>
                              {playing === c.play_url && <audio controls autoPlay src={c.play_url} className="w-full mt-2 h-9" />}
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center gap-2 flex-wrap">
                        <input
                          value={manualId}
                          onChange={e => setManualId(e.target.value.replace(/\D/g, ''))}
                          placeholder="3CX recording ID (from 3CX Admin → Recordings)"
                          className="flex-1 min-w-[220px] px-2 py-1.5 text-xs border border-indigo-200 rounded-lg font-mono"
                        />
                        <button
                          onClick={() => runAction(req.id, { action: 'link', request_id: req.id, rec_id: manualId })}
                          disabled={!manualId || busy}
                          className={cn(btn, 'text-emerald-700 bg-emerald-50 border-emerald-200 hover:bg-emerald-100')}
                        >
                          <Link2 className="h-3 w-3" /> Link ID
                        </button>
                        {req.rec_id && (
                          <button
                            onClick={() => runAction(req.id, { action: 'unlink', request_id: req.id })}
                            disabled={busy}
                            className={cn(btn, 'text-red-600 bg-red-50 border-red-200 hover:bg-red-100')}
                          >
                            <Unlink className="h-3 w-3" /> Remove linked
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
