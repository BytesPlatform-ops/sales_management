'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Scorecard, COLD_NUMERIC, COLD_BOOL, DISCOVERY_NUMERIC, DISCOVERY_BOOL,
  Chip, BoolChip, RubricLegend, CoachingBlock, fmtScore, fmtDuration, fmtTime, scoreColor, CONF_STYLE,
} from '@/components/qa/scorecard-ui';

// ---------- types ----------
interface Summary {
  calls_total: number | null;
  calls_evaluated: number | null;
  meetings_scheduled: number | null;
  daily_score: number | string | null;
  metrics: Record<string, number> | null;
}
interface EvaluationRow {
  id: number;
  customer_number: string | null;
  call_started_at: string;
  duration_sec: number;
  call_type: string | null;
  overall_score: number | string | null;
  meeting_scheduled: boolean | null;
  not_evaluable: boolean;
  not_evaluable_reason: string | null;
  scorecard: Scorecard | null;
  disposition: string | null;
  attribution_confidence: string | null;
}

// ---------- helpers ----------
function yesterdayShift(): string {
  const now = new Date();
  const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const hour = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Karachi', hour: 'numeric', hour12: false }).format(now), 10);
  const [y, m, day] = d.split('-').map(Number);
  const offset = hour < 6 ? 2 : 1;
  const t = new Date(y, m - 1, day - offset);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

// ============================================================
export default function AgentDailyReportPage() {
  const [date, setDate] = useState<string>(yesterdayShift());
  const [summary, setSummary] = useState<Summary | null>(null);
  const [evaluations, setEvaluations] = useState<EvaluationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/agent/qa-daily?date=${date}`, { headers: authHeaders() });
      const json = await res.json();
      if (json.status !== 'success') throw new Error(json.message || 'Failed to load');
      setSummary(json.summary || null);
      setEvaluations(json.evaluations || []);
    } catch (e: any) { setError(e.message); setSummary(null); setEvaluations([]); }
    finally { setLoading(false); }
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const graded = evaluations.filter((e) => !e.not_evaluable);
  const skipped = evaluations.filter((e) => e.not_evaluable);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Daily Report</h1>
          <p className="text-sm text-gray-500">Your AI-graded call scores for the shift. Cold calls (&lt;3m) and discovery calls (≥3m) use different rubrics.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-600">Shift date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
        </div>
      </div>

      {error && <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm border border-red-200">{error}</div>}

      {/* summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <SummaryStat label="Calls dialed" value={summary?.calls_total ?? '—'} sub="total effort" />
        <SummaryStat label="Graded" value={summary?.calls_evaluated ?? '—'} sub="real conversations" />
        <SummaryStat label="Meetings booked" value={summary?.meetings_scheduled ?? 0} sub="this shift" highlight={(summary?.meetings_scheduled ?? 0) > 0} />
        <SummaryStat label="Overall score" value={fmtScore(summary?.daily_score)} sub="/ 10" scoreColored={summary?.daily_score} />
      </div>

      {loading ? (
        <p className="text-center text-gray-400 py-10">Loading…</p>
      ) : !summary && evaluations.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">
          No QA scores for this shift yet. Scores are graded the morning after each shift.
        </div>
      ) : (
        <div className="space-y-4">
          {graded.length === 0 && (
            <p className="text-center text-gray-400 py-6 text-sm bg-white rounded-xl border border-gray-200">
              No gradeable conversations this shift — all calls were unanswered, voicemail, or too short.
            </p>
          )}
          {graded.map((ev) => <AgentCallCard key={ev.id} ev={ev} />)}

          {skipped.length > 0 && <SkippedSummary skipped={skipped} />}
        </div>
      )}

      <RubricLegend />
    </div>
  );
}

// ---------- summary stat tile ----------
function SummaryStat({ label, value, sub, highlight, scoreColored }: {
  label: string; value: React.ReactNode; sub: string; highlight?: boolean; scoreColored?: number | string | null;
}) {
  const valColor = scoreColored !== undefined ? scoreColor(scoreColored) : highlight ? 'text-green-600' : 'text-gray-900';
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      <div className="text-[11px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className={`text-2xl font-bold ${valColor}`}>{value}</div>
      <div className="text-[11px] text-gray-400">{sub}</div>
    </div>
  );
}

// ---------- collapsed not-evaluable summary ----------
function SkippedSummary({ skipped }: { skipped: EvaluationRow[] }) {
  const [show, setShow] = useState(false);
  const reasons: Record<string, number> = {};
  for (const e of skipped) {
    const r = e.disposition && e.disposition !== 'connected_conversation' ? e.disposition : (e.not_evaluable_reason || 'other');
    reasons[r] = (reasons[r] || 0) + 1;
  }
  const summary = Object.entries(reasons).sort((a, b) => b[1] - a[1]).map(([r, n]) => `${n} ${r.replace(/_/g, ' ')}`).join(' · ');
  return (
    <div>
      <button onClick={() => setShow((s) => !s)} className="w-full text-left text-xs text-gray-500 bg-gray-100 hover:bg-gray-200 rounded-lg px-3 py-2 transition-colors">
        {show ? '▾' : '▸'} {skipped.length} not-evaluable calls (not scored) — {summary}
      </button>
      {show && (
        <div className="mt-2 space-y-1">
          {skipped.map((ev) => (
            <div key={ev.id} className="text-xs text-gray-500 flex items-center justify-between px-3 py-1.5 border border-gray-100 rounded">
              <span>{fmtTime(ev.call_started_at)} · {ev.customer_number || 'unknown'} · {fmtDuration(ev.duration_sec)}</span>
              <span className="text-gray-400">{(ev.disposition && ev.disposition !== 'connected_conversation' ? ev.disposition : ev.not_evaluable_reason || 'n/a').replace(/_/g, ' ')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- per-call card (read-only, no transcript, no flag) ----------
function AgentCallCard({ ev }: { ev: EvaluationRow }) {
  const [showTurns, setShowTurns] = useState(false);
  const sc = ev.scorecard;
  if (!sc) return null;
  const isCold = sc.rubric ? sc.rubric === 'cold' : ev.duration_sec < 180;
  const numericDims = isCold ? COLD_NUMERIC : DISCOVERY_NUMERIC;
  const boolDims = isCold ? COLD_BOOL : DISCOVERY_BOOL;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="text-sm">
          <span className="font-semibold text-gray-900">{fmtTime(ev.call_started_at)}</span>
          <span className="text-gray-400"> · {ev.customer_number || 'unknown'} · {fmtDuration(ev.duration_sec)}</span>
        </div>
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${scoreColor(ev.overall_score)}`}>{fmtScore(ev.overall_score)}/10</span>
      </div>

      <div className="p-4 space-y-4">
        {/* rubric + attribution */}
        <div className="flex items-center gap-2 text-xs flex-wrap">
          <span className={`px-1.5 py-0.5 rounded font-semibold uppercase ${isCold ? 'bg-sky-100 text-sky-700' : 'bg-violet-100 text-violet-700'}`}>
            {isCold ? 'Cold call' : 'Discovery'}
          </span>
          <span className="text-gray-400">Speaker attribution:</span>
          <span className={`px-1.5 py-0.5 rounded font-semibold uppercase ${CONF_STYLE[sc.attribution_confidence] || ''}`}>{sc.attribution_confidence}</span>
        </div>

        {/* numeric dimensions */}
        <div className="grid grid-cols-3 gap-2">
          {numericDims.map(([k, label]) => <Chip key={k} label={label} value={(sc[k] as number | null) ?? null} />)}
        </div>
        {/* boolean outcomes */}
        <div className="grid grid-cols-2 gap-2">
          {boolDims.map(([k, label]) => <BoolChip key={k} label={label} value={(sc[k] as boolean | null) ?? null} />)}
        </div>

        {/* evidence */}
        {sc.evidence?.length > 0 && (
          <div className="space-y-2 pt-1">
            <div className="text-[10px] uppercase text-gray-400 tracking-wide">What the AI heard</div>
            {sc.evidence.map((q, i) => (
              <div key={i} className="border-l-2 border-blue-300 bg-blue-50/50 pl-3 pr-2 py-2 rounded-r">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[10px] font-semibold uppercase text-blue-600">{q.parameter}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${q.attributed_to === 'agent' ? 'bg-indigo-100 text-indigo-700' : q.attributed_to === 'prospect' ? 'bg-gray-200 text-gray-600' : 'bg-yellow-100 text-yellow-700'}`}>{q.attributed_to}</span>
                </div>
                <p className="text-sm text-gray-800 italic">“{q.quote}”</p>
                <p className="text-[11px] text-gray-500 mt-0.5">{q.rationale}</p>
              </div>
            ))}
          </div>
        )}

        {/* summary */}
        {sc.summary && <p className="text-xs text-gray-600 bg-gray-50 rounded p-2">{sc.summary}</p>}

        {/* coach's notes — say-this-instead rewrites + next-call focus */}
        <CoachingBlock coaching={sc.coaching} />

        {/* attributed dialogue toggle (not the raw transcript) */}
        {sc.reconstructed_turns?.length > 0 && (
          <>
            <button onClick={() => setShowTurns((s) => !s)} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
              {showTurns ? 'Hide dialogue' : 'View dialogue'}
            </button>
            {showTurns && (
              <div className="text-xs bg-gray-50 border border-gray-100 rounded-lg p-3 max-h-72 overflow-y-auto space-y-1">
                {sc.reconstructed_turns.map((t, i) => (
                  <div key={i}>
                    <span className={`font-semibold ${t.speaker === 'agent' ? 'text-indigo-600' : t.speaker === 'prospect' ? 'text-gray-700' : 'text-yellow-600'}`}>[{t.speaker}]</span>{' '}
                    <span className="text-gray-700">{t.text}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
