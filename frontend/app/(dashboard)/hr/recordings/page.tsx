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
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface RecordingRequest {
  id: number;
  agent_id: number;
  agent_name: string;
  agent_full_name: string | null;
  phone_number: string;
  status: 'pending' | 'approved' | 'rejected';
  rec_id: string | null;
  notes: string | null;
  hr_notes: string | null;
  approved_by_name: string | null;
  created_at: string;
}

export default function HRRecordingsPage() {
  useAuth();
  const [requests, setRequests] = useState<RecordingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [processing, setProcessing] = useState<number | null>(null);

  const fetchRequests = useCallback(async () => {
    try {
      const token = api.getToken();
      const res = await fetch(`/api/hr/recordings?status=${filter}`, {
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
  }, [filter]);

  useEffect(() => { setLoading(true); fetchRequests(); }, [fetchRequests]);

  const handleAction = async (requestId: number, action: 'approve' | 'reject') => {
    setProcessing(requestId);
    try {
      const token = api.getToken();
      const res = await fetch('/api/hr/recordings', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: requestId, action }),
      });
      const data = await res.json();
      if (data.status === 'success') {
        fetchRequests();
      } else {
        alert(data.message);
      }
    } catch {
      alert('Failed to process request');
    } finally {
      setProcessing(null);
    }
  };

  const pendingCount = requests.filter(r => r.status === 'pending').length;

  const statusConfig = {
    pending: { icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200', label: 'Pending' },
    approved: { icon: Check, color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200', label: 'Approved' },
    rejected: { icon: X, color: 'text-red-500', bg: 'bg-red-50 border-red-200', label: 'Rejected' },
  };

  const filters = [
    { value: 'pending' as const, label: 'Pending', count: pendingCount },
    { value: 'approved' as const, label: 'Approved' },
    { value: 'rejected' as const, label: 'Rejected' },
    { value: 'all' as const, label: 'All' },
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileAudio className="h-5 w-5 text-indigo-600" />
          <h1 className="text-lg font-bold text-gray-900">Recording Requests</h1>
          {pendingCount > 0 && (
            <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs font-bold">
              {pendingCount} pending
            </span>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
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
            {f.count !== undefined && f.count > 0 && (
              <span className="ml-1 px-1.5 py-px bg-white/20 rounded text-[10px]">{f.count}</span>
            )}
          </button>
        ))}
      </div>

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
              return (
                <div key={req.id} className="px-5 py-4 flex items-center gap-4">
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
                      </span>
                      <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-bold border', cfg.bg, cfg.color)}>
                        {cfg.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-[10px] text-gray-400">
                        {new Date(req.created_at).toLocaleDateString()} {new Date(req.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {req.notes && (
                        <span className="text-[10px] text-gray-500 flex items-center gap-0.5">
                          <MessageSquare className="h-2.5 w-2.5" /> {req.notes}
                        </span>
                      )}
                      {req.status === 'approved' && !req.rec_id && (
                        <span className="text-[10px] text-amber-500 font-medium">Recording not found in 3CX</span>
                      )}
                      {req.status === 'approved' && req.rec_id && (
                        <span className="text-[10px] text-emerald-500 font-medium">Recording found</span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  {req.status === 'pending' && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleAction(req.id, 'approve')}
                        disabled={processing === req.id}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors"
                      >
                        {processing === req.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                        Approve
                      </button>
                      <button
                        onClick={() => handleAction(req.id, 'reject')}
                        disabled={processing === req.id}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
                      >
                        <X className="h-3 w-3" />
                        Reject
                      </button>
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
