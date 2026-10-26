'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { RefreshCw, Download, Printer, ArrowLeft, AlertTriangle } from 'lucide-react';

const pkr = (n: number) =>
  'Rs ' + (Math.round((n + Number.EPSILON) * 100) / 100).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const mins = (s: number) => {
  const m = Math.floor(s / 60); const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
};

export default function AgentReportPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const agentId = Number(params.agentId);
  const month = searchParams.get('month') || new Date().toISOString().slice(0, 7);
  const shouldPrint = searchParams.get('print') === '1';

  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await api.getPayrollReport(agentId, month);
      setReport((res as any).data);
    } catch (e: any) {
      setError(e.message || 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }, [agentId, month]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (shouldPrint && report && !loading) {
      const t = setTimeout(() => window.print(), 500);
      return () => clearTimeout(t);
    }
  }, [shouldPrint, report, loading]);

  const downloadPdf = async () => {
    setDownloading(true);
    try {
      await api.downloadPayrollFile(
        api.payrollPdfUrl(agentId, month),
        `salary-performance-${report.employeeCode}-${report.name}-${month}.pdf`.replace(/\s+/g, '-')
      );
    } catch (e: any) {
      alert(e.message || 'Download failed');
    } finally {
      setDownloading(false);
    }
  };

  if (loading) return <div className="py-20 text-center text-gray-400"><RefreshCw className="h-6 w-6 animate-spin mx-auto" /><div className="mt-2">Loading report…</div></div>;
  if (error) return <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4">{error} <Link href="/hr/payroll-reports" className="underline ml-2">Back</Link></div>;
  if (!report) return null;
  const r = report;

  return (
    <div className="space-y-5 max-w-6xl mx-auto">
      {/* Toolbar (hidden when printing) */}
      <div className="flex items-center justify-between print:hidden">
        <Link href={`/hr/payroll-reports?month=${month}`} className="inline-flex items-center gap-1 text-gray-600 hover:text-blue-600 text-sm">
          <ArrowLeft className="h-4 w-4" /> All agents
        </Link>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</Button>
          <Button onClick={downloadPdf} disabled={downloading}>
            {downloading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download PDF
          </Button>
        </div>
      </div>

      {/* Report card */}
      <div className="bg-white rounded-xl border shadow-sm p-6 space-y-5">
        <div className="flex items-start justify-between border-b pb-4">
          <div>
            <div className="text-xs text-gray-400 font-semibold uppercase">Monthly Call Agent Salary &amp; Performance Report</div>
            <h1 className="text-2xl font-bold text-gray-900">{r.name}</h1>
            <div className="text-sm text-gray-500">
              ID {r.employeeCode} · {r.employmentType === 'part_time' ? 'Part-time' : 'Full-time'} · {r.isActive ? 'Active' : 'Inactive'}
              {r.joiningDate && <> · Joined {r.joiningDate}</>}
            </div>
          </div>
          <div className="text-right text-sm">
            <div className="font-semibold text-gray-900">{r.monthName}</div>
            <div className="text-xs text-gray-400">Ref {r.referenceId}</div>
            <div className="text-xs text-gray-400">Generated {new Date(r.generatedAt).toLocaleString('en-GB', { timeZone: 'Asia/Karachi' })} PKT</div>
          </div>
        </div>

        {r.hasMissingData && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 text-sm flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div>{r.warnings?.join(' ') || 'Some scheduled working days are missing attendance or statistics data.'}</div>
          </div>
        )}

        {/* Three-column summary */}
        <div className="grid md:grid-cols-3 gap-4">
          <Panel title="Employee & Targets">
            <KV k="Base Salary" v={pkr(r.baseSalary)} />
            <KV k="Working Days" v={String(r.workingDaysInMonth)} />
            <KV k="Days Considered" v={String(r.processedDays)} />
            <KV k="Daily Potential" v={pkr(r.dailyPotential)} />
            <div className="pt-2 mt-1 border-t text-xs text-gray-500">
              Targets: <b>{r.targets.calls}</b> calls · <b>{mins(r.targets.talkTimeSeconds)}</b> talk · {r.targets.leads} leads (display)
              <div className="text-gray-400">Source: {r.targetSource === 'hr_configured' ? 'HR-configured' : 'System default'}</div>
            </div>
          </Panel>

          <Panel title="Performance & Attendance">
            <KV k="Total Calls" v={r.totalCalls.toLocaleString()} />
            <KV k="Total Talk Time" v={mins(r.totalTalkTimeSeconds)} />
            <KV k="Total Leads" v={`${r.totalLeads} (no salary effect)`} muted />
            <KV k="Avg Daily Performance" v={`${r.avgPerformancePct}%`} />
            <KV k="Full / Reduced days" v={`${r.fullPerformanceDays} / ${r.reducedPerformanceDays}`} />
            <div className="pt-2 mt-1 border-t" />
            <KV k="On-time" v={String(r.daysOnTime)} />
            <KV k="Late (free / excess)" v={`${r.freeLateCount} / ${r.excessLateCount}`} />
            <KV k="Half / Absent" v={`${r.daysHalfDay} / ${r.daysAbsent}`} />
            <KV k="Missing attend / stats" v={`${r.missingAttendanceDays} / ${r.missingStatsDays}`} />
          </Panel>

          <Panel title="Salary Reconciliation">
            <KV k="Potential Salary" v={pkr(r.potentialSalary)} />
            <KV k="Performance + Attendance" v={pkr(r.performanceAdjustedEarnings)} />
            <KV k="Perf. shortfall impact" v={`−${pkr(r.dailyPerformanceImpact)}`} neg indent />
            <KV k="Attendance impact" v={`−${pkr(r.dailyAttendanceImpact)}`} neg indent />
            <KV k="Excess-late deduction" v={`−${pkr(r.excessLateDeduction)}`} neg />
            <KV k="Manual additions" v={pkr(r.manualAdditions)} />
            <KV k="Manual deductions" v={`−${pkr(r.manualDeductions)}`} neg />
            <div className="pt-2 mt-1 border-t flex items-center justify-between">
              <span className="font-bold text-gray-900">Final Payable</span>
              <span className="font-bold text-green-700 text-lg">{pkr(r.finalPayableSalary)}</span>
            </div>
            <KV k="Total Salary Difference" v={`−${pkr(r.totalSalaryDifference)}`} neg />
            <div className="text-[11px] text-gray-400 pt-1">
              Half-day policy (info, already applied daily): {pkr(r.halfDayPolicyAmountInfo)}
            </div>
          </Panel>
        </div>

        <div className="text-xs text-gray-500 bg-gray-50 border rounded-lg p-3">
          Leads and sales are displayed for performance visibility only. They are <b>not</b> salary
          deduction components in the official payroll calculation.
        </div>

        {/* Issue days */}
        <div>
          <h3 className="font-semibold text-gray-900 mb-2">Salary-Impacting Issue Days ({r.issueDayCount})</h3>
          {r.issueDayCount === 0 ? (
            <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg p-4 text-sm">
              No salary-impacting issues were recorded during this payroll month.
            </div>
          ) : (
            <div className="overflow-x-auto border rounded-lg">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 text-left text-gray-500">
                    <th className="px-2 py-2">Date</th>
                    <th className="px-2 py-2">Attendance</th>
                    <th className="px-2 py-2 text-right">Calls</th>
                    <th className="px-2 py-2 text-right">Talk</th>
                    <th className="px-2 py-2 text-right">Leads</th>
                    <th className="px-2 py-2 text-right">Perf</th>
                    <th className="px-2 py-2 text-right">Att×</th>
                    <th className="px-2 py-2 text-right">Potential</th>
                    <th className="px-2 py-2 text-right">Earned</th>
                    <th className="px-2 py-2 text-right">Impact</th>
                    <th className="px-2 py-2">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {r.issueDays.map((d: any) => (
                    <tr key={d.date} className="hover:bg-gray-50">
                      <td className="px-2 py-1.5 whitespace-nowrap">{d.date.slice(5)}</td>
                      <td className="px-2 py-1.5">{d.attendanceLabel}</td>
                      <td className="px-2 py-1.5 text-right">{d.calls}/{d.callsTarget}</td>
                      <td className="px-2 py-1.5 text-right">{mins(d.talkTimeSeconds)}/{mins(d.talkTimeTargetSeconds)}</td>
                      <td className="px-2 py-1.5 text-right text-gray-400">{d.leads}/{d.leadsTarget}</td>
                      <td className="px-2 py-1.5 text-right">{d.performancePct}%</td>
                      <td className="px-2 py-1.5 text-right">{d.attendanceFactor.toFixed(1)}</td>
                      <td className="px-2 py-1.5 text-right">{pkr(d.dailyPotential)}</td>
                      <td className="px-2 py-1.5 text-right">{pkr(d.earned)}</td>
                      <td className={`px-2 py-1.5 text-right ${d.salaryImpact > 0 ? 'text-red-600' : ''}`}>{pkr(d.salaryImpact)}</td>
                      <td className="px-2 py-1.5 text-gray-600">{d.reasons.join('; ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-50 border rounded-lg p-4">
      <div className="text-xs font-semibold text-gray-500 uppercase mb-2">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function KV({ k, v, neg, muted, indent }: { k: string; v: string; neg?: boolean; muted?: boolean; indent?: boolean }) {
  return (
    <div className={`flex items-center justify-between text-sm ${indent ? 'pl-3' : ''}`}>
      <span className={muted || indent ? 'text-gray-400' : 'text-gray-600'}>{k}</span>
      <span className={`font-medium ${neg ? 'text-red-600' : muted ? 'text-gray-400' : 'text-gray-900'}`}>{v}</span>
    </div>
  );
}
