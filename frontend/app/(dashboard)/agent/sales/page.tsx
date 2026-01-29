'use client';

import { useState, useCallback } from 'react';
import useSWR from 'swr';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Receipt,
  Plus,
  DollarSign,
  User,
  CheckCircle2,
  Clock,
  Loader2,
  TrendingUp,
  Trophy,
  CreditCard,
} from 'lucide-react';

interface Sale {
  id: string;
  customerName: string;
  totalDealValue: number;
  amountCollected: number;
  status: 'partial' | 'completed';
  commissionPaid: boolean;
  commissionAmount: number;
  progress: number;
  createdAt: string;
  updatedAt: string;
}

interface SalesData {
  sales: Sale[];
  totals: {
    totalSales: number;
    totalDealValue: number;
    totalCollected: number;
    completedSales: number;
    partialSales: number;
    totalCommissionEarned: number;
  };
}

const fetcher = async (url: string) => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error('Failed to fetch');
  const json = await res.json();
  return json.data;
};

export default function SalesPage() {
  const { user } = useAuth();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  // Form state for new sale
  const [customerName, setCustomerName] = useState('');
  const [totalDealValue, setTotalDealValue] = useState('');
  const [initialPayment, setInitialPayment] = useState('');

  // Form state for payment
  const [paymentAmount, setPaymentAmount] = useState('');

  const { data, error, isLoading, mutate } = useSWR<SalesData>(
    '/api/agent/sales',
    fetcher,
    { refreshInterval: 10000 }
  );

  // Create new sale handler
  const handleCreateSale = useCallback(async () => {
    const total = parseFloat(totalDealValue);
    const initial = parseFloat(initialPayment) || 0;

    if (!customerName.trim() || isNaN(total) || total <= 0) {
      return;
    }

    setIsSubmitting(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/agent/sales', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          customerName: customerName.trim(),
          totalDealValue: total,
          initialPayment: initial,
        }),
      });

      if (response.ok) {
        const result = await response.json();
        setCreateDialogOpen(false);
        setCustomerName('');
        setTotalDealValue('');
        setInitialPayment('');
        mutate();

        // Show success message
        setSuccessMessage(result.message);
        setTimeout(() => setSuccessMessage(''), 5000);

        // If completed immediately, show confetti
        if (result.data?.sale?.status === 'completed') {
          setShowConfetti(true);
          setTimeout(() => setShowConfetti(false), 5000);
        }
      }
    } catch (error) {
      console.error('Failed to create sale:', error);
    } finally {
      setIsSubmitting(false);
    }
  }, [customerName, totalDealValue, initialPayment, mutate]);

  // Add payment handler
  const handleAddPayment = useCallback(async () => {
    if (!selectedSale || !paymentAmount) return;

    const amount = parseFloat(paymentAmount);
    if (isNaN(amount) || amount <= 0) return;

    setIsSubmitting(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/agent/sales/${selectedSale.id}/payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ amount }),
      });

      if (response.ok) {
        const result = await response.json();
        setPaymentDialogOpen(false);
        setPaymentAmount('');
        setSelectedSale(null);
        mutate();

        // Show success message
        setSuccessMessage(result.message);
        setTimeout(() => setSuccessMessage(''), 5000);

        // If completed, show confetti
        if (result.data?.isCompleted) {
          setShowConfetti(true);
          setTimeout(() => setShowConfetti(false), 5000);
        }
      }
    } catch (error) {
      console.error('Failed to add payment:', error);
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedSale, paymentAmount, mutate]);

  const openPaymentDialog = (sale: Sale) => {
    setSelectedSale(sale);
    setPaymentAmount('');
    setPaymentDialogOpen(true);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-indigo-600 mx-auto mb-4" />
          <p className="text-gray-500">Loading sales...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center text-red-600">
          <p>Failed to load sales</p>
          <Button onClick={() => mutate()} className="mt-4">
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const sales = data?.sales || [];
  const totals = data?.totals || {
    totalSales: 0,
    totalDealValue: 0,
    totalCollected: 0,
    completedSales: 0,
    partialSales: 0,
    totalCommissionEarned: 0,
  };

  return (
    <div className="space-y-6 pb-10">
      {/* Confetti Effect */}
      {showConfetti && (
        <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
          {[...Array(50)].map((_, i) => (
            <div
              key={i}
              className="absolute animate-confetti"
              style={{
                left: `${Math.random() * 100}%`,
                animationDelay: `${Math.random() * 2}s`,
                backgroundColor: ['#FFD700', '#FFA500', '#22c55e', '#3b82f6', '#8b5cf6'][
                  Math.floor(Math.random() * 5)
                ],
                width: `${Math.random() * 10 + 5}px`,
                height: `${Math.random() * 10 + 5}px`,
                borderRadius: Math.random() > 0.5 ? '50%' : '0',
              }}
            />
          ))}
        </div>
      )}

      {/* Success Message Toast */}
      {successMessage && (
        <div className="fixed top-4 right-4 z-50 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg flex items-center gap-2 animate-fade-in">
          <CheckCircle2 className="h-5 w-5" />
          {successMessage}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Receipt className="h-7 w-7 text-indigo-600" />
            My Sales
          </h1>
          <p className="text-gray-500">Track your deals and commissions</p>
        </div>
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700">
              <Plus className="h-4 w-4 mr-2" />
              New Sale
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Receipt className="h-5 w-5 text-indigo-600" />
                Log New Sale
              </DialogTitle>
              <DialogDescription>
                Enter the sale details. The total deal value will count toward your Golden Ticket progress immediately.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="customerName">Customer Name</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    id="customerName"
                    placeholder="Enter customer name..."
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="totalDealValue">Total Deal Amount ($)</Label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    id="totalDealValue"
                    type="number"
                    placeholder="Full price agreed..."
                    value={totalDealValue}
                    onChange={(e) => setTotalDealValue(e.target.value)}
                    className="pl-9"
                    min="0"
                    step="0.01"
                  />
                </div>
                <p className="text-xs text-amber-600 flex items-center gap-1">
                  <Trophy className="h-3 w-3" />
                  This amount counts toward Golden Ticket immediately
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="initialPayment">Initial Payment ($) <span className="text-gray-400 text-xs">(optional)</span></Label>
                <div className="relative">
                  <CreditCard className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    id="initialPayment"
                    type="number"
                    placeholder="Amount received now..."
                    value={initialPayment}
                    onChange={(e) => setInitialPayment(e.target.value)}
                    className="pl-9"
                    min="0"
                    step="0.01"
                  />
                </div>
                <p className="text-xs text-gray-500">
                  Leave empty or 0 if no payment received yet
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleCreateSale}
                disabled={isSubmitting || !customerName.trim() || !totalDealValue || parseFloat(totalDealValue) <= 0}
                className="bg-gradient-to-r from-indigo-600 to-purple-600"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-2" />
                    Create Sale
                  </>
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-4 border shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-100 rounded-lg">
              <Receipt className="h-5 w-5 text-indigo-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total Sales</p>
              <p className="text-2xl font-bold text-gray-900">{totals.totalSales}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl p-4 border shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <DollarSign className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total Deal Value</p>
              <p className="text-2xl font-bold text-gray-900">${totals.totalDealValue.toLocaleString()}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl p-4 border shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <CreditCard className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Amount Collected</p>
              <p className="text-2xl font-bold text-gray-900">${totals.totalCollected.toLocaleString()}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl p-4 border shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 rounded-lg">
              <Trophy className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Commission Earned</p>
              <p className="text-2xl font-bold text-amber-600">${totals.totalCommissionEarned.toLocaleString()}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="flex gap-4 text-sm">
        <div className="flex items-center gap-2 bg-green-50 text-green-700 px-3 py-1.5 rounded-full">
          <CheckCircle2 className="h-4 w-4" />
          <span>{totals.completedSales} Completed</span>
        </div>
        <div className="flex items-center gap-2 bg-amber-50 text-amber-700 px-3 py-1.5 rounded-full">
          <Clock className="h-4 w-4" />
          <span>{totals.partialSales} Pending Payment</span>
        </div>
      </div>

      {/* Sales List */}
      <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
        <div className="p-4 border-b bg-gray-50">
          <h2 className="font-semibold text-gray-900">Sales History</h2>
        </div>
        
        {sales.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <Receipt className="h-12 w-12 mx-auto mb-4 text-gray-300" />
            <p>No sales yet. Create your first sale to get started!</p>
          </div>
        ) : (
          <div className="divide-y">
            {sales.map((sale) => (
              <div key={sale.id} className="p-4 hover:bg-gray-50 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-gray-900 truncate">{sale.customerName}</h3>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          sale.status === 'completed'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {sale.status === 'completed' ? 'Completed' : 'Partial'}
                      </span>
                    </div>
                    
                    <div className="flex items-center gap-4 text-sm text-gray-500 mb-3">
                      <span className="flex items-center gap-1">
                        <DollarSign className="h-3 w-3" />
                        Deal: ${sale.totalDealValue.toLocaleString()}
                      </span>
                      <span className="flex items-center gap-1">
                        <CreditCard className="h-3 w-3" />
                        Collected: ${sale.amountCollected.toLocaleString()}
                      </span>
                      {sale.commissionAmount > 0 && (
                        <span className="flex items-center gap-1 text-amber-600">
                          <Trophy className="h-3 w-3" />
                          Commission: ${sale.commissionAmount.toLocaleString()}
                        </span>
                      )}
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          sale.progress >= 100 ? 'bg-green-500' : 'bg-indigo-500'
                        }`}
                        style={{ width: `${Math.min(sale.progress, 100)}%` }}
                      />
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      {sale.progress}% paid • ${(sale.totalDealValue - sale.amountCollected).toLocaleString()} remaining
                    </p>
                  </div>

                  {/* Action Button */}
                  <div className="flex-shrink-0">
                    {sale.status === 'partial' ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openPaymentDialog(sale)}
                        className="border-indigo-200 text-indigo-600 hover:bg-indigo-50"
                      >
                        <Plus className="h-4 w-4 mr-1" />
                        Add Payment
                      </Button>
                    ) : (
                      <div className="flex items-center gap-1 text-green-600 text-sm">
                        <CheckCircle2 className="h-4 w-4" />
                        Paid
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Payment Dialog */}
      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-indigo-600" />
              Add Payment
            </DialogTitle>
            <DialogDescription>
              {selectedSale && (
                <>
                  Recording payment for <strong>{selectedSale.customerName}</strong>.
                  <br />
                  Remaining: <strong>${(selectedSale.totalDealValue - selectedSale.amountCollected).toLocaleString()}</strong>
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="paymentAmount">Payment Amount ($)</Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  id="paymentAmount"
                  type="number"
                  placeholder="Enter amount received..."
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  className="pl-9"
                  min="0"
                  step="0.01"
                />
              </div>
              {selectedSale && parseFloat(paymentAmount) >= (selectedSale.totalDealValue - selectedSale.amountCollected) && (
                <p className="text-xs text-green-600 flex items-center gap-1">
                  <Trophy className="h-3 w-3" />
                  This will complete the sale! 5% commission (${(selectedSale.totalDealValue * 0.05).toFixed(2)}) will be added to your earnings.
                </p>
              )}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPaymentDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAddPayment}
              disabled={isSubmitting || !paymentAmount || parseFloat(paymentAmount) <= 0}
              className="bg-gradient-to-r from-indigo-600 to-purple-600"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Payment
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* CSS for animations */}
      <style jsx global>{`
        @keyframes confetti {
          0% {
            transform: translateY(-100vh) rotate(0deg);
            opacity: 1;
          }
          100% {
            transform: translateY(100vh) rotate(720deg);
            opacity: 0;
          }
        }
        .animate-confetti {
          animation: confetti 3s ease-in-out forwards;
        }
        @keyframes fade-in {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-fade-in {
          animation: fade-in 0.3s ease-out;
        }
      `}</style>
    </div>
  );
}
