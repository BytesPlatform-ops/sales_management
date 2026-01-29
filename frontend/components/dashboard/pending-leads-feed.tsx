'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Check, X, User, Mail, Loader2, RefreshCw, Zap } from 'lucide-react';

interface PendingLead {
  id: string;
  agent_id: number;
  customer_name: string;
  customer_email: string;
  status: string;
  created_at: string;
  agent_name: string;
  agent_username: string;
}

export function PendingLeadsFeed() {
  const [leads, setLeads] = useState<PendingLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  // Fetch pending leads from API
  const fetchPendingLeads = useCallback(async () => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
      const response = await fetch('/api/hr/leads/approve', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      });
      
      if (response.ok) {
        const data = await response.json();
        setLeads(data.data || []);
      }
    } catch (error) {
      console.error('Failed to fetch pending leads:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Handle approve/reject action
  const handleAction = async (leadId: string, action: 'approve' | 'reject') => {
    setActionLoading(leadId);
    
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
      const response = await fetch('/api/hr/leads/approve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ leadId, action }),
      });
      
      if (response.ok) {
        // Remove the lead from the list immediately
        setLeads(prev => prev.filter(lead => lead.id !== leadId));
      } else {
        const error = await response.json();
        console.error('Failed to process lead:', error.message);
      }
    } catch (error) {
      console.error('Failed to process lead:', error);
    } finally {
      setActionLoading(null);
    }
  };

  // Initial fetch
  useEffect(() => {
    fetchPendingLeads();
  }, [fetchPendingLeads]);

  // Set up real-time subscription
  useEffect(() => {
    // Subscribe to INSERT events on agent_leads table
    const channel = supabase
      .channel('agent_leads_realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'agent_leads',
          filter: 'status=eq.pending'
        },
        async (payload) => {
          console.log('🔔 New lead received:', payload);
          // Refetch to get the full data with agent info
          await fetchPendingLeads();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'agent_leads'
        },
        (payload) => {
          console.log('📝 Lead updated:', payload);
          // Remove approved/rejected leads from the list
          if (payload.new && (payload.new as any).status !== 'pending') {
            setLeads(prev => prev.filter(lead => lead.id !== (payload.new as any).id));
          }
        }
      )
      .subscribe((status) => {
        console.log('Supabase subscription status:', status);
        setConnected(status === 'SUBSCRIBED');
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchPendingLeads]);

  // Format relative time
  const formatRelativeTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    
    return date.toLocaleDateString();
  };

  return (
    <div className="bg-white rounded-xl border shadow-sm">
      {/* Header */}
      <div className="p-4 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-amber-500" />
          <h3 className="font-semibold text-gray-900">Pending Lead Verifications</h3>
          {leads.length > 0 && (
            <span className="bg-amber-100 text-amber-700 text-xs font-medium px-2 py-0.5 rounded-full">
              {leads.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {connected && (
            <span className="flex items-center gap-1 text-xs text-green-600">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
              Live
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchPendingLeads}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="max-h-[400px] overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-gray-400" />
            <p className="text-sm text-gray-500 mt-2">Loading pending leads...</p>
          </div>
        ) : leads.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <Check className="h-12 w-12 mx-auto text-green-300 mb-2" />
            <p className="font-medium">All caught up!</p>
            <p className="text-sm">No pending leads to verify.</p>
          </div>
        ) : (
          <div className="divide-y">
            {leads.map((lead) => (
              <div
                key={lead.id}
                className="p-4 hover:bg-gray-50 transition-colors animate-fade-in"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    {/* Agent info */}
                    <div className="flex items-center gap-1 text-xs text-gray-500 mb-1">
                      <User className="h-3 w-3" />
                      <span className="font-medium text-gray-700">{lead.agent_name}</span>
                      <span>•</span>
                      <span>{formatRelativeTime(lead.created_at)}</span>
                    </div>
                    
                    {/* Customer info */}
                    <p className="font-medium text-gray-900 truncate">
                      {lead.customer_name}
                    </p>
                    <div className="flex items-center gap-1 text-sm text-gray-500 mt-0.5">
                      <Mail className="h-3 w-3" />
                      <span className="truncate">{lead.customer_email}</span>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                      onClick={() => handleAction(lead.id, 'reject')}
                      disabled={actionLoading === lead.id}
                    >
                      {actionLoading === lead.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <X className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      size="sm"
                      className="bg-green-600 hover:bg-green-700 text-white"
                      onClick={() => handleAction(lead.id, 'approve')}
                      disabled={actionLoading === lead.id}
                    >
                      {actionLoading === lead.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Check className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
