import { NextRequest } from 'next/server';
import { requireHR, errorResponse, auditLog, HttpError } from '@/lib/hr-auth';
import { buildMonthlyReports } from '@/lib/payroll-report-service';
import { buildCombinedPdf } from '@/lib/payroll-report-pdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/hr/payroll-reports/pdf/all?month=YYYY-MM
// One combined PDF, exactly one page per included agent.
export async function GET(request: NextRequest) {
  try {
    const actor = await requireHR(request);
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month') || '';

    const bundle = await buildMonthlyReports(month);
    if (bundle.reports.length === 0) throw new HttpError(404, 'No agents with payroll data for this month');

    const pdf = await buildCombinedPdf(bundle.reports);
    auditLog('payroll_pdf_combined', actor, { month: bundle.month, pages: bundle.reports.length });

    const filename = `all-call-agent-salary-reports-${bundle.month}.pdf`;
    return new Response(Buffer.from(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
