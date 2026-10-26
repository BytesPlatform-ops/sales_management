import { NextRequest, NextResponse } from 'next/server';
import { requireHR, errorResponse, auditLog } from '@/lib/hr-auth';
import { buildMonthlyReports } from '@/lib/payroll-report-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/hr/payroll-reports?month=YYYY-MM
// Returns cumulative month-end summary for every included call agent.
export async function GET(request: NextRequest) {
  try {
    const actor = await requireHR(request);
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month') || '';

    const bundle = await buildMonthlyReports(month);
    auditLog('payroll_report_list', actor, { month: bundle.month, agents: bundle.reports.length });

    // Summary cards
    const totalPotential = bundle.reports.reduce((s, r) => s + r.potentialSalary, 0);
    const totalFinal = bundle.reports.reduce((s, r) => s + r.finalPayableSalary, 0);
    const totalReductions = bundle.reports.reduce((s, r) => s + r.totalSalaryDifference, 0);
    const totalIssueDays = bundle.reports.reduce((s, r) => s + r.issueDayCount, 0);
    const agentsWithMissingData = bundle.reports.filter((r) => r.hasMissingData).length;

    return NextResponse.json({
      status: 'success',
      data: {
        month: bundle.month,
        monthName: bundle.monthName,
        workingDays: bundle.workingDays,
        generatedAt: bundle.generatedAt,
        summary: {
          totalAgents: bundle.reports.length,
          totalPotentialPayroll: Math.round(totalPotential),
          totalReductions: Math.round(totalReductions),
          totalFinalPayable: Math.round(totalFinal),
          totalIssueDays,
          agentsWithMissingData,
        },
        agents: bundle.reports.map((r) => ({
          agentId: r.agentId,
          employeeCode: r.employeeCode,
          name: r.name,
          employmentType: r.employmentType,
          isActive: r.isActive,
          baseSalary: r.baseSalary,
          workingDays: r.workingDaysInMonth,
          daysOnTime: r.daysOnTime,
          daysLate: r.daysLate,
          excessLateCount: r.excessLateCount,
          daysHalfDay: r.daysHalfDay,
          daysAbsent: r.daysAbsent,
          approvedLeaveDays: r.daysApprovedLeave,
          totalCalls: r.totalCalls,
          totalTalkTimeSeconds: r.totalTalkTimeSeconds,
          totalLeads: r.totalLeads,
          avgPerformancePct: r.avgPerformancePct,
          potentialSalary: r.potentialSalary,
          performanceAttendanceReduction: Math.round((r.dailyPerformanceImpact + r.dailyAttendanceImpact) * 100) / 100,
          monthEndDeductions: r.excessLateDeduction,
          finalPayableSalary: r.finalPayableSalary,
          totalSalaryDifference: r.totalSalaryDifference,
          issueDayCount: r.issueDayCount,
          hasMissingData: r.hasMissingData,
        })),
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
