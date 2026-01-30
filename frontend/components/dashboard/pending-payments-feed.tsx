'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Check, X, User, DollarSign, Loader2, RefreshCw, CreditCard } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

interface PendingPayment {
  id: string;
  sale_id: string;
  agent_id: number;
  amount: string | number;
  status: string;
  created_at: string;
  customer_name: string;
  total_deal_value: string | number;
  amount_collected: string | number;
  sale_status: string;
  agent_name: string;
  agent_username: string;
}

export function PendingPaymentsFeed() {
  const [payments, setPayments] = useState<PendingPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  // Fetch pending payments from API
  const fetchPendingPayments = useCallback(async () => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
      const response = await fetch('/api/hr/payments/approve', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      });
      
      if (response.ok) {
        const data = await response.json();
        setPayments(data.data || []);
      }
    } catch (error) {
      console.error('Failed to fetch pending payments:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Handle approve/reject action
  const handleAction = async (paymentId: string, action: 'approve' | 'reject') => {
    setActionLoading(paymentId);
    
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
      const response = await fetch('/api/hr/payments/approve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ paymentId, action }),
      });
      
      if (response.ok) {
        const result = await response.json();
        // Remove the payment from the list immediately
        setPayments(prev => prev.filter(payment => payment.id !== paymentId));
        
        // Show commission notification if earned
        if (result.data?.commissionEarned > 0) {
          console.log(`💰 Commission earned: $${result.data.commissionEarned}`);
        }
      } else {
        const error = await response.json();
        console.error('Failed to process payment:', error.message);
      }
    } catch (error) {
      console.error('Failed to process payment:', error);
    } finally {
      setActionLoading(null);
    }
  };

  // Initial fetch
  useEffect(() => {
    fetchPendingPayments();
  }, [fetchPendingPayments]);

  // Set up real-time subscription
  useEffect(() => {
    // Subscribe to INSERT events on payments table
    const channel = supabase
      .channel('payments_realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'payments',
        },
        async (payload) => {
          console.log('🔔 New payment received:', payload);
          // Refetch to get the full data with sale and agent info
          await fetchPendingPayments();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'payments'
        },
        (payload) => {
          console.log('📝 Payment updated:', payload);
          // Remove approved/rejected payments from the list
          if (payload.new && (payload.new as any).status !== 'pending') {
            setPayments(prev => prev.filter(payment => payment.id !== (payload.new as any).id));
          }
        }
      )
      .subscribe((status) => {
        console.log('Supabase payments subscription status:', status);
        setConnected(status === 'SUBSCRIBED');
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchPendingPayments]);

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

  // Calculate progress
  const calculateProgress = (collected: number, total: number, paymentAmount: number) => {
    const currentProgress = Math.round((collected / total) * 100);
    const afterProgress = Math.round(((collected + paymentAmount) / total) * 100);
    return { currentProgress, afterProgress };
  };

  return (
    <div className="bg-white rounded-xl border shadow-sm">
      {/* Header */}
      <div className="p-4 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-blue-500" />
          <h3 className="font-semibold text-gray-900">Pending Payment Approvals</h3>
          {payments.length > 0 && (
            <span className="bg-blue-100 text-blue-700 text-xs font-medium px-2 py-0.5 rounded-full">
              {payments.length}
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
            onClick={fetchPendingPayments}
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
            <p className="text-sm text-gray-500 mt-2">Loading pending payments...</p>
          </div>
        ) : payments.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <Check className="h-12 w-12 mx-auto text-green-300 mb-2" />
            <p className="font-medium">All caught up!</p>
            <p className="text-sm">No pending payments to verify.</p>
          </div>
        ) : (
          <div className="divide-y">
            {payments.map((payment) => {
              const paymentAmount = Number(payment.amount);
              const totalDealValue = Number(payment.total_deal_value);
              const amountCollected = Number(payment.amount_collected);
              const { currentProgress, afterProgress } = calculateProgress(amountCollected, totalDealValue, paymentAmount);
              const willComplete = afterProgress >= 100;

              return (
                <div
                  key={payment.id}
                  className="p-4 hover:bg-gray-50 transition-colors animate-fade-in"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      {/* Agent info */}
                      <div className="flex items-center gap-1 text-xs text-gray-500 mb-1">
                        <User className="h-3 w-3" />
                        <span className="font-medium text-gray-700">{payment.agent_name}</span>
                        <span>•</span>
                        <span>{formatRelativeTime(payment.created_at)}</span>
                      </div>
                      
                      {/* Customer and payment info */}
                      <p className="font-medium text-gray-900 truncate">
                        {payment.customer_name}
                      </p>
                      <div className="flex items-center gap-3 text-sm mt-1">
                        <div className="flex items-center gap-1 text-blue-600 font-semibold">
                          <DollarSign className="h-3 w-3" />
                          <span>+{formatCurrency(paymentAmount)}</span>
                        </div>
                        <span className="text-gray-500">
                          ({formatCurrency(amountCollected)} → {formatCurrency(amountCollected + paymentAmount)} / {formatCurrency(totalDealValue)})
                        </span>
                      </div>
                      
                      {/* Progress bar */}
                      <div className="mt-2">
                        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-gradient-to-r from-blue-500 to-green-500 transition-all"
                            style={{ width: `${afterProgress}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-xs mt-1">
                          <span className="text-gray-500">{currentProgress}% → {afterProgress}%</span>
                          {willComplete && (
                            <span className="text-green-600 font-medium">🎉 Will complete sale!</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                        onClick={() => handleAction(payment.id, 'reject')}
                        disabled={actionLoading === payment.id}
                      >
                        {actionLoading === payment.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <X className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        size="sm"
                        className="bg-green-600 hover:bg-green-700 text-white"
                        onClick={() => handleAction(payment.id, 'approve')}
                        disabled={actionLoading === payment.id}
                      >
                        {actionLoading === payment.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Check className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
