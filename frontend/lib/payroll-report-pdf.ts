/**
 * Month-End Payroll Report — PDF renderer (server-side, pdf-lib).
 *
 * Pure presentation: accepts a completed AgentMonthlyReport DTO and draws it.
 * It NEVER recalculates payroll. Individual and combined PDFs share the exact
 * same one-page draw routine, so the combined file has exactly one page per
 * agent and every value matches the HR preview.
 *
 * Page: A4 landscape (842 × 595 pt). No external fonts (standard Helvetica),
 * no headless browser — safe on serverless/Render.
 */

import { PDFDocument, StandardFonts, rgb, PDFPage, PDFFont, RGB } from 'pdf-lib';
import {
  AgentMonthlyReport,
  formatPKR,
  formatMinutes,
} from './payroll-report-service';

const W = 841.89;
const H = 595.28;
const M = 28; // margin

const INK = rgb(0.12, 0.14, 0.18);
const MUTED = rgb(0.42, 0.45, 0.5);
const LINE = rgb(0.82, 0.84, 0.87);
const HEADBG = rgb(0.16, 0.22, 0.42);
const BOXBG = rgb(0.97, 0.975, 0.985);
const NEG = rgb(0.72, 0.13, 0.13);
const POS = rgb(0.11, 0.45, 0.24);
const WHITE = rgb(1, 1, 1);
const ZEBRA = rgb(0.965, 0.97, 0.977);

interface Fonts {
  reg: PDFFont;
  bold: PDFFont;
}

// Standard PDF fonts only encode WinAnsi (Latin-1). Map common Unicode
// punctuation to ASCII and drop anything else so rendering never throws on
// unexpected DB data (names, symbols, etc.).
function safe(s: string): string {
  return (s ?? '')
    .replace(/[−–—]/g, '-') // minus / en-dash / em-dash
    .replace(/[…]/g, '...') // ellipsis
    .replace(/[‘’]/g, "'") // curly single quotes
    .replace(/[“”]/g, '"') // curly double quotes
    .replace(/[•]/g, '*') // bullet
    .replace(/[^\x00-\xFF]/g, ''); // drop remaining non-Latin1
}

// y is measured from the TOP of the page for readability.
function text(
  page: PDFPage,
  s: string,
  x: number,
  yTop: number,
  size: number,
  font: PDFFont,
  color: RGB = INK
) {
  page.drawText(safe(s), { x, y: H - yTop - size, size, font, color });
}

function textRight(
  page: PDFPage,
  s: string,
  xRight: number,
  yTop: number,
  size: number,
  font: PDFFont,
  color: RGB = INK
) {
  const safeStr = safe(s);
  const w = font.widthOfTextAtSize(safeStr, size);
  page.drawText(safeStr, { x: xRight - w, y: H - yTop - size, size, font, color });
}

function truncate(s: string, font: PDFFont, size: number, maxW: number): string {
  s = safe(s);
  if (font.widthOfTextAtSize(s, size) <= maxW) return s;
  let out = s;
  while (out.length > 1 && font.widthOfTextAtSize(out + '...', size) > maxW) {
    out = out.slice(0, -1);
  }
  return out + '...';
}

function hline(page: PDFPage, x1: number, x2: number, yTop: number, color: RGB = LINE, thickness = 0.6) {
  page.drawLine({ start: { x: x1, y: H - yTop }, end: { x: x2, y: H - yTop }, thickness, color });
}

