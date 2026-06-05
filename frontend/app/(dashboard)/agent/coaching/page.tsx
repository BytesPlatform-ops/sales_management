'use client';

import { useEffect, useState } from 'react';

// ---------- types (mirror weekly_reports JSONB) ----------
interface Strength { title: string; evidence: string; }
interface Weakness { id: string; title: string; severity: 'low' | 'medium' | 'high'; evidence: string; recommended_fix: string; }
interface Improvement { prev_weakness_id: string; prev_title: string; verdict: 'improved' | 'same' | 'regressed'; evidence: string; }
interface Script { objection: string; suggested_script: string; }

interface WeeklyReport {
  id: number;
  week_start: string;
  week_end: string;
  avg_score: number | null;
  calls_count: number;
  meetings_count: number;
  strengths: Strength[] | null;
  weaknesses: Weakness[] | null;
  custom_scripts: Script[] | null;
  improvement: Improvement[] | null;
  improvement_rate: number | null;
  narrative: string;
}

// ---------- helpers ----------
const fmtRange = (start: string, end: string) => {
  const o: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  // Accept both 'YYYY-MM-DD' and ISO timestamps; slice to the date part to avoid TZ shift.
  const s = new Date((start || '').slice(0, 10) + 'T00:00:00').toLocaleDateString('en-US', o);
  const e = new Date((end || '').slice(0, 10) + 'T00:00:00').toLocaleDateString('en-US', o);
  return `${s} – ${e}`;
};
const scoreColor = (n: number | string | null) => {
  if (n == null) return 'text-gray-400';
  const v = Number(n);
  return v >= 7 ? 'text-green-600' : v >= 4 ? 'text-amber-600' : 'text-red-600';
};

const SEVERITY_STYLE: Record<string, string> = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-yellow-100 text-yellow-700',
};

