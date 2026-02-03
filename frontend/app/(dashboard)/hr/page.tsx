'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api-client';
import { StatsCard } from '@/components/dashboard/stats-card';
import { Leaderboard } from '@/components/dashboard/leaderboard';
import { PendingLeadsFeed } from '@/components/dashboard/pending-leads-feed';
import { PendingSalesFeed } from '@/components/dashboard/pending-sales-feed';
import { PendingPaymentsFeed } from '@/components/dashboard/pending-payments-feed';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDuration, getGreeting } from '@/lib/utils';
import { Users, Phone, Clock, AlertCircle, RefreshCw, Plus, X, CheckCircle } from 'lucide-react';
import Link from 'next/link';

interface HRDashboardData {
  agents: any[];
  todayStats: any[];
  pendingApprovals: any[];
}

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error';
}

/**
 * Get the current working date considering shift time (9 PM start)
 */
function getDefaultWorkingDate(): string {
  const now = new Date();

  // Get current date in Asia/Karachi timezone using reliable formatting
  const dateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const hourFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Karachi',
    hour: 'numeric',
    hour12: false,
  });

  const dateStr = dateFormatter.format(now); // Returns YYYY-MM-DD
  const hour = parseInt(hourFormatter.format(now), 10);

  // If it's before 6 AM, we're still in yesterday's shift
  if (hour < 6) {
    const [year, month, day] = dateStr.split('-').map(Number);
    // Create date and subtract one day, then format WITHOUT using toISOString (which converts to UTC)
    const tempDate = new Date(year, month - 1, day - 1);
    return `${tempDate.getFullYear()}-${String(tempDate.getMonth() + 1).padStart(2, '0')}-${String(tempDate.getDate()).padStart(2, '0')}`;
  }

  return dateStr;
}

