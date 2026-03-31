'use client';

import { useState, useMemo } from 'react';
import useSWR from 'swr';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Trophy,
  Users,
  Calendar,
  Clock,
  Phone,
  Target,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Download,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Fetcher for SWR
const fetcher = async (url: string) => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error('Failed to fetch');
  const json = await res.json();
  return json.data;
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

// Format duration
const formatDuration = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};

export default function PayrollDashboard() {
  // Month selector state
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  // Fetch payroll data
  const { data, error, isLoading } = useSWR(
    `/api/hr/payroll?month=${selectedMonth}`,
    fetcher,
    { revalidateOnFocus: false }
  );

  // Month navigation
  const navigateMonth = (direction: 'prev' | 'next') => {
    const [year, month] = selectedMonth.split('-').map(Number);
    let newYear = year;
    let newMonth = month + (direction === 'next' ? 1 : -1);
    
    if (newMonth > 12) {
      newMonth = 1;
      newYear++;
    } else if (newMonth < 1) {
      newMonth = 12;
      newYear--;
    }
    
    setSelectedMonth(`${newYear}-${String(newMonth).padStart(2, '0')}`);
  };

  // Chart data
  const barChartData = useMemo(() => {
    if (!data?.agents) return [];
    return data.agents
      .map((agent: any) => ({
        name: agent.name.split(' ')[0], // First name only for chart
        fullName: agent.name,
        salary: agent.finalPayout,
        base: agent.baseSalary,
        performance: agent.avgPerformanceScore,
      }))
      .sort((a: any, b: any) => b.salary - a.salary);
  }, [data]);

  const lineChartData = useMemo(() => {
    if (!data?.payoutTrend) return [];
    return data.payoutTrend.map((point: any) => ({
      date: new Date(point.date).toLocaleDateString('en-US', { day: 'numeric', month: 'short' }),
      total: point.total,
    }));
  }, [data]);

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-indigo-600 mx-auto mb-4" />
          <p className="text-gray-500">Loading payroll data...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center text-red-600">
          <AlertTriangle className="h-12 w-12 mx-auto mb-4" />
          <p>Failed to load payroll data</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-10">
      {/* Header with Month Selector */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Monthly Payroll</h1>
          <p className="text-gray-500">Track agent earnings and deductions</p>
        </div>
        
        {/* Month Navigator */}
        <div className="flex items-center gap-2 bg-white rounded-xl border px-2 py-1 shadow-sm">
          <button
            onClick={() => navigateMonth('prev')}
            className="p-2 hover:bg-gray-100 rounded-lg transition"
          >
            <ChevronLeft className="h-5 w-5 text-gray-600" />
          </button>
          
          <div className="px-4 py-2 min-w-[160px] text-center">
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="bg-transparent border-none text-center font-semibold text-gray-900 focus:outline-none cursor-pointer"
            />
          </div>
          
          <button
            onClick={() => navigateMonth('next')}
            className="p-2 hover:bg-gray-100 rounded-lg transition"
          >
            <ChevronRight className="h-5 w-5 text-gray-600" />
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Total Payout */}
        <div className="bg-gradient-to-br from-green-500 to-emerald-600 rounded-2xl p-6 text-white shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 bg-white/20 rounded-lg">
              <DollarSign className="h-6 w-6" />
            </div>
            <span className="text-xs bg-white/20 px-2 py-1 rounded-full">
              {data?.monthName}
            </span>
          </div>
          <p className="text-green-100 text-sm mb-1">Total Payout</p>
          <p className="text-3xl font-bold">{formatCurrency(data?.summary?.totalPayout || 0)}</p>
        </div>

        {/* Top Performer */}
        <div className="bg-gradient-to-br from-amber-500 to-orange-600 rounded-2xl p-6 text-white shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 bg-white/20 rounded-lg">
              <Trophy className="h-6 w-6" />
            </div>
            <span className="text-xs bg-white/20 px-2 py-1 rounded-full">
              Top Earner
            </span>
          </div>
          <p className="text-amber-100 text-sm mb-1">Top Performer</p>
          <p className="text-xl font-bold truncate">{data?.summary?.topPerformer?.name || 'N/A'}</p>
          <p className="text-amber-100 text-sm">{formatCurrency(data?.summary?.topPerformer?.earnings || 0)}</p>
        </div>

        {/* Agent Count */}
        <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl p-6 text-white shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 bg-white/20 rounded-lg">
              <Users className="h-6 w-6" />
            </div>
            <span className="text-xs bg-white/20 px-2 py-1 rounded-full">
              Team
            </span>
          </div>
          <p className="text-indigo-100 text-sm mb-1">Active Agents</p>
          <p className="text-3xl font-bold">{data?.summary?.agentCount || 0}</p>
          <p className="text-indigo-100 text-sm">{data?.workingDays} working days</p>
        </div>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Agent Earnings Bar Chart */}
        <div className="bg-white rounded-2xl border shadow-sm p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Agent Earnings Breakdown</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barChartData} layout="vertical" margin={{ left: 20, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
                <XAxis type="number" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="name" width={60} tick={{ fontSize: 12 }} />
                <Tooltip
                  formatter={(value) => formatCurrency(Number(value))}
                  labelFormatter={(label) => {
                    const agent = barChartData.find((a: any) => a.name === label);
                    return agent?.fullName || label;
                  }}
                />
                <Bar dataKey="salary" name="Earnings" radius={[0, 4, 4, 0]}>
                  {barChartData.map((entry: any, index: number) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={entry.salary < entry.base * 0.5 ? '#ef4444' : entry.salary >= entry.base * 0.8 ? '#22c55e' : '#f59e0b'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center justify-center gap-4 mt-4 text-xs">
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded bg-green-500"></div>
              <span className="text-gray-600">≥80% of base</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded bg-amber-500"></div>
              <span className="text-gray-600">50-80% of base</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded bg-red-500"></div>
              <span className="text-gray-600">&lt;50% of base</span>
            </div>
          </div>
        </div>

        {/* Payout Trend Line Chart */}
        <div className="bg-white rounded-2xl border shadow-sm p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Cumulative Payout Trend</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={lineChartData} margin={{ left: 10, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                <Line
                  type="monotone"
                  dataKey="total"
                  name="Total Payout"
                  stroke="#6366f1"
                  strokeWidth={3}
                  dot={false}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Detailed Payroll Table */}
      <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">Detailed Payroll</h3>
          <button className="flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-700">
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Agent
                </th>
                <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Base Salary
                </th>
                <th className="px-6 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Performance
                </th>
                <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Calls
                </th>
                <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Talk Time
                </th>
                <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Final Payout
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data?.agents?.map((agent: any) => {
                const payoutPercent = (agent.finalPayout / agent.baseSalary) * 100;
                const isLowPerformer = payoutPercent < 50;
                
                return (
                  <tr
                    key={agent.id}
                    className={cn(
                      'hover:bg-gray-50 transition',
                      isLowPerformer && 'bg-red-50 hover:bg-red-100'
                    )}
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-semibold">
                          {agent.name.charAt(0)}
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">{agent.name}</p>
                          <p className="text-sm text-gray-500">@{agent.username}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span className="font-medium text-gray-900">
                        {formatCurrency(agent.baseSalary)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className="flex items-center justify-center">
                        <div className="w-16 bg-gray-200 rounded-full h-2">
                          <div
                            className={cn(
                              'h-2 rounded-full',
                              agent.avgPerformanceScore >= 80 ? 'bg-green-500' :
                              agent.avgPerformanceScore >= 50 ? 'bg-yellow-500' : 'bg-red-500'
                            )}
                            style={{ width: `${Math.min(agent.avgPerformanceScore, 100)}%` }}
                          />
                        </div>
                        <span className="ml-2 text-sm font-medium text-gray-600">
                          {agent.avgPerformanceScore}%
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span className="text-gray-900">{agent.totalCalls.toLocaleString()}</span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span className="text-gray-900">{formatDuration(agent.totalTalkTime)}</span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <span className={cn(
                          'text-lg font-bold',
                          isLowPerformer ? 'text-red-600' : 'text-green-600'
                        )}>
                          {formatCurrency(agent.finalPayout)}
                        </span>
                        {isLowPerformer && (
                          <AlertTriangle className="h-4 w-4 text-red-500" />
                        )}
                      </div>
                      <p className="text-xs text-gray-500">
                        {payoutPercent.toFixed(0)}% of base
                      </p>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            
            {/* Footer Totals */}
            <tfoot className="bg-gray-100">
              <tr>
                <td className="px-6 py-4 font-semibold text-gray-900">
                  Total ({data?.agents?.length} agents)
                </td>
                <td className="px-6 py-4 text-right font-semibold text-gray-900">
                  {formatCurrency(data?.agents?.reduce((sum: number, a: any) => sum + Number(a.baseSalary), 0) || 0)}
                </td>
                <td className="px-6 py-4"></td>
                <td className="px-6 py-4 text-right font-semibold text-gray-900">
                  {data?.agents?.reduce((sum: number, a: any) => sum + Number(a.totalCalls), 0)?.toLocaleString() || 0}
                </td>
                <td className="px-6 py-4 text-right font-semibold text-gray-900">
                  {formatDuration(data?.agents?.reduce((sum: number, a: any) => sum + Number(a.totalTalkTime), 0) || 0)}
                </td>
                <td className="px-6 py-4 text-right font-bold text-green-600 text-lg">
                  {formatCurrency(data?.summary?.totalPayout || 0)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
