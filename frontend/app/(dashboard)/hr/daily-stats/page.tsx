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
import { DAILY_TARGETS } from '@/lib/salary-utils';
import {
  Calendar,
  RefreshCw,
  Phone,
  Clock,
  Users,
  TrendingUp,
  ChevronLeft,
  ChevronRight,
  Zap,
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
  talkTimeSeconds: number;
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
    hour12: false,
  });

  const dateStr = dateFormatter.format(now); // Returns YYYY-MM-DD
  const hour = parseInt(hourFormatter.format(now), 10);

  // If it's before 6 AM, we're still in yesterday's shift
  if (hour < 6) {
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    date.setDate(date.getDate() - 1);
    return date.toISOString().split('T')[0];
  }

  return dateStr;
}

/**
 * Check if current time is past 10 PM (for alert highlighting)
 */
function isPast10PM(): boolean {
  const now = new Date();
  const hourFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Karachi',
    hour: 'numeric',
    hour12: false,
  });
  const hour = parseInt(hourFormatter.format(now), 10);
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
  const [selectedDate, setSelectedDate] = useState(getDefaultWorkingDate());
  const [apiDate, setApiDate] = useState<string | null>(null);
  const [data, setData] = useState<AgentDailyStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

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

  // Get targets based on employment type
  const getAgentTargets = (employmentType: string) => {
    return employmentType === 'part_time' ? DAILY_TARGETS.part_time : DAILY_TARGETS.full_time;
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
        </div>
      </div>

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
              <TableHead>Talk Time</TableHead>
              <TableHead>Leads</TableHead>
              <TableHead>Sales</TableHead>
              <TableHead className="text-right">Est. Earnings</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && data.length === 0 ? (
              <TableRow>
                <td colSpan={7} className="px-4 py-12 text-center">
                  <RefreshCw className="h-6 w-6 animate-spin mx-auto text-gray-400" />
                  <p className="text-gray-500 mt-2">Loading...</p>
                </td>
              </TableRow>
            ) : data.length === 0 ? (
              <TableRow>
                <td colSpan={7} className="px-4 py-12 text-center">
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

                    {/* Talk Time */}
                    <TableCell>
                      <div>
                        <div className="font-medium text-gray-900">
                          {formatDurationHuman(agent.talkTimeSeconds)}
                          <span className="text-gray-400 font-normal"> / {talkTimeTargetMinutes}m</span>
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
                      <div>
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
                      </div>
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
                <TableCell>
                  <div className="text-gray-900">
                    {formatDurationHuman(data.reduce((sum, a) => sum + a.talkTimeSeconds, 0))}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="text-green-700">
                      ✓ {data.reduce((sum, a) => sum + a.leadsApproved, 0)}
                    </span>
                    <span className="text-yellow-700">
                      ⏳ {data.reduce((sum, a) => sum + a.leadsPending, 0)}
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
