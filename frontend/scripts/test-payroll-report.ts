/**
 * Payroll-report unit tests — runnable without a test runner:
 *   npx tsx frontend/scripts/test-payroll-report.ts
 *
 * Covers the official formula (60/40), attendance multipliers, the "3 lates
 * free" policy, double-deduction prevention, issue-day filtering, and the
 * leads/sales-never-reduce-salary guarantee.
 */
import assert from 'node:assert';
import {
  computeAgentMonthlyReport,
  AgentInput,
  DayInput,
  ComputeContext,
} from '../lib/payroll-report-service';
import { DAILY_TARGETS, calculatePerformanceScore } from '../lib/salary-utils';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e: any) {
    failed++;
    console.error(`  ✗ ${name}\n      ${e.message}`);
  }
}

const FT_TARGETS = DAILY_TARGETS.full_time; // 150 calls, 3600s, 3 leads
const PT_TARGETS = DAILY_TARGETS.part_time; // 75 calls, 1800s, 2 leads
const near = (a: number, b: number, eps = 0.01) => Math.abs(a - b) <= eps;

function ctx(overrides: Partial<ComputeContext> = {}): ComputeContext {
  return {
    year: 2026,
    month: 8,
    monthName: 'August 2026',
    generatedAt: '2026-09-01T00:00:00.000Z',
    targets: FT_TARGETS,
    targetSource: 'default',
    workingDays: 22,
    ...overrides,
  };
}

function agent(overrides: Partial<AgentInput> = {}): AgentInput {
  return {
    id: 1,
    employeeCode: '15',
    name: 'Test Agent',
    employmentType: 'full_time',
    baseSalary: 30000,
    joiningDate: null,
    isActive: true,
    ...overrides,
  };
}

function day(overrides: Partial<DayInput> = {}): DayInput {
  return {
    date: '2026-08-03',
    hasAttendance: true,
    status: 'on_time',
    hrApproved: false,
    hasStats: true,
    calls: 150,
    talkTimeSeconds: 3600,
    leads: 3,
    ...overrides,
  };
}

console.log('\nFORMULA TESTS');

test('FT: 150 calls + 60 min = 100% performance', () => {
  const s = calculatePerformanceScore({ date: 'd', calls_count: 150, talk_time_seconds: 3600, leads_count: 0 }, 'full_time', FT_TARGETS);
  assert.ok(near(s, 1.0), `got ${s}`);
});

test('FT: 75 calls + 30 min = 50% performance', () => {
  const s = calculatePerformanceScore({ date: 'd', calls_count: 75, talk_time_seconds: 1800, leads_count: 0 }, 'full_time', FT_TARGETS);
  assert.ok(near(s, 0.5), `got ${s}`);
});

test('FT: 150 calls + 15 min = 70% performance', () => {
  const s = calculatePerformanceScore({ date: 'd', calls_count: 150, talk_time_seconds: 900, leads_count: 0 }, 'full_time', FT_TARGETS);
  assert.ok(near(s, 0.7), `got ${s}`);
});

test('PT: 75 calls + 30 min = 100% performance', () => {
  const s = calculatePerformanceScore({ date: 'd', calls_count: 75, talk_time_seconds: 1800, leads_count: 0 }, 'part_time', PT_TARGETS);
  assert.ok(near(s, 1.0), `got ${s}`);
});

test('Calls contribution caps at 0.60 (300 calls, 0 talk)', () => {
  const s = calculatePerformanceScore({ date: 'd', calls_count: 300, talk_time_seconds: 0, leads_count: 0 }, 'full_time', FT_TARGETS);
  assert.ok(near(s, 0.6), `got ${s}`);
});

test('Talk contribution caps at 0.40 (0 calls, 2h talk)', () => {
  const s = calculatePerformanceScore({ date: 'd', calls_count: 0, talk_time_seconds: 7200, leads_count: 0 }, 'full_time', FT_TARGETS);
  assert.ok(near(s, 0.4), `got ${s}`);
});

