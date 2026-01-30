'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Check, X, User, DollarSign, Loader2, RefreshCw, Trophy } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

interface PendingSale {
  id: string;
  agent_id: number;
  customer_name: string;
  total_deal_value: string | number;
  amount_collected: string | number;
  status: string;
  approval_status: string;
  created_at: string;
  agent_name: string;
  agent_username: string;
}

export function PendingSalesFeed() {
  const [sales, setSales] = useState<PendingSale[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  // Fetch pending sales from API
  const fetchPendingSales = useCallback(async () => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
      const response = await fetch('/api/hr/sales/approve', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      });
      
      if (response.ok) {
        const data = await response.json();
        setSales(data.data || []);
      }
    } catch (error) {
      console.error('Failed to fetch pending sales:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Handle approve/reject action
  const handleAction = async (saleId: string, action: 'approve' | 'reject') => {
    setActionLoading(saleId);
    
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
      const response = await fetch('/api/hr/sales/approve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ saleId, action }),
      });
      
      if (response.ok) {
        const result = await response.json();
        // Remove the sale from the list immediately
        setSales(prev => prev.filter(sale => sale.id !== saleId));
        
        // Show Golden Ticket notification if triggered
        if (result.data?.goldenTicketTriggered) {
          console.log('🎫 Golden Ticket triggered!');
        }
      } else {
        const error = await response.json();
        console.error('Failed to process sale:', error.message);
      }
    } catch (error) {
      console.error('Failed to process sale:', error);
    } finally {
      setActionLoading(null);
    }
  };

  // Initial fetch
  useEffect(() => {
    fetchPendingSales();
  }, [fetchPendingSales]);

  // Set up real-time subscription
  useEffect(() => {
    // Subscribe to INSERT events on sales table
    const channel = supabase
      .channel('sales_realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'sales',
        },
        async (payload) => {
          console.log('🔔 New sale received:', payload);
          // Refetch to get the full data with agent info
          await fetchPendingSales();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'sales'
        },
        (payload) => {
          console.log('📝 Sale updated:', payload);
          // Remove approved/rejected sales from the list
          if (payload.new && (payload.new as any).approval_status !== 'pending') {
            setSales(prev => prev.filter(sale => sale.id !== (payload.new as any).id));
          }
        }
      )
      .subscribe((status) => {
        console.log('Supabase sales subscription status:', status);
        setConnected(status === 'SUBSCRIBED');
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchPendingSales]);

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
          <Trophy className="h-5 w-5 text-yellow-500" />
          <h3 className="font-semibold text-gray-900">Pending Sale Approvals</h3>
          {sales.length > 0 && (
            <span className="bg-yellow-100 text-yellow-700 text-xs font-medium px-2 py-0.5 rounded-full">
              {sales.length}
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
            onClick={fetchPendingSales}
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
            <p className="text-sm text-gray-500 mt-2">Loading pending sales...</p>
          </div>
        ) : sales.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <Check className="h-12 w-12 mx-auto text-green-300 mb-2" />
            <p className="font-medium">All caught up!</p>
            <p className="text-sm">No pending sales to verify.</p>
          </div>
        ) : (
          <div className="divide-y">
            {sales.map((sale) => (
              <div
                key={sale.id}
                className="p-4 hover:bg-gray-50 transition-colors animate-fade-in"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    {/* Agent info */}
                    <div className="flex items-center gap-1 text-xs text-gray-500 mb-1">
                      <User className="h-3 w-3" />
                      <span className="font-medium text-gray-700">{sale.agent_name}</span>
                      <span>•</span>
                      <span>{formatRelativeTime(sale.created_at)}</span>
                    </div>
                    
                    {/* Customer and deal info */}
                    <p className="font-medium text-gray-900 truncate">
                      {sale.customer_name}
                    </p>
                    <div className="flex items-center gap-3 text-sm mt-1">
                      <div className="flex items-center gap-1 text-green-600 font-semibold">
                        <DollarSign className="h-3 w-3" />
                        <span>{formatCurrency(Number(sale.total_deal_value))}</span>
                      </div>
                      {Number(sale.amount_collected) > 0 && (
                        <span className="text-gray-500">
                          Paid: {formatCurrency(Number(sale.amount_collected))}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                      onClick={() => handleAction(sale.id, 'reject')}
                      disabled={actionLoading === sale.id}
                    >
                      {actionLoading === sale.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <X className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      size="sm"
                      className="bg-green-600 hover:bg-green-700 text-white"
                      onClick={() => handleAction(sale.id, 'approve')}
                      disabled={actionLoading === sale.id}
                    >
                      {actionLoading === sale.id ? (
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