// ============================================================
export default function AgentCoachingPage() {
  const [reports, setReports] = useState<WeeklyReport[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/agent/coaching/weekly', {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        });
        const json = await res.json();
        if (json.status === 'success') {
          setReports(json.reports || []);
          if (json.reports?.length) setSelectedId(json.reports[0].id); // latest
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const report = reports.find((r) => r.id === selectedId) || null;

  if (loading) {
    return <div className="p-6 text-center text-gray-400">Loading your coaching reports…</div>;
  }

  if (reports.length === 0) {
    return (
      <div className="p-6 max-w-3xl mx-auto text-center">
        <div className="bg-white rounded-2xl border border-gray-200 p-10 mt-10">
          <div className="text-4xl mb-3">📈</div>
          <h1 className="text-xl font-bold text-gray-900">No coaching reports yet</h1>
          <p className="text-sm text-gray-500 mt-2">
            Your first weekly coaching report will appear here once it's ready. Keep making calls!
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header + week selector */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Your Coaching</h1>
          <p className="text-sm text-gray-500">Weekly feedback and scripts to level up your calls.</p>
        </div>
        <select
          value={selectedId ?? ''}
          onChange={(e) => setSelectedId(Number(e.target.value))}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
        >
          {reports.map((r) => (
            <option key={r.id} value={r.id}>{fmtRange(r.week_start, r.week_end)}</option>
          ))}
        </select>
      </div>

      {report && (
        <div className="space-y-5">
          {/* Card header: range + overall score */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-400">Week of</div>
              <div className="text-lg font-bold text-gray-900">{fmtRange(report.week_start, report.week_end)}</div>
              <div className="text-xs text-gray-500 mt-1">{report.calls_count} calls · {report.meetings_count} meetings booked</div>
            </div>
            <div className="text-center">
              <div className="text-xs uppercase tracking-wide text-gray-400">Overall</div>
              <div className={`text-3xl font-extrabold ${scoreColor(report.avg_score)}`}>
                {report.avg_score == null ? '—' : Number(report.avg_score).toFixed(1)}
              </div>
              <div className="text-[10px] text-gray-400">out of 10</div>
            </div>
          </div>

          {/* Iterative improvement badge */}
          <ImprovementBadge report={report} />

          {/* Strengths */}
          {report.strengths && report.strengths.length > 0 && (
            <Section title="What you did well 💪" tone="green">
              {report.strengths.map((s, i) => (
                <div key={i} className="mb-3 last:mb-0">
                  <div className="font-semibold text-green-800 text-sm">{s.title}</div>
                  <p className="text-sm text-gray-600 italic mt-0.5">“{s.evidence}”</p>
                </div>
              ))}
            </Section>
          )}

          {/* Weaknesses */}
          {report.weaknesses && report.weaknesses.length > 0 && (
            <Section title="Areas to grow 🎯" tone="amber">
              {report.weaknesses.map((w, i) => (
                <div key={i} className="mb-4 last:mb-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900 text-sm">{w.title}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase font-semibold ${SEVERITY_STYLE[w.severity] || ''}`}>
                      {w.severity}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 italic mt-1">“{w.evidence}”</p>
                  <div className="mt-1.5 text-sm bg-white/70 rounded-lg px-3 py-2 border border-amber-200">
                    <span className="font-semibold text-amber-700">Fix: </span>
                    <span className="text-gray-700">{w.recommended_fix}</span>
                  </div>
                </div>
              ))}
            </Section>
          )}

          {/* Custom scripts — the highly visible blue section */}
          {report.custom_scripts && report.custom_scripts.length > 0 && (
            <div className="bg-blue-50 rounded-2xl border-2 border-blue-200 shadow-sm p-5">
              <h2 className="text-base font-bold text-blue-900 flex items-center gap-2 mb-3">
                🗣️ Your scripts for next week
              </h2>
              <div className="space-y-3">
                {report.custom_scripts.map((s, i) => (
                  <div key={i} className="bg-white rounded-xl border border-blue-200 p-4">
                    <div className="text-xs font-semibold uppercase text-blue-500 tracking-wide mb-1">
                      When they say: {s.objection}
                    </div>
                    <p className="text-sm text-gray-800 font-medium leading-relaxed">“{s.suggested_script}”</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Narrative */}
          {report.narrative && (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
              <h2 className="text-base font-bold text-gray-900 mb-2">Coach's note</h2>
              <p className="text-sm text-gray-700 leading-relaxed">{report.narrative}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- improvement badge ----------
function ImprovementBadge({ report }: { report: WeeklyReport }) {
  const hasPrior = report.improvement && report.improvement.length > 0;

  // Baseline week (no prior weaknesses to measure against)
  if (!hasPrior || report.improvement_rate == null) {
    return (
      <div className="rounded-2xl border-2 border-indigo-200 bg-indigo-50 p-5 flex items-center gap-4">
        <div className="text-3xl">🚀</div>
        <div>
          <div className="font-bold text-indigo-900">Baseline week established</div>
          <div className="text-sm text-indigo-700">
            We've mapped your starting point. Next week we'll track how much you improve.
          </div>
        </div>
      </div>
    );
  }

  const pct = Math.round(Number(report.improvement_rate) * 100);
  const resolved = report.improvement!.filter((i) => i.verdict === 'improved').length;
  const total = report.improvement!.length;
  const hit = pct >= 50;

  return (
    <div className={`rounded-2xl border-2 p-5 ${hit ? 'border-green-300 bg-green-50' : 'border-amber-300 bg-amber-50'}`}>
      <div className="flex items-center gap-4">
        <div className="text-3xl">{hit ? '🏆' : '📊'}</div>
        <div className="flex-1">
          <div className={`font-bold ${hit ? 'text-green-900' : 'text-amber-900'}`}>
            {hit
              ? `Target Hit! You resolved ${pct}% of last week's weaknesses`
              : `You resolved ${pct}% of last week's weaknesses`}
          </div>
          <div className={`text-sm ${hit ? 'text-green-700' : 'text-amber-700'}`}>
            {resolved} of {total} improved. {hit ? 'Keep the momentum going!' : 'Focus on the fixes below to climb higher.'}
          </div>
        </div>
      </div>

      {/* per-weakness verdicts */}
      <div className="mt-3 flex flex-wrap gap-2">
        {report.improvement!.map((imp, i) => {
          const style =
            imp.verdict === 'improved' ? 'bg-green-100 text-green-700'
              : imp.verdict === 'regressed' ? 'bg-red-100 text-red-700'
                : 'bg-gray-100 text-gray-600';
          const icon = imp.verdict === 'improved' ? '✓' : imp.verdict === 'regressed' ? '↓' : '–';
          return (
            <span key={i} className={`text-xs px-2 py-1 rounded-full font-medium ${style}`} title={imp.evidence}>
              {icon} {imp.prev_title}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ---------- section wrapper ----------
function Section({ title, tone, children }: { title: string; tone: 'green' | 'amber'; children: React.ReactNode }) {
  const toneStyle = tone === 'green'
    ? 'border-green-200 bg-green-50'
    : 'border-amber-200 bg-amber-50';
  return (
    <div className={`rounded-2xl border-2 shadow-sm p-5 ${toneStyle}`}>
      <h2 className="text-base font-bold text-gray-900 mb-3">{title}</h2>
      {children}
    </div>
  );
}
