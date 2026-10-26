'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDurationHuman } from '@/lib/date-utils';
import { DAILY_TARGETS, DailyTargets } from '@/lib/salary-utils';
import {
  Calendar,
  RefreshCw,
  Phone,
  Clock,
  Users,
  TrendingUp,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Zap,
  Plus,
  BarChart3,
} from 'lucide-react';

interface AgentDailyStats {
  id: number;
  fullName: string;
  extensionNumber: string;
  shiftStart: string;
  shiftEnd: string;
  employmentType: string;
  baseSalary: number;
  dailyPotential: number;
  salesTarget: number;
  checkInTime: string | null;
  checkOutTime: string | null;
  attendanceStatus: 'on_time' | 'late' | 'half_day' | 'absent' | null;
  hrApproved: boolean;
  callsCount: number;
  callTalkTimeSeconds: number;  // From call_logs only (phone calls)
  meetingSeconds: number;        // HR-added meeting time (Zoom/Google Meet)
  talkTimeSeconds: number;       // Total = callTalkTimeSeconds + meetingSeconds
  leadsApproved: number;
  leadsPending: number;
  salesAmount: number;
  estimatedEarnings: number;
  targetHit: boolean;
}

interface DailyStatsResponse {
  data: AgentDailyStats[];
  date: string;
  workingDaysInMonth: number;
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
    hourCycle: 'h23',
  });

  const dateStr = dateFormatter.format(now); // Returns YYYY-MM-DD
  const hour = parseInt(hourFormatter.format(now), 10) % 24;

  // If it's before 6 AM, we're still in yesterday's shift
  if (hour < 6) {
    const [year, month, day] = dateStr.split('-').map(Number);
    // Create date and subtract one day, then format WITHOUT using toISOString (which converts to UTC)
    const tempDate = new Date(year, month - 1, day - 1);
    return `${tempDate.getFullYear()}-${String(tempDate.getMonth() + 1).padStart(2, '0')}-${String(tempDate.getDate()).padStart(2, '0')}`;
  }

  return dateStr;
}

/**
 * Date the page opens on. Between 6 AM and the 9 PM shift start HR is reviewing
 * last night, and today's shift has no data yet, so open on the previous shift.
 * (The picker still allows today.)
 */