test('Leads do NOT change performance/salary', () => {
  const withLeads = calculatePerformanceScore({ date: 'd', calls_count: 75, talk_time_seconds: 1800, leads_count: 99 }, 'full_time', FT_TARGETS);
  const without = calculatePerformanceScore({ date: 'd', calls_count: 75, talk_time_seconds: 1800, leads_count: 0 }, 'full_time', FT_TARGETS);
  assert.strictEqual(withLeads, without);
});

test('Daily potential ≈ Rs 1363.64 for 30k / 22 days', () => {
  const r = computeAgentMonthlyReport(agent(), [day()], ctx());
  assert.ok(near(r.dailyPotential, 1363.64), `got ${r.dailyPotential}`);
});

console.log('\nATTENDANCE TESTS');

test('On-time perfect day earns full daily potential', () => {
  const r = computeAgentMonthlyReport(agent(), [day({ status: 'on_time' })], ctx());
  assert.ok(near(r.performanceAdjustedEarnings, 1363.64), `got ${r.performanceAdjustedEarnings}`);
  assert.strictEqual(r.issueDayCount, 0);
});

test('Absent day earns 0 and is an issue day', () => {
  const r = computeAgentMonthlyReport(agent(), [day({ status: 'absent', calls: 0, talkTimeSeconds: 0, leads: 0 })], ctx());
  assert.ok(near(r.performanceAdjustedEarnings, 0), `got ${r.performanceAdjustedEarnings}`);
  assert.strictEqual(r.issueDayCount, 1);
});

test('Half-day perfect performance earns 50% (single 0.5 multiplier)', () => {
  const r = computeAgentMonthlyReport(agent(), [day({ status: 'half_day' })], ctx());
  assert.ok(near(r.performanceAdjustedEarnings, 681.82), `got ${r.performanceAdjustedEarnings}`);
});

test('First 3 lates are free; 4th and 5th deduct 0.5 day each', () => {
  const days: DayInput[] = [];
  for (let i = 1; i <= 5; i++) {
    days.push(day({ date: `2026-08-0${i + 2}`, status: 'late' })); // perfect stats, late
  }
  const r = computeAgentMonthlyReport(agent(), days, ctx());
  assert.strictEqual(r.freeLateCount, 3, 'freeLateCount');
  assert.strictEqual(r.excessLateCount, 2, 'excessLateCount');
  // 2 excess lates × 0.5 × 1363.64 = 1363.64
  assert.ok(near(r.excessLateDeduction, 1363.64), `deduction ${r.excessLateDeduction}`);
});

test('Half-day is NOT double-deducted (excessLateDeduction ignores half-days)', () => {
  const r = computeAgentMonthlyReport(agent(), [day({ status: 'half_day' })], ctx());
  // Only the daily 0.5 multiplier applies; no separate month-end half-day cut in final.
  assert.strictEqual(r.excessLateDeduction, 0);
  // informational value present but not subtracted from final
  assert.ok(r.halfDayPolicyAmountInfo > 0);
  assert.ok(near(r.finalPayableSalary, r.performanceAdjustedEarnings), 'final should equal daily earnings (no double cut)');
});

console.log('\nREPORT / RECONCILIATION TESTS');

test('Perfect on-time days produce zero issue days', () => {
  const days = ['03', '04', '05'].map((d) => day({ date: `2026-08-${d}` }));
  const r = computeAgentMonthlyReport(agent(), days, ctx());
  assert.strictEqual(r.issueDayCount, 0);
});

test('Calls-short day is an issue with a reason and impact', () => {
  const r = computeAgentMonthlyReport(agent(), [day({ calls: 108, talkTimeSeconds: 3600 })], ctx());
  assert.strictEqual(r.issueDayCount, 1);
  const iss = r.issueDays[0];
  assert.ok(iss.reasons.join(' ').toLowerCase().includes('calls short'), iss.reasons.join(';'));
  assert.ok(iss.salaryImpact > 0);
});

test('Free late shows reason but adds no deduction', () => {
  const r = computeAgentMonthlyReport(agent(), [day({ status: 'late' })], ctx());
  assert.strictEqual(r.excessLateDeduction, 0);
  assert.ok(r.issueDays[0].reasons.join(' ').includes('within first 3 free lates'));
});

