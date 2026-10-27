import { NextRequest } from 'next/server';
import { requireHR, errorResponse, auditLog, HttpError } from '@/lib/hr-auth';
import { buildMonthlyReports, sanitizeFilename } from '@/lib/payroll-report-service';
import { buildIndividualPdf } from '@/lib/payroll-report-pdf';
import { logIfCeo } from '@/lib/auth/ceo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/hr/payroll-reports/:agentId/pdf?month=YYYY-MM
export async function GET(request: NextRequest, { params }: { params: { agentId: string } }) {
  try {
    const actor = await requireHR(request);
    const agentId = Number(params.agentId);
    await logIfCeo(request, 'payroll_person', `payroll PDF for user #${agentId}`);
    if (!Number.isInteger(agentId) || agentId <= 0) throw new HttpError(400, 'Invalid agent id');
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month') || '';

    const bundle = await buildMonthlyReports(month, { agentId });
    const report = bundle.reports[0];
    if (!report) throw new HttpError(404, 'Agent not found or no payroll data for this month');

    const pdf = await buildIndividualPdf(report);
    auditLog('payroll_pdf_individual', actor, { month: bundle.month, agentId });

    const filename = `salary-performance-${sanitizeFilename(report.employeeCode)}-${sanitizeFilename(report.name)}-${report.month}.pdf`;
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