function getDefaultReviewDate(): string {
  const working = getDefaultWorkingDate();
  const hour = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Karachi', hour: 'numeric', hourCycle: 'h23' }).format(new Date()), 10) % 24;
  if (hour < 6 || hour >= 21) return working;
  const [year, month, day] = working.split('-').map(Number);
  const prev = new Date(year, month - 1, day - 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-${String(prev.getDate()).padStart(2, '0')}`;
}

/**
 * Check if current time is past 10 PM (for alert highlighting)
 */
function isPast10PM(): boolean {
  const now = new Date();
  const hourFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Karachi',
    hour: 'numeric',
    hourCycle: 'h23',
  });
  const hour = parseInt(hourFormatter.format(now), 10) % 24;
  return hour >= 22;
}

/**
 * Format time from ISO string to readable format
 */
function formatTime(isoString: string | null): string {
  if (!isoString) return '-';
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Karachi',
  });
}

/**
 * Get attendance badge color based on status
 */
function getAttendanceBadge(status: string | null): {
  color: string;
  bg: string;
  text: string;
} {
  switch (status) {
    case 'on_time':
      return { color: 'text-green-700', bg: 'bg-green-100', text: 'On Time' };
    case 'late':
      return { color: 'text-yellow-700', bg: 'bg-yellow-100', text: 'Late' };
    case 'half_day':
      return { color: 'text-orange-700', bg: 'bg-orange-100', text: 'Half Day' };
    case 'absent':
      return { color: 'text-red-700', bg: 'bg-red-100', text: 'Absent' };
    default:
      return { color: 'text-gray-700', bg: 'bg-gray-100', text: 'Not Checked In' };
  }
}

/**
 * Progress bar component
 */
function ProgressBar({
  value,
  max,
  color = 'bg-blue-500',
}: {
  value: number;
  max: number;
  color?: string;
}) {
  const percentage = Math.min((value / max) * 100, 100);
  return (
    <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden mt-1">
      <div
        className={`h-full ${color} transition-all duration-300`}
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}

export default function HRDailyStatsPage() {
  const { user } = useAuth();
  const [selectedDate, setSelectedDate] = useState(getDefaultReviewDate());
  const [apiDate, setApiDate] = useState<string | null>(null);
  const [data, setData] = useState<AgentDailyStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [targets, setTargets] = useState<{ full_time: DailyTargets; part_time: DailyTargets }>(DAILY_TARGETS);
  
  // Modal state for leads
  const [leadsModal, setLeadsModal] = useState<{
    isOpen: boolean;
    agentId: number | null;
    agentName: string;
    leads: any[];
    loading: boolean;
  }>({
    isOpen: false,
    agentId: null,
    agentName: '',
    leads: [],
    loading: false,
  });

  // Calls Per Hour panel state (real hourly breakdown from call_logs)
  interface HourAgent {
    agentId: number;
    agentName: string;
    extension: string;
    callCount: number;
    talkTimeSeconds: number;
  }
  interface HourBucket {
    hour: number;
    label: string;
    totalCalls: number;
    totalTalkTimeSeconds: number;
    agents: HourAgent[];
  }
  const [callsPanelOpen, setCallsPanelOpen] = useState(false);
  const [cphHours, setCphHours] = useState<HourBucket[]>([]);
  const [cphLoading, setCphLoading] = useState(false);
  const [cphGeneratedAt, setCphGeneratedAt] = useState<Date | null>(null);
  const [expandedHour, setExpandedHour] = useState<number | null>(null);

  const fetchCallsPerHour = useCallback(async () => {
    try {
      setCphLoading(true);
      const response = await api.getCallsPerHour(selectedDate);
      const hours = ((response as any).hours || []) as HourBucket[];
      setCphHours(hours);
      setCphGeneratedAt(new Date());
    } catch (error) {
      console.error('Failed to fetch calls per hour:', error);
      setCphHours([]);
    } finally {
      setCphLoading(false);
    }
  }, [selectedDate]);

  // Toggle the panel; fetch fresh data whenever it is opened.
  const toggleCallsPanel = () => {
    const next = !callsPanelOpen;
    setCallsPanelOpen(next);
    if (next) fetchCallsPerHour();
  };

  // Re-fetch when the date changes while the panel is open.
  useEffect(() => {
    if (callsPanelOpen) fetchCallsPerHour();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  // Auto-refresh the hourly breakdown every hour while the panel is open
  // (call_logs is fed by the 3CX cron, so hourly re-pulls pick up new calls).
  useEffect(() => {
    if (!callsPanelOpen) return;
    const interval = setInterval(fetchCallsPerHour, 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, [callsPanelOpen, fetchCallsPerHour]);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const response = await api.getDailyStats(selectedDate);
      console.log('API Response:', response);
      if (response.data) {
        setData(response.data);
      }
      // Track what date the API returned
      if ((response as any).date) {
        setApiDate((response as any).date);
      }
      // HR-configured targets returned by the API
      if ((response as any).targets) {
        setTargets((response as any).targets);
      }
      setLastRefresh(new Date());
    } catch (error) {
      console.error('Failed to fetch daily stats:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

  // Initial fetch and date change
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh every 10 seconds if enabled
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      fetchData();
    }, 10000);

    return () => clearInterval(interval);
  }, [autoRefresh, fetchData]);

  // Navigate to previous day
  const goToPreviousDay = () => {
    const date = new Date(selectedDate);
    date.setDate(date.getDate() - 1);
    setSelectedDate(date.toISOString().split('T')[0]);
  };

  // Navigate to next day
  const goToNextDay = () => {
    const date = new Date(selectedDate);
    date.setDate(date.getDate() + 1);
    const today = getDefaultWorkingDate();
    if (date.toISOString().split('T')[0] <= today) {
      setSelectedDate(date.toISOString().split('T')[0]);
    }
  };

  // Format currency
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-PK', {
      style: 'currency',
      currency: 'PKR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  // Open leads modal and fetch approved leads for the agent
  const openLeadsModal = async (agentId: number, agentName: string) => {
    setLeadsModal({
      isOpen: true,
      agentId,
      agentName,
      leads: [],
      loading: true,
    });

    try {
      const response = await api.getAgentLeads(agentId, selectedDate);
      const leadsArray = Array.isArray(response) ? response : (response as any).data || [];
      setLeadsModal((prev) => ({
        ...prev,
        leads: leadsArray,
        loading: false,
      }));
    } catch (error) {
      console.error('Failed to fetch agent leads:', error);
      setLeadsModal((prev) => ({
        ...prev,
        leads: [],
        loading: false,
      }));
    }
  };

  // Close leads modal
  const closeLeadsModal = () => {
    setLeadsModal({
      isOpen: false,
      agentId: null,
      agentName: '',
      leads: [],
      loading: false,
    });
  };

  // Format sales amount in USD
  const formatUSD = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  // Check if row should be highlighted as alert (0 calls past 10 PM)
  const shouldHighlightAlert = (agent: AgentDailyStats): boolean => {
    return isPast10PM() && agent.callsCount === 0 && selectedDate === getDefaultWorkingDate();
  };

  // Get targets based on employment type (HR-configured, fetched with daily stats)
  const getAgentTargets = (employmentType: string) => {
    return employmentType === 'part_time' ? targets.part_time : targets.full_time;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-blue-600" />
            Daily Performance Monitor
          </h1>
          <p className="text-gray-500">
            Live floor view for HR - Track agent performance in real-time
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-white rounded-xl border shadow-sm p-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          {/* Date Picker */}
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={goToPreviousDay}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 rounded-lg border">
              <Calendar className="h-4 w-4 text-gray-500" />
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                max={getDefaultWorkingDate()}
                className="bg-transparent border-none outline-none text-sm font-medium"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={goToNextDay}
              disabled={selectedDate >= getDefaultWorkingDate()}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            {selectedDate !== getDefaultWorkingDate() && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedDate(getDefaultWorkingDate())}
              >
                Today
              </Button>
            )}
          </div>

          {/* Calls Per Hour toggle */}
          <Button
            variant={callsPanelOpen ? 'primary' : 'outline'}
            size="sm"
            onClick={toggleCallsPanel}
            className="gap-2"
          >
            <BarChart3 className="h-4 w-4" />
            Calls / Hour
            <ChevronDown
              className={`h-4 w-4 transition-transform ${callsPanelOpen ? 'rotate-180' : ''}`}
            />
          </Button>
        </div>
      </div>

      {/* Calls Per Hour Panel */}
      {callsPanelOpen && (
        <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-blue-600" />
              <h3 className="text-sm font-semibold text-gray-900">
                Calls Per Hour
              </h3>
              <span className="text-xs text-gray-400">
                {cphHours.reduce((s, h) => s + h.totalCalls, 0).toLocaleString()} calls
              </span>
            </div>
            <div className="flex items-center gap-3">
              {cphGeneratedAt && (
                <span className="text-xs text-gray-400">
                  Updated {formatTime(cphGeneratedAt.toISOString())}
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={fetchCallsPerHour}
                disabled={cphLoading}
                className="gap-1.5 h-7"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${cphLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
          </div>

          {cphLoading && cphHours.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <RefreshCw className="h-6 w-6 animate-spin mx-auto text-gray-400" />
              <p className="text-gray-500 mt-2 text-sm">Loading hourly breakdown…</p>
            </div>
          ) : cphHours.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <Phone className="h-10 w-10 mx-auto text-gray-300" />
              <p className="text-gray-500 mt-2 text-sm">No calls recorded for this date</p>
            </div>
          ) : (
            <div className="divide-y">
              {cphHours.map((bucket) => {
                const isOpen = expandedHour === bucket.hour;
                const maxCalls = Math.max(...cphHours.map((h) => h.totalCalls), 1);
                return (
                  <div key={bucket.hour}>
                    {/* Hour row (the "clock") */}
                    <button
                      onClick={() =>
                        setExpandedHour(isOpen ? null : bucket.hour)
                      }
                      className="w-full flex items-center gap-4 px-4 py-3 hover:bg-gray-50 transition-colors text-left"
                    >
                      <ChevronRight
                        className={`h-4 w-4 text-gray-400 flex-shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                      />
                      <div className="w-16 font-semibold text-gray-900 text-sm flex-shrink-0">
                        {bucket.label}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500 rounded-full transition-all"
                            style={{ width: `${(bucket.totalCalls / maxCalls) * 100}%` }}
                          />
                        </div>
                      </div>
                      <div className="w-24 text-right flex-shrink-0">
                        <span className="font-semibold text-gray-900 text-sm">
                          {bucket.totalCalls.toLocaleString()}
                        </span>
                        <span className="text-gray-400 text-xs"> calls</span>
                      </div>
                    </button>

                    {/* Per-agent breakdown for the hour */}
                    {isOpen && (
                      <div className="bg-gray-50 px-4 pb-3">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-xs text-gray-500">
                              <th className="text-left font-medium py-2 pl-10">Agent</th>
                              <th className="text-left font-medium py-2">Ext.</th>
                              <th className="text-right font-medium py-2">Talk Time</th>
                              <th className="text-right font-medium py-2 pr-2">Calls</th>
                            </tr>
                          </thead>
                          <tbody>
                            {bucket.agents.map((agent) => (
                              <tr
                                key={agent.agentId}
                                className="border-t border-gray-200"
                              >
                                <td className="py-2 pl-10 text-gray-900 font-medium">
                                  {agent.agentName}
                                </td>
                                <td className="py-2 text-gray-500">
                                  {agent.extension}
                                </td>
                                <td className="py-2 text-right text-gray-600">
                                  {formatDurationHuman(agent.talkTimeSeconds)}
                                </td>
                                <td className="py-2 pr-2 text-right font-semibold text-gray-900">
                                  {agent.callCount.toLocaleString()}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Stats Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border shadow-sm p-4">
          <div className="flex items-center gap-2 text-gray-500 text-sm">
            <Users className="h-4 w-4" />
            Total Agents
          </div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{data.length}</div>
        </div>
        <div className="bg-white rounded-xl border shadow-sm p-4">
          <div className="flex items-center gap-2 text-gray-500 text-sm">
            <Clock className="h-4 w-4" />
            Checked In
          </div>
          <div className="text-2xl font-bold text-green-600 mt-1">
            {data.filter((a) => a.attendanceStatus).length}
          </div>
        </div>
        <div className="bg-white rounded-xl border shadow-sm p-4">
          <div className="flex items-center gap-2 text-gray-500 text-sm">
            <Phone className="h-4 w-4" />
            Total Calls
          </div>
          <div className="text-2xl font-bold text-blue-600 mt-1">
            {data.reduce((sum, a) => sum + a.callsCount, 0).toLocaleString()}
          </div>
        </div>
        <div className="bg-white rounded-xl border shadow-sm p-4">
          <div className="flex items-center gap-2 text-gray-500 text-sm">
            <TrendingUp className="h-4 w-4" />
            Total Sales
          </div>
          <div className="text-2xl font-bold text-amber-600 mt-1">
            {formatUSD(data.reduce((sum, a) => sum + a.salesAmount, 0))}
          </div>
        </div>
      </div>

      {/* Master Table */}
      <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50">
              <TableHead>Agent</TableHead>
              <TableHead>Attendance</TableHead>
              <TableHead>Calls</TableHead>
              <TableHead>Call Time</TableHead>
              <TableHead>Meeting</TableHead>
              <TableHead>Total Talk</TableHead>
              <TableHead>Leads</TableHead>
              <TableHead>Sales</TableHead>
              <TableHead className="text-right">Est. Earnings</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && data.length === 0 ? (
              <TableRow>
                <td colSpan={9} className="px-4 py-12 text-center">
                  <RefreshCw className="h-6 w-6 animate-spin mx-auto text-gray-400" />
                  <p className="text-gray-500 mt-2">Loading...</p>
                </td>
              </TableRow>
            ) : data.length === 0 ? (
              <TableRow>
                <td colSpan={9} className="px-4 py-12 text-center">
                  <Users className="h-12 w-12 mx-auto text-gray-300" />
                  <p className="text-gray-500 mt-2">No agents found</p>
                </td>
              </TableRow>
            ) : (
              data.map((agent) => {
                const badge = getAttendanceBadge(agent.attendanceStatus);
                const isAlert = shouldHighlightAlert(agent);
                const targets = getAgentTargets(agent.employmentType);
                const talkTimeTargetMinutes = targets.talk_time_seconds / 60;

                return (
                  <TableRow
                    key={agent.id}
                    className={isAlert ? 'bg-red-50 hover:bg-red-100' : ''}
                  >
                    {/* Agent Name */}
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-semibold text-sm">
                          {agent.fullName
                            .split(' ')
                            .map((n) => n[0])
                            .join('')
                            .toUpperCase()
                            .slice(0, 2)}
                        </div>
                        <div>
                          <div className="font-medium text-gray-900">
                            {agent.fullName}
                          </div>
                          <div className="text-xs text-gray-500">
                            Ext. {agent.extensionNumber}
                            <span className="ml-1 text-gray-400">
                              ({agent.employmentType === 'part_time' ? 'PT' : 'FT'})
                            </span>
                            <span className="ml-2 text-blue-500 font-medium">
                              {formatCurrency(agent.dailyPotential)}/day
                            </span>
                          </div>
                        </div>
                      </div>
                    </TableCell>

                    {/* Attendance */}
                    <TableCell>
                      <div>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${badge.bg} ${badge.color}`}
                        >
                          {badge.text}
                        </span>
                        {agent.checkInTime && (
                          <div className="text-xs text-gray-500 mt-1">
                            {formatTime(agent.checkInTime)}
                          </div>
                        )}
                      </div>
                    </TableCell>

                    {/* Calls */}
                    <TableCell>
                      <div>
                        <div className="font-medium text-gray-900">
                          {agent.callsCount.toLocaleString()}
                          <span className="text-gray-400 font-normal">
                            {' '}
                            / {targets.calls}
                          </span>
                        </div>
                        <ProgressBar
                          value={agent.callsCount}
                          max={targets.calls}
                          color={agent.callsCount >= targets.calls ? 'bg-green-500' : 'bg-blue-500'}
                        />
                      </div>
                    </TableCell>

                    {/* Call Time (from call_logs / 3CX phone calls only) */}
                    <TableCell>
                      <div>
                        <div className="font-medium text-gray-900 text-sm">
                          {formatDurationHuman(agent.callTalkTimeSeconds || 0)}
                        </div>
                      </div>
                    </TableCell>

                    {/* Meeting Time (HR-added Zoom/Google Meet) */}
                    <TableCell>
                      <div>
                        <div className={`font-medium text-sm ${(agent.meetingSeconds || 0) > 0 ? 'text-blue-600' : 'text-gray-400'}`}>
                          {formatDurationHuman(agent.meetingSeconds || 0)}
                        </div>
                      </div>
                    </TableCell>

                    {/* Total Talk Time (calls + meeting) - used for calculations */}
                    <TableCell>
                      <div>
                        <div className="font-medium text-gray-900 text-sm">
                          <span>
                            {formatDurationHuman(agent.talkTimeSeconds)}
                            <span className="text-gray-400 font-normal"> / {talkTimeTargetMinutes}m</span>
                          </span>
                        </div>
                        <ProgressBar
                          value={agent.talkTimeSeconds}
                          max={targets.talk_time_seconds}
                          color={
                            agent.talkTimeSeconds >= targets.talk_time_seconds
                              ? 'bg-green-500'
                              : 'bg-purple-500'
                          }
                        />
                      </div>
                    </TableCell>

                    {/* Leads */}
                    <TableCell>
                      <button
                        onClick={() => openLeadsModal(agent.id, agent.fullName)}
                        className="cursor-pointer hover:bg-blue-50 p-2 rounded-lg transition-colors text-left w-full"
                        title="Click to view approved leads"
                      >
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                            ✓ {agent.leadsApproved}
                          </span>
                          {agent.leadsPending > 0 && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">
                              ⏳ {agent.leadsPending}
                            </span>
                          )}
                          <span className="text-gray-400 text-xs">/ {targets.leads}</span>
                        </div>
                      </button>
                    </TableCell>

                    {/* Sales */}
                    <TableCell>
                      <div
                        className={`font-medium ${
                          agent.targetHit
                            ? 'text-amber-600 bg-amber-50 px-2 py-1 rounded-lg inline-block'
                            : 'text-gray-900'
                        }`}
                      >
                        {agent.targetHit && '🏆 '}
                        {formatUSD(agent.salesAmount)}
                      </div>
                      {agent.salesTarget > 0 && (
                        <div className="text-xs text-gray-400 mt-0.5">
                          Target: {formatUSD(agent.salesTarget)}
                        </div>
                      )}
                    </TableCell>

                    {/* Est. Earnings */}
                    <TableCell className="text-right">
                      <div className="font-semibold text-gray-900">
                        {formatCurrency(agent.estimatedEarnings)}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
            {/* Totals Row */}
            {data.length > 0 && (
              <TableRow className="bg-gray-100 font-semibold border-t-2 border-gray-300">
                <TableCell>
                  <div className="text-gray-700">
                    Total ({data.length} agents)
                  </div>
                  <div className="text-xs text-blue-600 font-medium">
                    {formatCurrency(data.reduce((sum, a) => sum + a.dailyPotential, 0))}/day potential
                  </div>
                </TableCell>
                <TableCell>
                  <div className="text-xs text-gray-600">
                    <span className="text-green-600">{data.filter(a => a.attendanceStatus === 'on_time').length} On Time</span>
                    {' • '}
                    <span className="text-yellow-600">{data.filter(a => a.attendanceStatus === 'late').length} Late</span>
                    {' • '}
                    <span className="text-red-600">{data.filter(a => !a.attendanceStatus || a.attendanceStatus === 'absent').length} Absent</span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="text-gray-900">
                    {data.reduce((sum, a) => sum + a.callsCount, 0).toLocaleString()}
                  </div>
                </TableCell>
                {/* Call Time (from call_logs) */}
                <TableCell>
                  <div className="text-gray-900">
                    {formatDurationHuman(data.reduce((sum, a) => sum + (a.callTalkTimeSeconds || 0), 0))}
                  </div>
                </TableCell>
                {/* Meeting Time */}
                <TableCell>
                  <div className="text-blue-600">
                    🎥 {formatDurationHuman(data.reduce((sum, a) => sum + (a.meetingSeconds || 0), 0))}
                  </div>
                </TableCell>
                {/* Total Talk Time */}
                <TableCell>
                  <div className="text-gray-900">
                    {formatDurationHuman(data.reduce((sum, a) => sum + a.talkTimeSeconds, 0))}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="text-green-700">
                      ✓{data.reduce((sum, a) => sum + a.leadsApproved, 0)}
                    </span>
                    <span className="text-yellow-700">
                      ⏳{data.reduce((sum, a) => sum + a.leadsPending, 0)}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="text-amber-600">
                    {formatUSD(data.reduce((sum, a) => sum + a.salesAmount, 0))}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <div className="text-gray-900">
                    {formatCurrency(data.reduce((sum, a) => sum + a.estimatedEarnings, 0))}
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Leads Modal */}
      {leadsModal.isOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-lg max-w-2xl w-full max-h-[90vh] overflow-auto">
            {/* Modal Header */}
            <div className="sticky top-0 bg-white border-b p-6 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-gray-900">
                  Approved Leads - {leadsModal.agentName}
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  Date: {new Date(selectedDate).toLocaleDateString('en-PK', {
                    weekday: 'short',
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                </p>
              </div>
              <button
                onClick={closeLeadsModal}
                className="text-gray-400 hover:text-gray-600 text-2xl"
              >
                ×
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6">
              {leadsModal.loading ? (
                <div className="text-center py-8">
                  <RefreshCw className="h-6 w-6 animate-spin mx-auto text-gray-400" />
                  <p className="text-gray-500 mt-2">Loading leads...</p>
                </div>
              ) : leadsModal.leads.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-500">No approved leads found for this date</p>
                  <p className="text-xs text-gray-400 mt-2">
                    Agent: {leadsModal.agentId} | Date: {selectedDate}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {leadsModal.leads.map((lead, index) => (
                    <div
                      key={lead.id}
                      className="flex items-start gap-4 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                    >
                      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-green-500 text-white flex items-center justify-center text-xs font-semibold">
                        {index + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900">{lead.customerName}</p>
                        <p className="text-sm text-gray-600">{lead.customerEmail}</p>
                        <p className="text-xs text-gray-400 mt-1">
                          Created: {new Date(lead.createdAt).toLocaleTimeString('en-PK', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                      <div className="flex-shrink-0">
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                          ✓ Approved
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="border-t p-4 bg-gray-50 flex justify-end">
              <Button variant="outline" onClick={closeLeadsModal}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="bg-gray-50 rounded-xl border p-4">
        <h4 className="text-sm font-medium text-gray-700 mb-2">Legend</h4>
        <div className="flex flex-wrap gap-4 text-xs">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-green-500"></span>
            <span className="text-gray-600">On Time</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-yellow-500"></span>
            <span className="text-gray-600">Late</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-orange-500"></span>
            <span className="text-gray-600">Half Day</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-red-500"></span>
            <span className="text-gray-600">Absent</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-6 h-3 bg-red-100 rounded"></span>
            <span className="text-gray-600">Alert: 0 calls past 10 PM</span>
          </div>
          <div className="flex items-center gap-2">
            <span>🏆</span>
            <span className="text-gray-600">Sales target hit (Golden Ticket)</span>
          </div>
        </div>
      </div>
    </div>
  );
}
