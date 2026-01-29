'use client';

import { useState, useCallback } from 'react';
import useSWR from 'swr';
import { CircularProgressbar, buildStyles } from 'react-circular-progressbar';
import 'react-circular-progressbar/dist/styles.css';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { CheckInButton } from '@/components/attendance/check-in-button';
import { formatCurrency, getGreeting } from '@/lib/utils';
import { Phone, Clock, Target, Plus, TrendingUp, Sparkles, Loader2, DollarSign, Trophy, X, Hand, BarChart3, Calendar, CheckCircle2, User, CreditCard, Receipt } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Fetcher for SWR - uses token from localStorage
const fetcher = async (url: string) => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  
  const res = await fetch(url, {
    headers: token ? { 'Authorization': `Bearer ${token}` } : {},
  });
  
  if (!res.ok) {
    throw new Error('Failed to fetch');
  }
  
  const json = await res.json();
  return json.data;
};

export default function AgentDashboard() {
  const { user } = useAuth();
  const [isAddingLead, setIsAddingLead] = useState(false);
  const [leadDialogOpen, setLeadDialogOpen] = useState(false);
  const [leadSuccess, setLeadSuccess] = useState(false);
  const [isAddingSale, setIsAddingSale] = useState(false);
  const [saleDialogOpen, setSaleDialogOpen] = useState(false);
  const [saleSuccess, setSaleSuccess] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  
  // Lead form fields
  const [leadCustomerName, setLeadCustomerName] = useState('');
  const [leadCustomerEmail, setLeadCustomerEmail] = useState('');
  
  // New sale form fields
  const [customerName, setCustomerName] = useState('');
  const [totalDealValue, setTotalDealValue] = useState('');
  const [initialPayment, setInitialPayment] = useState('');

  // SWR for auto-refresh every 5 seconds
  const { data, error, isLoading, mutate } = useSWR(
    '/api/agent/stats',
    fetcher,
    {
      refreshInterval: 5000, // Auto-refresh every 5 seconds
      revalidateOnFocus: true,
      dedupingInterval: 2000,
    }
  );

  // Add lead handler - now submits for verification
  const handleAddLead = useCallback(async () => {
    if (!leadCustomerName.trim() || !leadCustomerEmail.trim()) {
      return;
    }

    setIsAddingLead(true);
    setLeadSuccess(false);
    
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
      const response = await fetch('/api/agent/leads', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          customerName: leadCustomerName.trim(),
          customerEmail: leadCustomerEmail.trim(),
        }),
      });
      
      if (response.ok) {
        setLeadSuccess(true);
        setLeadDialogOpen(false);
        setLeadCustomerName('');
        setLeadCustomerEmail('');
        // Note: We don't mutate() here because lead count won't change until HR approves
        // Clear success message after 3 seconds
        setTimeout(() => setLeadSuccess(false), 3000);
      } else {
        const error = await response.json();
        console.error('Failed to submit lead:', error.message);
      }
    } catch (error) {
      console.error('Failed to submit lead:', error);
    } finally {
      setIsAddingLead(false);
    }
  }, [leadCustomerName, leadCustomerEmail]);

  // Add sale handler - now uses detailed sale logging
  const handleAddSale = useCallback(async () => {
    const total = parseFloat(totalDealValue);
    const initial = parseFloat(initialPayment) || 0;

    if (!customerName.trim() || isNaN(total) || total <= 0) {
      return;
    }

    setIsAddingSale(true);
    setSaleSuccess(false);
    
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
      const response = await fetch('/api/agent/sales', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          customerName: customerName.trim(),
          totalDealValue: total,
          initialPayment: initial,
        }),
      });
      
      if (response.ok) {
        const result = await response.json();
        setSaleSuccess(true);
        setSaleDialogOpen(false);
        setCustomerName('');
        setTotalDealValue('');
        setInitialPayment('');
        // Refresh data immediately
        mutate();
        
        // Check if target was hit or sale completed with commission
        if (result.data?.sale?.status === 'completed' || result.data?.commissionEarned > 0) {
          setShowConfetti(true);
          setTimeout(() => setShowConfetti(false), 5000);
        }
        
        // Clear success message after 3 seconds
        setTimeout(() => setSaleSuccess(false), 3000);
      }
    } catch (error) {
      console.error('Failed to log sale:', error);
    } finally {
      setIsAddingSale(false);
    }
  }, [customerName, totalDealValue, initialPayment, mutate]);

  // Loading state
  if (isLoading || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-indigo-600 mx-auto mb-4" />
          <p className="text-gray-500">Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center text-red-600">
          <p>Failed to load dashboard</p>
          <Button onClick={() => mutate()} className="mt-4">
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const todayStats = data.today || { calls: 0, talkTime: 0, leads: 0, salesAmount: 0, salesTarget: 0, targetHit: false, performanceScore: 0 };
  const earnedToday = data.salary?.todayEarnings || 0;
  
  // Calculate percentages for gauges (capped at 100%)
  const callsPercent = Math.min((todayStats.calls / 250) * 100, 100);
  const talkTimePercent = Math.min((todayStats.talkTime / 3600) * 100, 100);
  const leadsPercent = Math.min((todayStats.leads / 3) * 100, 100);
  
  // Sales target percentage (only if target is set)
  const salesTarget = todayStats.salesTarget || 0;
  const salesAmount = todayStats.salesAmount || 0;
  const salesPercent = salesTarget > 0 ? Math.min((salesAmount / salesTarget) * 100, 100) : 0;
  const targetHit = todayStats.targetHit || (salesTarget > 0 && salesAmount >= salesTarget);

  // Format talk time for display
  const formatTalkTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    if (mins >= 60) {
      const hours = Math.floor(mins / 60);
      const remainingMins = mins % 60;
      return `${hours}h ${remainingMins}m`;
    }
    return `${mins}m`;
  };

  return (
    <div className="space-y-8 pb-10">
      {/* Confetti Effect for Golden Ticket */}
      {showConfetti && (
        <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
          {[...Array(50)].map((_, i) => (
            <div
              key={i}
              className="absolute animate-confetti"
              style={{
                left: `${Math.random() * 100}%`,
                animationDelay: `${Math.random() * 2}s`,
                backgroundColor: ['#FFD700', '#FFA500', '#FFB347', '#FFDF00', '#F4C430'][Math.floor(Math.random() * 5)],
                width: `${Math.random() * 10 + 5}px`,
                height: `${Math.random() * 10 + 5}px`,
                borderRadius: Math.random() > 0.5 ? '50%' : '0',
              }}
            />
          ))}
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {getGreeting()}, {user?.full_name?.split(' ')[0]}! <Hand className="inline h-6 w-6 text-yellow-500" />
          </h1>
          <p className="text-gray-500 flex items-center gap-2">
            <span className="inline-block w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
            Live updates every 5 seconds
          </p>
        </div>
        <div className="text-sm text-gray-500">
          {data.today?.date && new Date(data.today.date).toLocaleDateString('en-PK', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          })}
        </div>
      </div>

      {/* Hero Section - Earnings Card (3/4) + Attendance Card (1/4) */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Hero Card - Live Earned Today (75% width on desktop) */}
        <div className="md:col-span-3 relative overflow-hidden bg-gradient-to-br from-indigo-600 via-indigo-700 to-purple-800 rounded-3xl p-8 text-white shadow-2xl">
          {/* Animated background */}
          <div className="absolute inset-0 opacity-20">
            <div className="absolute top-0 -left-4 w-72 h-72 bg-purple-300 rounded-full mix-blend-multiply filter blur-xl animate-blob"></div>
            <div className="absolute top-0 -right-4 w-72 h-72 bg-indigo-300 rounded-full mix-blend-multiply filter blur-xl animate-blob animation-delay-2000"></div>
            <div className="absolute -bottom-8 left-20 w-72 h-72 bg-pink-300 rounded-full mix-blend-multiply filter blur-xl animate-blob animation-delay-4000"></div>
          </div>
          
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="h-5 w-5 text-yellow-300" />
              <span className="text-indigo-200 text-sm font-medium uppercase tracking-wider">
                Current Shift Earnings
              </span>
            </div>
            
            <div className="flex items-baseline gap-2 mb-4">
              <span className="text-5xl md:text-6xl font-black tracking-tight">
                PKR {Math.round(earnedToday).toLocaleString()}
              </span>
              <span className="text-xl text-indigo-200">.{String(Math.round((earnedToday % 1) * 100)).padStart(2, '0')}</span>
            </div>
            
            <div className="flex flex-wrap gap-3 text-sm">
              <div className="flex items-center gap-2 bg-white/10 rounded-full px-3 py-1.5">
                <Clock className="h-4 w-4" />
                <span>Shift: {data.today?.shiftStart?.slice(0, 5)} - {data.today?.shiftEnd?.slice(0, 5)}</span>
              </div>
              <div className="flex items-center gap-2 bg-white/10 rounded-full px-3 py-1.5">
                <TrendingUp className="h-4 w-4" />
                <span>Performance: {todayStats.performanceScore}%</span>
              </div>
              <div className="flex items-center gap-2 bg-white/10 rounded-full px-3 py-1.5">
                <span>Daily Potential: {formatCurrency(data.salary?.dailyPotential || 0)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Attendance Check-In/Check-Out (25% width on desktop) */}
        <div className="md:col-span-1">
          <CheckInButton
            attendance={{
              check_in_time: data.attendance?.check_in_time || null,
              check_out_time: data.attendance?.check_out_time || null,
              status: data.attendance?.todayStatus || 'absent',
            }}
            onUpdate={() => mutate()}
          />
        </div>
      </div>

      {/* Performance Gauges - Current Shift Stats */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2"><BarChart3 className="h-5 w-5 text-indigo-500" /> Current Shift Performance</h2>
          <p className="text-sm text-gray-500">
            Stats since: <span className="font-medium text-indigo-600">{data.today?.shiftStartFormatted || data.metrics?.stats_since || 'N/A'}</span>
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Calls Gauge */}
          <div className="bg-white rounded-2xl p-6 border shadow-sm hover:shadow-lg transition-shadow">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <Phone className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">Calls</h3>
                  <p className="text-sm text-gray-500">Target: 250</p>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-center">
              <div className="w-32 h-32">
                <CircularProgressbar
                  value={callsPercent}
                  text={`${todayStats.calls}`}
                  styles={buildStyles({
                    textSize: '24px',
                    textColor: '#1f2937',
                    pathColor: callsPercent >= 100 ? '#22c55e' : '#3b82f6',
                    trailColor: '#e5e7eb',
                    pathTransitionDuration: 0.5,
                  })}
                />
              </div>
            </div>
            <p className="text-center text-sm text-gray-500 mt-4">
              {todayStats.calls} / 250 ({Math.round(callsPercent)}%)
            </p>
          </div>

        {/* Talk Time Gauge */}
        <div className="bg-white rounded-2xl p-6 border shadow-sm hover:shadow-lg transition-shadow">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <Clock className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">Talk Time</h3>
                <p className="text-sm text-gray-500">Target: 1 hour</p>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-center">
            <div className="w-32 h-32">
              <CircularProgressbar
                value={talkTimePercent}
                text={formatTalkTime(todayStats.talkTime)}
                styles={buildStyles({
                  textSize: '18px',
                  textColor: '#1f2937',
                  pathColor: talkTimePercent >= 100 ? '#22c55e' : '#10b981',
                  trailColor: '#e5e7eb',
                  pathTransitionDuration: 0.5,
                })}
              />
            </div>
          </div>
          <p className="text-center text-sm text-gray-500 mt-4">
            {formatTalkTime(todayStats.talkTime)} / 1hr ({Math.round(talkTimePercent)}%)
          </p>
        </div>

        {/* Leads Gauge */}
        <div className="bg-white rounded-2xl p-6 border shadow-sm hover:shadow-lg transition-shadow">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-100 rounded-lg">
                <Target className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">Leads</h3>
                <p className="text-sm text-gray-500">Target: 3</p>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-center">
            <div className="w-32 h-32">
              <CircularProgressbar
                value={leadsPercent}
                text={`${todayStats.leads}`}
                styles={buildStyles({
                  textSize: '24px',
                  textColor: '#1f2937',
                  pathColor: leadsPercent >= 100 ? '#22c55e' : '#f59e0b',
                  trailColor: '#e5e7eb',
                  pathTransitionDuration: 0.5,
                })}
              />
            </div>
          </div>
          <p className="text-center text-sm text-gray-500 mt-4">
            {todayStats.leads} / 3 ({Math.round(leadsPercent)}%)
          </p>
        </div>

        {/* Sales Revenue Gauge - Golden Ticket */}
        <div className={`relative bg-white rounded-2xl p-6 border shadow-sm hover:shadow-lg transition-all ${
          targetHit 
            ? 'ring-2 ring-yellow-400 shadow-[0_0_30px_rgba(234,179,8,0.4)] animate-glow' 
            : ''
        }`}>
          {/* Golden Ticket Badge */}
          {targetHit && (
            <div className="absolute -top-2 -right-2 bg-gradient-to-r from-yellow-400 to-amber-500 text-white text-xs font-bold px-2 py-1 rounded-full flex items-center gap-1 shadow-lg">
              <Trophy className="h-3 w-3" />
              <span>GOLDEN TICKET!</span>
            </div>
          )}
          
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${targetHit ? 'bg-yellow-100' : 'bg-yellow-50'}`}>
                <DollarSign className={`h-5 w-5 ${targetHit ? 'text-yellow-600' : 'text-yellow-500'}`} />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">Sales Revenue</h3>
                <p className="text-sm text-gray-500">
                  Target: ${salesTarget > 0 ? salesTarget.toLocaleString() : 'Not Set'}
                </p>
              </div>
            </div>
          </div>
          
          <div className="flex items-center justify-center">
            <div className="w-32 h-32">
              <CircularProgressbar
                value={salesTarget > 0 ? salesPercent : 0}
                text={`$${salesAmount.toLocaleString()}`}
                styles={buildStyles({
                  textSize: '16px',
                  textColor: targetHit ? '#ca8a04' : '#1f2937',
                  pathColor: targetHit ? '#eab308' : '#fbbf24',
                  trailColor: '#fef3c7',
                  pathTransitionDuration: 0.5,
                })}
              />
            </div>
          </div>
          
          <div className="mt-4 space-y-2">
            <p className="text-center text-sm text-gray-500">
              {salesTarget > 0 
                ? `$${salesAmount.toLocaleString()} / $${salesTarget.toLocaleString()} (${Math.round(salesPercent)}%)`
                : `$${salesAmount.toLocaleString()} earned`
              }
            </p>
            
            {/* Add Sale Button */}
            <Dialog open={saleDialogOpen} onOpenChange={setSaleDialogOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={`w-full ${targetHit 
                    ? 'border-yellow-400 text-yellow-700 hover:bg-yellow-50' 
                    : 'border-yellow-200 text-yellow-600 hover:bg-yellow-50'
                  }`}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Log Sale
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Receipt className="h-5 w-5 text-yellow-500" />
                    Log New Sale
                  </DialogTitle>
                  <DialogDescription>
                    Enter the sale details. The total deal value counts toward your Golden Ticket immediately.
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
                      5% commission when fully paid. Current target: ${salesTarget > 0 ? salesTarget.toLocaleString() : 'Not set'}
                    </p>
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setSaleDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleAddSale}
                    disabled={isAddingSale || !customerName.trim() || !totalDealValue || parseFloat(totalDealValue) <= 0}
                    className="bg-gradient-to-r from-yellow-500 to-amber-500 hover:from-yellow-600 hover:to-amber-600 text-white"
                  >
                    {isAddingSale ? (
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
            
            {saleSuccess && (
              <p className="text-center text-xs text-green-600 font-medium animate-fade-in">
                <CheckCircle2 className="inline h-4 w-4 mr-1" /> Sale logged successfully!
              </p>
            )}
          </div>
        </div>
        </div>
      </div>

      {/* Add Lead Section */}
      <div className="bg-white rounded-2xl p-6 border shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Target className="h-5 w-5 text-amber-500" />
              Submit Lead for Verification
            </h3>
            <p className="text-gray-500 text-sm mt-1">
              Submit a qualified lead - HR will verify before it counts toward your stats
            </p>
          </div>
          <div className="flex items-center gap-4">
            {leadSuccess && (
              <span className="text-green-600 text-sm font-medium animate-fade-in">
                <CheckCircle2 className="inline h-4 w-4 mr-1" /> Lead submitted for verification!
              </span>
            )}
            <Dialog open={leadDialogOpen} onOpenChange={setLeadDialogOpen}>
              <DialogTrigger asChild>
                <Button
                  className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white shadow-lg hover:shadow-xl transition-all"
                  size="lg"
                >
                  <Plus className="h-5 w-5 mr-2" />
                  Submit Lead
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Target className="h-5 w-5 text-amber-500" />
                    Submit Lead for Verification
                  </DialogTitle>
                  <DialogDescription>
                    Enter customer details. HR will verify before it counts toward your earnings.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="leadCustomerName" className="flex items-center gap-2">
                      <User className="h-4 w-4 text-gray-500" />
                      Customer Name
                    </Label>
                    <Input
                      id="leadCustomerName"
                      placeholder="Enter customer name"
                      value={leadCustomerName}
                      onChange={(e) => setLeadCustomerName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="leadCustomerEmail" className="flex items-center gap-2">
                      <span className="text-gray-500">@</span>
                      Customer Email
                    </Label>
                    <Input
                      id="leadCustomerEmail"
                      type="email"
                      placeholder="customer@example.com"
                      value={leadCustomerEmail}
                      onChange={(e) => setLeadCustomerEmail(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setLeadDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleAddLead}
                    disabled={isAddingLead || !leadCustomerName.trim() || !leadCustomerEmail.trim()}
                    className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600"
                  >
                    {isAddingLead ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Submitting...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-4 w-4 mr-2" />
                        Submit Lead
                      </>
                    )}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-4 border shadow-sm">
          <p className="text-sm text-gray-500 mb-1">Total Earned This Month</p>
          <p className="text-2xl font-bold text-gray-900">{formatCurrency(data.salary?.totalEarned || 0)}</p>
        </div>
        <div className="bg-white rounded-xl p-4 border shadow-sm">
          <p className="text-sm text-gray-500 mb-1">Projected Salary</p>
          <p className="text-2xl font-bold text-indigo-600">{formatCurrency(data.salary?.projectedSalary || 0)}</p>
        </div>
        <div className="bg-white rounded-xl p-4 border shadow-sm">
          <p className="text-sm text-gray-500 mb-1">Days Completed</p>
          <p className="text-2xl font-bold text-gray-900">
            {data.month?.workingDaysElapsed || 0} / {data.month?.workingDays || 22}
          </p>
        </div>
        <div className="bg-white rounded-xl p-4 border shadow-sm">
          <p className="text-sm text-gray-500 mb-1">Avg Performance</p>
          <p className="text-2xl font-bold text-green-600">{data.performance?.avgPerformanceScore || 0}%</p>
        </div>
      </div>

      {/* Attendance & Monthly Performance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Attendance Summary */}
        <div className="bg-white rounded-2xl p-6 border shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            <Calendar className="inline h-5 w-5 mr-2 text-indigo-500" />Attendance This Month
          </h3>
          <div className="grid grid-cols-4 gap-3">
            <div className="text-center p-3 bg-green-50 rounded-xl">
              <p className="text-2xl font-bold text-green-600">
                {data.attendance?.breakdown?.onTime?.days || 0}
              </p>
              <p className="text-xs text-gray-500">On Time</p>
            </div>
            <div className="text-center p-3 bg-yellow-50 rounded-xl">
              <p className="text-2xl font-bold text-yellow-600">
                {data.attendance?.breakdown?.late?.days || 0}
              </p>
              <p className="text-xs text-gray-500">Late</p>
            </div>
            <div className="text-center p-3 bg-orange-50 rounded-xl">
              <p className="text-2xl font-bold text-orange-600">
                {data.attendance?.breakdown?.halfDay?.days || 0}
              </p>
              <p className="text-xs text-gray-500">Half Day</p>
            </div>
            <div className="text-center p-3 bg-red-50 rounded-xl">
              <p className="text-2xl font-bold text-red-600">
                {data.attendance?.breakdown?.absent?.days || 0}
              </p>
              <p className="text-xs text-gray-500">Absent</p>
            </div>
          </div>
        </div>

        {/* Monthly Performance Summary */}
        <div className="bg-white rounded-2xl p-6 border shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            <BarChart3 className="inline h-5 w-5 mr-2 text-indigo-500" />Monthly Performance
          </h3>
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center p-3 bg-blue-50 rounded-xl">
              <p className="text-2xl font-bold text-blue-600">
                {data.performance?.totalCalls || 0}
              </p>
              <p className="text-xs text-gray-500">Total Calls</p>
            </div>
            <div className="text-center p-3 bg-green-50 rounded-xl">
              <p className="text-2xl font-bold text-green-600">
                {data.performance?.totalTalkTimeFormatted || '0m'}
              </p>
              <p className="text-xs text-gray-500">Talk Time</p>
            </div>
            <div className="text-center p-3 bg-amber-50 rounded-xl">
              <p className="text-2xl font-bold text-amber-600">
                {data.performance?.totalLeads || 0}
              </p>
              <p className="text-xs text-gray-500">Total Leads</p>
            </div>
          </div>
        </div>
      </div>

      {/* CSS for animations */}
      <style jsx global>{`
        @keyframes blob {
          0%, 100% { transform: translate(0, 0) scale(1); }
          25% { transform: translate(20px, -50px) scale(1.1); }
          50% { transform: translate(-20px, 20px) scale(0.9); }
          75% { transform: translate(-40px, -20px) scale(1.05); }
        }
        .animate-blob {
          animation: blob 7s infinite;
        }
        .animation-delay-2000 {
          animation-delay: 2s;
        }
        .animation-delay-4000 {
          animation-delay: 4s;
        }
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in {
          animation: fade-in 0.3s ease-out;
        }
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
        @keyframes glow {
          0%, 100% {
            box-shadow: 0 0 20px rgba(234, 179, 8, 0.4);
          }
          50% {
            box-shadow: 0 0 40px rgba(234, 179, 8, 0.6);
          }
        }
        .animate-glow {
          animation: glow 2s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