test('Excess late (#4) shows month-end deduction reason', () => {
  const days: DayInput[] = [];
  for (let i = 1; i <= 4; i++) days.push(day({ date: `2026-08-0${i + 2}`, status: 'late' }));
  const r = computeAgentMonthlyReport(agent(), days, ctx());
  const fourth = r.issueDays.find((d) => d.lateNumber === 4)!;
  assert.ok(fourth.reasons.join(' ').includes('0.5-day month-end deduction'), fourth.reasons.join(';'));
});

test('Leads present but salary impact stays zero on an otherwise perfect day', () => {
  const r = computeAgentMonthlyReport(agent(), [day({ leads: 0 })], ctx()); // 0 leads, perfect calls/talk
  assert.strictEqual(r.issueDayCount, 0, 'zero leads must not create an issue day');
  assert.ok(near(r.finalPayableSalary, 1363.64));
});

test('Final payable = potential − all reductions (reconciliation closes)', () => {
  const days: DayInput[] = [
    day({ date: '2026-08-03', status: 'on_time' }), // full
    day({ date: '2026-08-04', status: 'half_day' }), // 0.5
    day({ date: '2026-08-05', status: 'absent', calls: 0, talkTimeSeconds: 0, leads: 0 }), // 0
    day({ date: '2026-08-06', calls: 75, talkTimeSeconds: 1800 }), // 50% perf
  ];
  const r = computeAgentMonthlyReport(agent(), days, ctx());
  const recomputed =
    r.potentialSalary - r.dailyPerformanceImpact - r.dailyAttendanceImpact - r.excessLateDeduction;
  assert.ok(near(recomputed, r.finalPayableSalary, 0.05), `recon ${recomputed} vs ${r.finalPayableSalary}`);
  assert.ok(near(r.totalSalaryDifference, r.potentialSalary - r.finalPayableSalary));
});

test('Missing stats on a working day flags missing-data', () => {
  const r = computeAgentMonthlyReport(agent(), [day({ hasStats: false, calls: 0, talkTimeSeconds: 0, status: 'on_time' })], ctx());
  assert.ok(r.hasMissingData);
  assert.ok(r.issueDays[0].reasons.join(' ').includes('Missing 3CX statistics'));
});

console.log('\nATTENDANCE-FIX TESTS (calls but no check-in)');

test('No check-in but full calls → paid as present, NOT zeroed', () => {
  const r = computeAgentMonthlyReport(
    agent(),
    [day({ hasAttendance: false, status: 'absent', calls: 150, talkTimeSeconds: 3600, leads: 3 })],
    ctx()
  );
  assert.ok(near(r.finalPayableSalary, 1363.64), `final ${r.finalPayableSalary}`); // on_time ×1.0 × 100%
  assert.strictEqual(r.daysAbsent, 0, 'must not be counted absent');
  assert.strictEqual(r.daysOnTime, 1, 'counted as present/on_time');
  assert.strictEqual(r.missingAttendanceDays, 1, 'missing record still surfaced');
  assert.strictEqual(r.issueDayCount, 1, 'flagged for HR to verify attendance');
  assert.ok(r.issueDays[0].reasons.join(' ').toLowerCase().includes('no check-in'));
  assert.strictEqual(r.issueDays[0].attendanceFactor, 1.0);
});

test('No check-in AND no calls → still absent (0)', () => {
  const r = computeAgentMonthlyReport(
    agent(),
    [day({ hasAttendance: false, status: 'absent', calls: 0, talkTimeSeconds: 0, leads: 0 })],
    ctx()
  );
  assert.ok(near(r.finalPayableSalary, 0), `final ${r.finalPayableSalary}`);
  assert.strictEqual(r.daysAbsent, 1);
  assert.strictEqual(r.daysOnTime, 0);
});

test('No check-in with partial calls → present ×1.0 but performance-scaled', () => {
  const r = computeAgentMonthlyReport(
    agent(),
    [day({ hasAttendance: false, status: 'absent', calls: 75, talkTimeSeconds: 1800, leads: 0 })],
    ctx()
  );
  // 50% performance × on_time (1.0) = 0.5 day
  assert.ok(near(r.finalPayableSalary, 681.82), `final ${r.finalPayableSalary}`);
  assert.strictEqual(r.daysAbsent, 0);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
