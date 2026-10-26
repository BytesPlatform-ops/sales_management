import { NextRequest, NextResponse } from 'next/server';
import { requireHR, errorResponse, auditLog, HttpError } from '@/lib/hr-auth';
import { buildMonthlyReports } from '@/lib/payroll-report-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/hr/payroll-reports/:agentId?month=YYYY-MM
// Full detailed report DTO for one agent (same DTO the PDF renders).
export async function GET(request: NextRequest, { params }: { params: { agentId: string } }) {
  try {
    const actor = await requireHR(request);
    const agentId = Number(params.agentId);
    if (!Number.isInteger(agentId) || agentId <= 0) {
      throw new HttpError(400, 'Invalid agent id');
    }
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month') || '';

    const bundle = await buildMonthlyReports(month, { agentId });
    const report = bundle.reports[0];
    if (!report) {
      throw new HttpError(404, 'Agent not found or no payroll data for this month');
    }
    auditLog('payroll_report_view', actor, { month: bundle.month, agentId });

    return NextResponse.json({ status: 'success', data: report });
  } catch (err) {
    return errorResponse(err);
  }
}