export default function HRDashboard() {
  const { user } = useAuth();
  const [data, setData] = useState<HRDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [meetingPopover, setMeetingPopover] = useState<{
    isOpen: boolean;
    agentId: number | null;
    agentName: string;
    durationMinutes: string;
    loading: boolean;
  }>({
    isOpen: false,
    agentId: null,
    agentName: '',
    durationMinutes: '',
    loading: false,
  });

  // Toast notification helper
  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    // Auto-remove after 4 seconds
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  const removeToast = (id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const fetchData = async () => {
    try {
      setLoading(true);
      const [agentsRes, pendingRes] = await Promise.all([
        api.getAgents(),
        api.getPendingApprovals(),
      ]);

      console.log('Agents response:', agentsRes);
      console.log('Pending response:', pendingRes);

      setData({
        agents: agentsRes.data || [],
        todayStats: [],
        pendingApprovals: pendingRes.data || [],
      });
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Open meeting popover
  const openMeetingPopover = (agentId: number, agentName: string) => {
    setMeetingPopover({
      isOpen: true,
      agentId,
      agentName,
      durationMinutes: '',
      loading: false,
    });
  };

  // Close meeting popover
  const closeMeetingPopover = () => {
    setMeetingPopover({
      isOpen: false,
      agentId: null,
      agentName: '',
      durationMinutes: '',
      loading: false,
    });
  };

  // Submit meeting time
  const submitMeetingTime = async () => {
    if (!meetingPopover.agentId || !meetingPopover.durationMinutes) return;

    setMeetingPopover((prev) => ({ ...prev, loading: true }));

    try {
      const durationMinutes = parseFloat(meetingPopover.durationMinutes);
      if (durationMinutes <= 0) {
        showToast('Duration must be greater than 0', 'error');
        setMeetingPopover((prev) => ({ ...prev, loading: false }));
        return;
      }

      // Always use today's date for meeting time
      const todayDate = getDefaultWorkingDate();

      const response = await api.addMeetingTime(
        meetingPopover.agentId,
        todayDate,
        durationMinutes,
        '' // No reason for quick entry
      );

      if (response?.status === 'success') {
        // Show success toast
        showToast(`${durationMinutes} mins added to ${meetingPopover.agentName}'s shift`, 'success');
        // Refresh data to show updated talk time
        await fetchData();
        closeMeetingPopover();
      } else {
        const errorMsg = response?.message || 'Failed to add meeting time';
        showToast(errorMsg, 'error');
      }
    } catch (error: any) {
      console.error('Error adding meeting time:', error);
      const errorMessage = error?.message || 'Error adding meeting time';
      showToast(errorMessage, 'error');
    } finally {
      setMeetingPopover((prev) => ({ ...prev, loading: false }));
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 bg-gray-200 rounded w-1/3 animate-pulse"></div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-32 bg-gray-200 rounded-xl animate-pulse"></div>
          ))}
        </div>
      </div>
    );
  }

  const totalAgents = data?.agents.length || 0;
  const pendingCount = data?.pendingApprovals.length || 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {getGreeting()}, {user?.full_name?.split(' ')[0]}! 👋
          </h1>
          <p className="text-gray-500">HR Management Dashboard</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchData}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Link href="/hr/agents">
            <Button>
              <Users className="h-4 w-4 mr-2" />
              Manage Agents
            </Button>
          </Link>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Total Agents"
          value={totalAgents}
          icon={Users}
          variant="primary"
        />
        <StatsCard
          title="Active Today"
          value={data?.agents.filter((a) => a.is_active).length || 0}
          icon={Phone}
          variant="success"
        />
        <StatsCard
          title="Pending Approvals"
          value={pendingCount}
          icon={AlertCircle}
          variant={pendingCount > 0 ? 'warning' : 'default'}
        />
        
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Pending Items */}
        <div className="lg:col-span-2 space-y-4">
          <PendingLeadsFeed />
          <PendingSalesFeed />
          <PendingPaymentsFeed />
        </div>

        {/* Right Column - Leaderboard */}
        <div>
          <Leaderboard type="daily" />
        </div>
      </div>

      {/* Pending Attendance Approvals */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="bg-white rounded-xl p-6 border shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">
                ⏳ Pending Attendance Approvals
              </h3>
              <Link href="/hr/attendance">
                <Button variant="outline" size="sm">
                  View All
                </Button>
              </Link>
            </div>

            {pendingCount === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <AlertCircle className="h-12 w-12 mx-auto mb-2 text-gray-300" />
                <p>No pending approvals</p>
              </div>
            ) : (
              <div className="space-y-2">
                {data?.pendingApprovals.slice(0, 5).map((item: any) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between p-3 bg-yellow-50 rounded-lg"
                  >
                    <div>
                      <p className="font-medium text-gray-900">
                        {item.full_name}
                      </p>
                      <p className="text-sm text-gray-500">
                        {item.date} - {item.status}
                      </p>
                    </div>
                    <Button size="sm">Approve</Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Agents List */}
      <div className="bg-white rounded-xl p-6 border shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">
            👥 Active Agents - Quick Meeting Entry
          </h3>
          <Link href="/hr/agents">
            <Button variant="outline" size="sm">View All</Button>
          </Link>
        </div>
        
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead>Extension</TableHead>
                <TableHead>Talk Time</TableHead>
                <TableHead className="text-right">Add Meeting</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.agents.slice(0, 10).map((agent: any) => (
                <TableRow key={agent.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-indigo-100 flex items-center justify-center">
                        <span className="text-indigo-600 font-bold text-sm">
                          {agent.full_name.charAt(0)}
                        </span>
                      </div>
                      <span className="font-medium text-gray-900">{agent.full_name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-gray-500">
                    {agent.extension_number}
                  </TableCell>
                  <TableCell>
                    <span className="font-medium text-gray-900">
                      {agent.talk_time_today ? `${Math.floor(agent.talk_time_today / 60)}m` : '0m'}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <button
                      onClick={() => openMeetingPopover(agent.id, agent.full_name)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-lg transition-colors text-sm font-medium"
                      title="Add meeting time"
                    >
                      <Plus className="h-4 w-4" />
                      Add
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        
        {totalAgents > 10 && (
          <div className="text-center mt-4">
            <Link href="/hr/agents">
              <Button variant="outline">View All {totalAgents} Agents</Button>
            </Link>
          </div>
        )}
      </div>

      {/* Quick Meeting Entry Popover/Dialog */}
      {meetingPopover.isOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full animate-in fade-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="border-b p-4 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-900">
                  Add Meeting Time
                </h3>
                <p className="text-sm text-gray-500">
                  {meetingPopover.agentName}
                </p>
              </div>
              <button
                onClick={closeMeetingPopover}
                className="text-gray-400 hover:text-gray-600 p-1 hover:bg-gray-100 rounded"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Meeting Duration (Minutes)
              </label>
              <input
                type="number"
                min="1"
                step="1"
                value={meetingPopover.durationMinutes}
                onChange={(e) =>
                  setMeetingPopover((prev) => ({
                    ...prev,
                    durationMinutes: e.target.value,
                  }))
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && meetingPopover.durationMinutes) {
                    submitMeetingTime();
                  }
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-lg"
                placeholder="e.g., 30"
                autoFocus
              />
            </div>

            {/* Footer */}
            <div className="border-t p-4 flex justify-end gap-2 bg-gray-50 rounded-b-xl">
              <Button
                variant="outline"
                size="sm"
                onClick={closeMeetingPopover}
                disabled={meetingPopover.loading}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={submitMeetingTime}
                disabled={!meetingPopover.durationMinutes || meetingPopover.loading}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {meetingPopover.loading ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin mr-1" />
                    Adding...
                  </>
                ) : (
                  <>
                    <Clock className="h-4 w-4 mr-1" />
                    Add Time
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notifications */}
      <div className="fixed bottom-4 right-4 z-50 space-y-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg animate-in slide-in-from-right duration-300 ${
              toast.type === 'success'
                ? 'bg-green-600 text-white'
                : 'bg-red-600 text-white'
            }`}
          >
            {toast.type === 'success' ? (
              <CheckCircle className="h-5 w-5 flex-shrink-0" />
            ) : (
              <AlertCircle className="h-5 w-5 flex-shrink-0" />
            )}
            <span className="text-sm font-medium">{toast.message}</span>
            <button
              onClick={() => removeToast(toast.id)}
              className="ml-2 p-1 hover:bg-white/20 rounded"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
