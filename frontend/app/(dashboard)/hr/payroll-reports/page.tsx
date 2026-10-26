'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import {
  FileText, RefreshCw, Download, Search, AlertTriangle,
  Users, Wallet, TrendingDown, CalendarDays, Eye, Printer,
} from 'lucide-react';

interface AgentRow {
  agentId: number;
  employeeCode: string;
  name: string;
  employmentType: 'full_time' | 'part_time';
  isActive: boolean;
  baseSalary: number;
  workingDays: number;
  daysOnTime: number;
  daysLate: number;
  excessLateCount: number;
  daysHalfDay: number;
  daysAbsent: number;
  totalCalls: number;
  totalTalkTimeSeconds: number;
  totalLeads: number;
  avgPerformancePct: number;
  potentialSalary: number;
  performanceAttendanceReduction: number;
  monthEndDeductions: number;
  finalPayableSalary: number;
  totalSalaryDifference: number;
  issueDayCount: number;
  hasMissingData: boolean;
}

interface Summary {
  totalAgents: number;
  totalPotentialPayroll: number;
  totalReductions: number;
  totalFinalPayable: number;
  totalIssueDays: number;
  agentsWithMissingData: number;
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

const pkr = (n: number) =>
  'Rs ' + Math.round(n).toLocaleString('en-PK');

const mins = (s: number) => {
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
};

export default function PayrollReportsPage() {
  const [month, setMonth] = useState(currentMonth());
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [monthName, setMonthName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'full_time' | 'part_time'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getPayrollReports(month);
      const data = (res as any).data;
      setAgents(data.agents || []);
      setSummary(data.summary);
      setMonthName(data.monthName);
    } catch (e: any) {
      setError(e.message || 'Failed to load payroll reports');
      setAgents([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filtered = useMemo(() => {
    return agents.filter((a) => {
      if (typeFilter !== 'all' && a.employmentType !== typeFilter) return false;
      if (statusFilter === 'active' && !a.isActive) return false;
      if (statusFilter === 'inactive' && a.isActive) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        if (!a.name.toLowerCase().includes(q) && !String(a.employeeCode).toLowerCase().includes(q))
          return false;
      }
      return true;
    });
  }, [agents, typeFilter, statusFilter, search]);

  const downloadCombined = async () => {
    setDownloading('combined');
    try {
      await api.downloadPayrollFile(api.payrollCombinedPdfUrl(month), `all-call-agent-salary-reports-${month}.pdf`);
    } catch (e: any) {
      alert(e.message || 'Download failed');
    } finally {
      setDownloading(null);
    }
  };

  const downloadOne = async (a: AgentRow) => {
    setDownloading(`pdf-${a.agentId}`);
    try {
      await api.downloadPayrollFile(
        api.payrollPdfUrl(a.agentId, month),
        `salary-performance-${a.employeeCode}-${a.name}-${month}.pdf`.replace(/\s+/g, '-')
      );
    } catch (e: any) {
      alert(e.message || 'Download failed');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FileText className="h-6 w-6 text-blue-600" />
            Month-End Salary &amp; Performance Reports
          </h1>
          <p className="text-gray-500">
            Official payroll figures (Calls 60% + Talk 40%). Leads &amp; sales never reduce salary.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={downloadCombined} disabled={downloading !== null || filtered.length === 0}>
            {downloading === 'combined' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Combined PDF
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border shadow-sm p-4">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg border">
            <CalendarDays className="h-4 w-4 text-gray-500" />
            <input
              type="month"
              value={month}
              max={currentMonth()}
              onChange={(e) => setMonth(e.target.value)}
              className="bg-transparent outline-none text-sm font-medium"
            />
          </div>
          <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg border flex-1 min-w-[200px]">
            <Search className="h-4 w-4 text-gray-500" />
            <input
              type="text"
              placeholder="Search name or employee ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-transparent outline-none text-sm w-full"
            />
          </div>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as any)} className="px-3 py-2 bg-gray-50 rounded-lg border text-sm">
            <option value="all">All types</option>
            <option value="full_time">Full-time</option>
            <option value="part_time">Part-time</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="px-3 py-2 bg-gray-50 rounded-lg border text-sm">
            <option value="all">Active &amp; inactive</option>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
          </select>
          <Button variant="outline" onClick={fetchData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Generate
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <Card icon={<Users className="h-4 w-4" />} label="Agents" value={String(summary.totalAgents)} />
          <Card icon={<Wallet className="h-4 w-4" />} label="Potential Payroll" value={pkr(summary.totalPotentialPayroll)} />
          <Card icon={<TrendingDown className="h-4 w-4" />} label="Total Reductions" value={pkr(summary.totalReductions)} color="text-red-600" />
          <Card icon={<Wallet className="h-4 w-4" />} label="Final Payable" value={pkr(summary.totalFinalPayable)} color="text-green-600" />
          <Card icon={<CalendarDays className="h-4 w-4" />} label="Issue Days" value={String(summary.totalIssueDays)} />
          <Card icon={<AlertTriangle className="h-4 w-4" />} label="Missing Data" value={String(summary.agentsWithMissingData)} color={summary.agentsWithMissingData ? 'text-amber-600' : 'text-gray-900'} />
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm">{error}</div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
              <th className="px-3 py-3">Agent</th>
              <th className="px-3 py-3">Type</th>
              <th className="px-3 py-3 text-right">Base</th>
              <th className="px-3 py-3 text-center">Days (OT/Late/Half/Abs)</th>
              <th className="px-3 py-3 text-right">Calls</th>
              <th className="px-3 py-3 text-right">Talk</th>
              <th className="px-3 py-3 text-right">Leads</th>
              <th className="px-3 py-3 text-right">Avg Perf</th>
              <th className="px-3 py-3 text-right">Potential</th>
              <th className="px-3 py-3 text-right">Reductions</th>
              <th className="px-3 py-3 text-right">Final Payable</th>
              <th className="px-3 py-3 text-center">Issues</th>
              <th className="px-3 py-3 text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading && agents.length === 0 ? (
              <tr><td colSpan={13} className="px-4 py-12 text-center text-gray-400"><RefreshCw className="h-6 w-6 animate-spin mx-auto" /><div className="mt-2">Loading…</div></td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={13} className="px-4 py-12 text-center text-gray-400">No agents match the filters for {monthName || month}.</td></tr>
            ) : (
              filtered.map((a) => (
                <tr key={a.agentId} className="hover:bg-gray-50">
                  <td className="px-3 py-2.5">
                    <Link href={`/hr/payroll-reports/${a.agentId}?month=${month}`} className="font-medium text-gray-900 hover:text-blue-600">
                      {a.name}
                    </Link>
                    <div className="text-xs text-gray-400">
                      ID {a.employeeCode}{!a.isActive && <span className="ml-1 text-amber-600">• inactive</span>}
                      {a.hasMissingData && <span className="ml-1 text-red-500">• missing data</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-600">{a.employmentType === 'part_time' ? 'PT' : 'FT'}</td>
                  <td className="px-3 py-2.5 text-right">{pkr(a.baseSalary)}</td>
                  <td className="px-3 py-2.5 text-center text-xs">
                    <span className="text-green-600">{a.daysOnTime}</span>/
                    <span className="text-yellow-600">{a.daysLate}{a.excessLateCount > 0 ? `(+${a.excessLateCount})` : ''}</span>/
                    <span className="text-orange-600">{a.daysHalfDay}</span>/
                    <span className="text-red-600">{a.daysAbsent}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right">{a.totalCalls.toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-right">{mins(a.totalTalkTimeSeconds)}</td>
                  <td className="px-3 py-2.5 text-right text-gray-400">{a.totalLeads}</td>
                  <td className="px-3 py-2.5 text-right">{a.avgPerformancePct}%</td>
                  <td className="px-3 py-2.5 text-right">{pkr(a.potentialSalary)}</td>
                  <td className="px-3 py-2.5 text-right text-red-600">−{pkr(a.totalSalaryDifference)}</td>
                  <td className="px-3 py-2.5 text-right font-semibold text-green-700">{pkr(a.finalPayableSalary)}</td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${a.issueDayCount ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>{a.issueDayCount}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-center gap-1">
                      <Link href={`/hr/payroll-reports/${a.agentId}?month=${month}`} title="View report" className="p-1.5 rounded hover:bg-blue-50 text-gray-500 hover:text-blue-600"><Eye className="h-4 w-4" /></Link>
                      <button onClick={() => downloadOne(a)} title="Download PDF" disabled={downloading === `pdf-${a.agentId}`} className="p-1.5 rounded hover:bg-blue-50 text-gray-500 hover:text-blue-600">
                        {downloading === `pdf-${a.agentId}` ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      </button>
                      <Link href={`/hr/payroll-reports/${a.agentId}?month=${month}&print=1`} title="Print" className="p-1.5 rounded hover:bg-blue-50 text-gray-500 hover:text-blue-600"><Printer className="h-4 w-4" /></Link>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-400">
        Official payroll amounts from <code>salary-utils.ts</code>. These differ from the Daily Stats
        “estimated earnings” figure, which is an estimate only.
      </p>
    </div>
  );
}

function Card({ icon, label, value, color = 'text-gray-900' }: { icon: React.ReactNode; label: string; value: string; color?: string }) {
  return (
    <div className="bg-white rounded-xl border shadow-sm p-4">
      <div className="flex items-center gap-2 text-gray-500 text-xs">{icon}{label}</div>
      <div className={`text-lg font-bold mt-1 ${color}`}>{value}</div>
    </div>
  );
}
