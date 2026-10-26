import { NextRequest } from 'next/server';
import JSZip from 'jszip';
import { requireHR, errorResponse, auditLog, HttpError } from '@/lib/hr-auth';
import { buildMonthlyReports, sanitizeFilename } from '@/lib/payroll-report-service';
import { buildIndividualPdf } from '@/lib/payroll-report-pdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/hr/payroll-reports/zip?month=YYYY-MM
// ZIP containing one individual PDF per agent.
export async function GET(request: NextRequest) {
  try {
    const actor = await requireHR(request);
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month') || '';

    const bundle = await buildMonthlyReports(month);
    if (bundle.reports.length === 0) throw new HttpError(404, 'No agents with payroll data for this month');

    const zip = new JSZip();
    for (const report of bundle.reports) {
      const pdf = await buildIndividualPdf(report);
      const filename = `salary-performance-${sanitizeFilename(report.employeeCode)}-${sanitizeFilename(report.name)}-${report.month}.pdf`;
      zip.file(filename, pdf);
    }
    const content = await zip.generateAsync({ type: 'arraybuffer' });
    auditLog('payroll_zip', actor, { month: bundle.month, files: bundle.reports.length });

    const filename = `call-agent-salary-reports-${bundle.month}.zip`;
    return new Response(content, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