/** Draws one complete agent report onto a page. */
export function drawAgentPage(
  page: PDFPage,
  r: AgentMonthlyReport,
  fonts: Fonts,
  pageInfo?: { index: number; total: number }
) {
  const { reg, bold } = fonts;

  // ---- Header band ----
  page.drawRectangle({ x: 0, y: H - 52, width: W, height: 52, color: HEADBG });
  text(page, 'BYTES PLATFORM', M, 12, 13, bold, WHITE);
  text(page, 'Monthly Call Agent Salary & Performance Report', M, 30, 10, reg, rgb(0.86, 0.89, 0.96));
  textRight(page, r.monthName, W - M, 11, 12, bold, WHITE);
  textRight(page, `Ref ${r.referenceId}`, W - M, 28, 8, reg, rgb(0.86, 0.89, 0.96));
  textRight(
    page,
    `Generated ${new Date(r.generatedAt).toLocaleString('en-GB', { timeZone: 'Asia/Karachi' })} PKT`,
    W - M,
    39,
    7,
    reg,
    rgb(0.8, 0.84, 0.93)
  );

  // ---- Three info columns ----
  const top = 62;
  const colW = (W - 2 * M - 16) / 3;
  const c1 = M;
  const c2 = M + colW + 8;
  const c3 = M + 2 * colW + 16;
  const boxH = 176;
  for (const cx of [c1, c2, c3]) {
    page.drawRectangle({
      x: cx,
      y: H - top - boxH,
      width: colW,
      height: boxH,
      color: BOXBG,
      borderColor: LINE,
      borderWidth: 0.6,
    });
  }

  // Column 1 — Employee + Targets
  let y = top + 10;
  text(page, r.name, c1 + 8, y, 11, bold);
  y += 14;
  const empKV: [string, string][] = [
    ['Employee ID', r.employeeCode],
    ['Type', r.employmentType === 'part_time' ? 'Part-time' : 'Full-time'],
    ['Status', r.isActive ? 'Active' : 'Inactive'],
    ['Joined', r.joiningDate || '—'],
    ['Base Salary', formatPKR(r.baseSalary)],
    ['Working Days', String(r.workingDaysInMonth)],
    ['Daily Potential', formatPKR(r.dailyPotential)],
  ];
  for (const [k, v] of empKV) {
    text(page, k, c1 + 8, y, 7.5, reg, MUTED);
    textRight(page, v, c1 + colW - 8, y, 7.5, bold);
    y += 11.5;
  }
  y += 2;
  text(page, 'TARGETS USED', c1 + 8, y, 7, bold, MUTED);
  y += 11;
  text(page, `Calls ${r.targets.calls}`, c1 + 8, y, 7.5, reg);
  text(page, `Talk ${formatMinutes(r.targets.talkTimeSeconds)}`, c1 + 78, y, 7.5, reg);
  textRight(page, `Leads ${r.targets.leads} (display)`, c1 + colW - 8, y, 7.5, reg, MUTED);
  y += 11;
  text(page, `Source: ${r.targetSource === 'hr_configured' ? 'HR-configured' : 'System default'}`, c1 + 8, y, 6.5, reg, MUTED);

  // Column 2 — Performance + Attendance
  y = top + 10;
  text(page, 'MONTHLY PERFORMANCE', c2 + 8, y, 8, bold, MUTED);
  y += 13;
  const perfKV: [string, string][] = [
    ['Total Calls', r.totalCalls.toLocaleString()],
    ['Total Talk Time', formatMinutes(r.totalTalkTimeSeconds)],
    ['Total Leads', `${r.totalLeads} (no salary effect)`],
    ['Calls Achievement', `${r.callsAchievementPct}%`],
    ['Talk Achievement', `${r.talkAchievementPct}%`],
    ['Avg Daily Performance', `${r.avgPerformancePct}%`],
    ['Full-Performance Days', String(r.fullPerformanceDays)],
    ['Reduced-Performance Days', String(r.reducedPerformanceDays)],
  ];
  for (const [k, v] of perfKV) {
    text(page, k, c2 + 8, y, 7.5, reg, MUTED);
    textRight(page, v, c2 + colW - 8, y, 7.5, bold);
    y += 11;
  }
  y += 3;
  hline(page, c2 + 8, c2 + colW - 8, y - 2);
  text(page, 'ATTENDANCE', c2 + 8, y, 8, bold, MUTED);
  y += 12;
  const attKV: [string, string][] = [
    ['On-time', String(r.daysOnTime)],
    ['Late (free / excess)', `${r.freeLateCount} / ${r.excessLateCount}`],
    ['Half / Absent', `${r.daysHalfDay} / ${r.daysAbsent}`],
    ['Missing attend / stats', `${r.missingAttendanceDays} / ${r.missingStatsDays}`],
  ];
  for (const [k, v] of attKV) {
    text(page, k, c2 + 8, y, 7.5, reg, MUTED);
    textRight(page, v, c2 + colW - 8, y, 7.5, bold);
    y += 11;
  }

  // Column 3 — Salary Reconciliation
  y = top + 10;
  text(page, 'SALARY RECONCILIATION', c3 + 8, y, 8, bold, MUTED);
  y += 14;
  const recon: [string, number, boolean][] = [
    ['Potential Salary', r.potentialSalary, false],
    ['Performance + Attendance', r.performanceAdjustedEarnings, false],
    ['  Perf. shortfall impact', -r.dailyPerformanceImpact, true],
    ['  Attendance impact', -r.dailyAttendanceImpact, true],
    ['Excess-late deduction', -r.excessLateDeduction, true],
    ['Manual additions', r.manualAdditions, false],
    ['Manual deductions', -r.manualDeductions, true],
  ];
  for (const [k, v, neg] of recon) {
    text(page, k, c3 + 8, y, 7.5, reg, k.startsWith('  ') ? MUTED : INK);
    textRight(page, (v < 0 ? '−' : '') + formatPKR(Math.abs(v)).replace('Rs ', 'Rs '), c3 + colW - 8, y, 7.5, reg, neg && v !== 0 ? NEG : INK);
    y += 11.5;
  }
  y += 1;
  hline(page, c3 + 8, c3 + colW - 8, y - 1, INK, 0.9);
  y += 3;
  text(page, 'FINAL PAYABLE', c3 + 8, y, 9, bold);
  textRight(page, formatPKR(r.finalPayableSalary), c3 + colW - 8, y, 10, bold, POS);
  y += 14;
  text(page, 'Total Salary Difference', c3 + 8, y, 7.5, reg, MUTED);
  textRight(page, '−' + formatPKR(r.totalSalaryDifference), c3 + colW - 8, y, 7.5, bold, NEG);
  y += 12;
  text(page, `Half-day policy (info, already applied daily): ${formatPKR(r.halfDayPolicyAmountInfo)}`, c3 + 8, y, 6.3, reg, MUTED);

  // ---- Note line ----
  const noteY = top + boxH + 10;
  text(
    page,
    'Leads and sales are displayed for performance visibility only. They are not salary deduction components in the official payroll calculation.',
    M,
    noteY,
    7,
    reg,
    MUTED
  );

  // ---- Issue-days table ----
  const tableTop = noteY + 16;
  text(page, `SALARY-IMPACTING ISSUE DAYS (${r.issueDayCount})`, M, tableTop, 8.5, bold, MUTED);

  const cols = [
    { label: 'Date', x: M, w: 54, align: 'l' as const },
    { label: 'Attendance', x: M + 54, w: 56, align: 'l' as const },
    { label: 'Calls', x: M + 110, w: 52, align: 'l' as const },
    { label: 'Talk', x: M + 162, w: 66, align: 'l' as const },
    { label: 'Leads', x: M + 228, w: 44, align: 'l' as const },
    { label: 'Perf', x: M + 272, w: 34, align: 'r' as const },
    { label: 'Att×', x: M + 306, w: 30, align: 'r' as const },
    { label: 'Potential', x: M + 336, w: 74, align: 'r' as const },
    { label: 'Earned', x: M + 410, w: 74, align: 'r' as const },
    { label: 'Impact', x: M + 484, w: 74, align: 'r' as const },
    { label: 'Reason', x: M + 560, w: W - M - (M + 560), align: 'l' as const },
  ];

  const headY = tableTop + 12;
  page.drawRectangle({ x: M, y: H - headY - 12, width: W - 2 * M, height: 12, color: rgb(0.93, 0.94, 0.96) });
  for (const col of cols) {
    if (col.align === 'r') textRight(page, col.label, col.x + col.w - 3, headY + 2, 6.8, bold, MUTED);
    else text(page, col.label, col.x + 3, headY + 2, 6.8, bold, MUTED);
  }

  let rowY = headY + 12;
  const rowH = 8.9;
  if (r.issueDayCount === 0) {
    text(page, 'No salary-impacting issues were recorded during this payroll month.', M + 4, rowY + 4, 8, reg, POS);
  } else {
    const maxRows = Math.floor((H - 20 - (H - (H - rowY))) / rowH); // guard
    const rows = r.issueDays.slice(0, 31); // one A4 landscape page fits ≈31 compact rows
    rows.forEach((d, i) => {
      if (i % 2 === 1) page.drawRectangle({ x: M, y: H - rowY - rowH, width: W - 2 * M, height: rowH, color: ZEBRA });
      const cy = rowY + 1.5;
      const dateShort = d.date.slice(5); // MM-DD
      const impactColor = d.salaryImpact > 0.005 ? NEG : INK;
      const cells: { s: string; color?: RGB }[] = [
        { s: dateShort },
        { s: d.attendanceLabel },
        { s: `${d.calls}/${d.callsTarget}` },
        { s: `${formatMinutes(d.talkTimeSeconds)}/${formatMinutes(d.talkTimeTargetSeconds)}` },
        { s: `${d.leads}/${d.leadsTarget}`, color: MUTED },
        { s: `${d.performancePct}%` },
        { s: d.attendanceFactor.toFixed(1) },
        { s: formatPKR(d.dailyPotential).replace('Rs ', '') },
        { s: formatPKR(d.earned).replace('Rs ', '') },
        { s: formatPKR(d.salaryImpact).replace('Rs ', ''), color: impactColor },
      ];
      cols.slice(0, 10).forEach((col, ci) => {
        const cell = cells[ci];
        const val = truncate(cell.s, reg, 6.6, col.w - 4);
        if (col.align === 'r') textRight(page, val, col.x + col.w - 3, cy, 6.6, reg, cell.color || INK);
        else text(page, val, col.x + 3, cy, 6.6, reg, cell.color || INK);
      });
      const reasonCol = cols[10];
      const reason = truncate(d.reasons.join('; '), reg, 6.6, reasonCol.w - 4);
      text(page, reason, reasonCol.x + 3, cy, 6.6, reg, INK);
      rowY += rowH;
    });
    if (r.issueDays.length > 31) {
      text(page, `+ ${r.issueDays.length - 31} more issue day(s) not shown on this page`, M + 4, rowY + 3, 6.6, reg, MUTED);
      rowY += rowH;
    }
  }

  // ---- Footer ----
  hline(page, M, W - M, H - 16);
  text(page, `Confidential — payroll month ${r.month}`, M, H - 13, 6.5, reg, MUTED);
  const mid = pageInfo ? `Agent ${pageInfo.index} of ${pageInfo.total}` : `Employee ${r.name}`;
  const midW = reg.widthOfTextAtSize(mid, 6.5);
  text(page, mid, (W - midW) / 2, H - 13, 6.5, reg, MUTED);
  textRight(page, `Official payroll figures — Bytes Platform`, W - M, H - 13, 6.5, reg, MUTED);
}

async function newDoc(): Promise<{ doc: PDFDocument; fonts: Fonts }> {
  const doc = await PDFDocument.create();
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  return { doc, fonts: { reg, bold } };
}

export async function buildIndividualPdf(r: AgentMonthlyReport): Promise<Uint8Array> {
  const { doc, fonts } = await newDoc();
  doc.setTitle(`Salary & Performance — ${r.name} — ${r.month}`);
  doc.setAuthor('Bytes Platform HR');
  const page = doc.addPage([W, H]);
  drawAgentPage(page, r, fonts);
  return doc.save();
}

export async function buildCombinedPdf(reports: AgentMonthlyReport[]): Promise<Uint8Array> {
  const { doc, fonts } = await newDoc();
  doc.setTitle(`All Call-Agent Salary Reports — ${reports[0]?.month ?? ''}`);
  doc.setAuthor('Bytes Platform HR');
  const sorted = [...reports].sort((a, b) => a.name.localeCompare(b.name));
  sorted.forEach((r, i) => {
    const page = doc.addPage([W, H]);
    drawAgentPage(page, r, fonts, { index: i + 1, total: sorted.length });
  });
  return doc.save();
}
