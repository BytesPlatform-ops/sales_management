'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api-client';
import {
  Phone,
  Loader2,
  Send,
  Check,
  X,
  Clock,
  Download,
  FileAudio,
  MessageSquare,
  Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface CallLog {
  id: number;
  phone_number: string;
  call_time: string;
  call_duration: string | null;
  agent_extension: string;
  rec_id: string | null;
}

interface RecordingRequest {
  id: number;
  phone_number: string;
  status: 'pending' | 'approved' | 'rejected';
  rec_id: string | null;
  notes: string | null;
  hr_notes: string | null;
  approved_by_name: string | null;
  created_at: string;
}

export default function AgentRecordingsPage() {
  useAuth();
  const [requests, setRequests] = useState<RecordingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [searching, setSearching] = useState(false);
  const [calls, setCalls] = useState<CallLog[] | null>(null);
  const [submitting, setSubmitting] = useState<number | null>(null);
  const [requestedCalls, setRequestedCalls] = useState<Set<number>>(new Set());
  const [submitMsg, setSubmitMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [downloading, setDownloading] = useState<number | null>(null);

  const fetchRequests = useCallback(async () => {
    try {
      const token = api.getToken();
      const res = await fetch('/api/agent/recordings', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const data = await res.json();
      if (data.status === 'success') setRequests(data.data);
    } catch (err) {
      console.error('Failed to fetch requests:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  const searchCalls = async () => {
    if (!phoneNumber.trim() || searching) return;
    setSearching(true);
    setCalls(null);
    setSubmitMsg(null);
    try {
      const token = api.getToken();
      const res = await fetch('/api/agent/recordings', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone_number: phoneNumber.trim(), action: 'search' }),
      });
      const data = await res.json();
      if (data.status === 'success') {
        setCalls(data.data);
        if (data.data.length === 0) {
          setSubmitMsg({ type: 'error', text: 'No calls found for this number' });
        }
      }
    } catch {
      setSubmitMsg({ type: 'error', text: 'Failed to search calls' });
    } finally {
      setSearching(false);
    }
  };

  const submitRequest = async (callLogId: number) => {
    if (submitting) return;
    setSubmitting(callLogId);
    setSubmitMsg(null);
    try {
      const token = api.getToken();
      const res = await fetch('/api/agent/recordings', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone_number: phoneNumber.trim(), call_log_id: callLogId, notes: notes.trim() || null }),
      });
      const data = await res.json();
      if (data.status === 'success') {
        setSubmitMsg({ type: 'success', text: 'Request submitted! HR will review it.' });
        setRequestedCalls(prev => new Set(prev).add(callLogId));
        fetchRequests();
      } else {
        setSubmitMsg({ type: 'error', text: data.message });
      }
    } catch {
      setSubmitMsg({ type: 'error', text: 'Failed to submit request' });
    } finally {
      setSubmitting(null);
    }
  };

  const downloadRecording = async (requestId: number) => {
    setDownloading(requestId);
    try {
      const token = api.getToken();
      const res = await fetch(`/api/agent/recordings/download?id=${requestId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.status === 'success' && data.data.download_url) {
        window.open(data.data.download_url, '_blank');
      } else {
        alert(data.message || 'Recording not available');
      }
    } catch {
      alert('Failed to download recording');
    } finally {
      setDownloading(null);
    }
  };

  const formatCallTime = (iso: string) => {
    const d = new Date(iso);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  };

  const statusConfig = {
    pending: { icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200', label: 'Pending' },
    approved: { icon: Check, color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200', label: 'Approved' },
    rejected: { icon: X, color: 'text-red-500', bg: 'bg-red-50 border-red-200', label: 'Rejected' },
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="h-7 w-7 animate-spin text-indigo-600" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Search Form */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-lg overflow-hidden">
        <div className="bg-gradient-to-br from-slate-50 to-blue-50 px-5 py-3 border-b">
          <div className="flex items-center gap-2">
            <FileAudio className="h-5 w-5 text-indigo-600" />
            <h2 className="text-sm font-bold text-gray-900">Request Call Recording</h2>
          </div>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">Phone Number</label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => { setPhoneNumber(e.target.value); setCalls(null); setSubmitMsg(null); }}
                  onKeyDown={(e) => e.key === 'Enter' && searchCalls()}
                  placeholder="Enter phone number..."
                  className="w-full pl-9 pr-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:bg-white transition-colors"
                />
              </div>
              <button
                onClick={searchCalls}
                disabled={searching || !phoneNumber.trim()}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-bold transition-all',
                  phoneNumber.trim()
                    ? 'bg-indigo-600 text-white hover:bg-indigo-700 active:scale-[0.98]'
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                )}
              >
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Search
              </button>
            </div>
          </div>

          {/* Call Results */}
          {calls !== null && calls.length > 0 && (
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5 block">
                Select Call ({calls.length} found)
              </label>
              <div className="space-y-1.5">
                {calls.map((call) => (
                  <div
                    key={call.id}
                    className="flex items-center justify-between px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg hover:border-indigo-300 transition-colors"
                  >
                    <div>
                      <span className="text-sm font-medium text-gray-900">{formatCallTime(call.call_time)}</span>
                      {call.call_duration && (
                        <span className="ml-2 text-xs text-gray-500">({call.call_duration})</span>
                      )}
                      <span className="ml-2 text-[10px] text-gray-400">Ext: {call.agent_extension}</span>
                    </div>
                    {requestedCalls.has(call.id) ? (
                      <span className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg">
                        <Check className="h-3 w-3" /> Requested
                      </span>
                    ) : (
                      <button
                        onClick={() => submitRequest(call.id)}
                        disabled={submitting === call.id}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors"
                      >
                        {submitting === call.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                        Request
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-2">
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Notes (optional) — why do you need this recording?"
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:bg-white transition-colors"
                />
              </div>
            </div>
          )}

          {submitMsg && (
            <p className={cn('text-xs font-medium', submitMsg.type === 'success' ? 'text-emerald-600' : 'text-red-500')}>
              {submitMsg.text}
            </p>
          )}
        </div>
      </div>

      {/* Request History */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-lg overflow-hidden">
        <div className="bg-gradient-to-br from-slate-50 to-blue-50 px-5 py-3 border-b">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-gray-900">My Requests</h2>
            <span className="text-xs text-gray-500">{requests.length} total</span>
          </div>
        </div>

        {requests.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-gray-400">
            No recording requests yet
          </div>
        ) : (
          <div className="divide-y">
            {requests.map((req) => {
              const cfg = statusConfig[req.status];
              const StatusIcon = cfg.icon;
              return (
                <div key={req.id} className="px-5 py-3 flex items-center gap-3">
                  <div className={cn('flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center border', cfg.bg)}>
                    <StatusIcon className={cn('h-4 w-4', cfg.color)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold font-mono text-gray-900">{req.phone_number}</span>
                      <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-bold border', cfg.bg, cfg.color)}>
                        {cfg.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-gray-400">
                        {new Date(req.created_at).toLocaleDateString()} {new Date(req.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {req.notes && (
                        <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
                          <MessageSquare className="h-2.5 w-2.5" /> {req.notes}
                        </span>
                      )}
                    </div>
                    {req.hr_notes && (
                      <p className="text-[10px] text-gray-500 mt-0.5">HR: {req.hr_notes}</p>
                    )}
                  </div>
                  {req.status === 'approved' && req.rec_id && (
                    <button
                      onClick={() => downloadRecording(req.id)}
                      disabled={downloading === req.id}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors"
                    >
                      {downloading === req.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                      Download
                    </button>
                  )}
                  {req.status === 'approved' && !req.rec_id && (
                    <span className="text-[10px] text-amber-500 font-medium">Recording not found</span>
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
