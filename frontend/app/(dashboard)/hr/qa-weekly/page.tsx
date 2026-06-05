'use client';

import { useEffect, useState, useCallback } from 'react';

// ---------- types ----------
interface Strength { title: string; evidence: string; }
interface Weakness { id: string; title: string; severity: 'low' | 'medium' | 'high'; evidence: string; recommended_fix: string; }
interface Improvement { prev_weakness_id: string; prev_title: string; verdict: 'improved' | 'same' | 'regressed'; evidence: string; }
interface Script { objection: string; suggested_script: string; }

interface WeeklyReport {
  id: number;
  agent_id: number;
  full_name: string;
  extension_number: string;
  week_start: string;
  week_end: string;
  avg_score: number | string | null;
  calls_count: number;
  meetings_count: number;
  strengths: Strength[] | null;
  weaknesses: Weakness[] | null;
  custom_scripts: Script[] | null;
  improvement: Improvement[] | null;
  improvement_rate: number | string | null;
  narrative: string;
  status: 'draft' | 'published' | 'low_data';
}
interface WeekOpt { week_start: string; week_end: string; }

// ---------- helpers ----------
const fmtRange = (start: string, end: string) => {
  const o: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const s = new Date((start || '').slice(0, 10) + 'T00:00:00').toLocaleDateString('en-US', o);
  const e = new Date((end || '').slice(0, 10) + 'T00:00:00').toLocaleDateString('en-US', o);
  return `${s} – ${e}`;
};
const scoreColor = (n: number | string | null) => {
  if (n == null) return 'text-gray-400';
  const v = Number(n);
  return v >= 7 ? 'text-green-600' : v >= 4 ? 'text-amber-600' : 'text-red-600';
};
const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-amber-100 text-amber-700',
  published: 'bg-green-100 text-green-700',
  low_data: 'bg-gray-200 text-gray-600',
};
const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', published: 'Published', low_data: 'Low Data',
};
const SEVERITY_STYLE: Record<string, string> = {
  high: 'bg-red-100 text-red-700', medium: 'bg-amber-100 text-amber-700', low: 'bg-yellow-100 text-yellow-700',
};
const VERDICT_STYLE: Record<string, string> = {
  improved: 'bg-green-100 text-green-700', regressed: 'bg-red-100 text-red-700', same: 'bg-gray-100 text-gray-600',
};

// ============================================================
export default function QaWeeklyPage() {
  const [weeks, setWeeks] = useState<WeekOpt[]>([]);
  const [week, setWeek] = useState<string>('');
  const [reports, setReports] = useState<WeeklyReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<WeeklyReport | null>(null);
  const [publishing, setPublishing] = useState(false);

  const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

  const load = useCallback(async (wk?: string) => {
    setLoading(true);
    setError(null);
    try {
      const qs = wk ? `?week=${wk}` : '';
      const res = await fetch(`/api/hr/qa-weekly${qs}`, { headers: authHeaders() });
      const json = await res.json();
      if (json.status !== 'success') throw new Error(json.message || 'Failed to load');
      setWeeks(json.weeks || []);
      setWeek(json.week_start || '');
      setReports(json.reports || []);
      // keep the side sheet in sync if it's open
      setSelected((cur) => (cur ? (json.reports || []).find((r: WeeklyReport) => r.id === cur.id) || null : null));
    } catch (e: any) {
      setError(e.message);
      setReports([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const publish = async (report: WeeklyReport, action: 'publish' | 'unpublish') => {
    setPublishing(true);
    try {
      const res = await fetch('/api/hr/qa-weekly/publish', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId: report.id, action }),
      });
      if ((await res.json()).status === 'success') {
        await load(week); // refresh table + sheet
      }
    } finally {
      setPublishing(false);
    }
  };

  const draftCount = reports.filter((r) => r.status === 'draft').length;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header + week selector */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Weekly Coaching Review</h1>
          <p className="text-sm text-gray-500">
            Review AI-generated coaching drafts and publish them to agents.
            {draftCount > 0 && <span className="ml-1 font-medium text-amber-600">{draftCount} awaiting review.</span>}
          </p>
        </div>
        {weeks.length > 0 && (
          <select
            value={week}
            onChange={(e) => { setWeek(e.target.value); load(e.target.value); }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
          >
            {weeks.map((w) => (
              <option key={w.week_start} value={w.week_start}>{fmtRange(w.week_start, w.week_end)}</option>
            ))}
          </select>
        )}
      </div>

      {error && <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm border border-red-200">{error}</div>}

      {/* Reports table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 uppercase text-[11px] tracking-wide">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Agent</th>
              <th className="text-center px-3 py-3 font-medium">Ext</th>
              <th className="text-center px-3 py-3 font-medium">Calls</th>
              <th className="text-center px-3 py-3 font-medium">Meetings</th>
              <th className="text-center px-3 py-3 font-medium">Week Score</th>
              <th className="text-center px-3 py-3 font-medium">Improvement</th>
              <th className="text-center px-3 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={7} className="text-center py-10 text-gray-400">Loading…</td></tr>
            ) : reports.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-10 text-gray-400">No weekly reports for this week.</td></tr>
            ) : (
              reports.map((r) => (
                <tr key={r.id} onClick={() => setSelected(r)} className="hover:bg-blue-50/60 cursor-pointer transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">{r.full_name}</td>
                  <td className="px-3 py-3 text-center text-gray-500">{r.extension_number}</td>
                  <td className="px-3 py-3 text-center text-gray-700">{r.calls_count}</td>
                  <td className="px-3 py-3 text-center text-gray-700">{r.meetings_count}</td>
                  <td className={`px-3 py-3 text-center font-bold ${scoreColor(r.avg_score)}`}>
                    {r.avg_score == null ? '—' : Number(r.avg_score).toFixed(1)}
                  </td>
                  <td className="px-3 py-3 text-center text-gray-700">
                    {r.improvement_rate == null ? <span className="text-gray-400">Baseline</span> : `${Math.round(Number(r.improvement_rate) * 100)}%`}
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase ${STATUS_STYLE[r.status]}`}>
                      {STATUS_LABEL[r.status]}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Review side sheet */}
      {selected && (
        <ReviewSheet
          report={selected}
          publishing={publishing}
          onClose={() => setSelected(null)}
          onPublish={(action) => publish(selected, action)}
        />
      )}
    </div>
  );
}

// ---------- the review side sheet ----------
function ReviewSheet({
  report, publishing, onClose, onPublish,
}: {
  report: WeeklyReport;
  publishing: boolean;
  onClose: () => void;
  onPublish: (action: 'publish' | 'unpublish') => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-gray-50 h-full shadow-xl overflow-y-auto flex flex-col">
        {/* header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-gray-900">{report.full_name}</h2>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase ${STATUS_STYLE[report.status]}`}>
                {STATUS_LABEL[report.status]}
              </span>
            </div>
            <p className="text-xs text-gray-500">
              {fmtRange(report.week_start, report.week_end)} · {report.calls_count} calls · score{' '}
              {report.avg_score == null ? '—' : Number(report.avg_score).toFixed(1)}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">✕</button>
        </div>

        {/* body */}
        <div className="p-6 space-y-4 flex-1">
          {/* improvement summary */}
          {report.improvement && report.improvement.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="text-xs uppercase tracking-wide text-gray-400 mb-2">
                Improvement vs last week · {report.improvement_rate == null ? '—' : `${Math.round(Number(report.improvement_rate) * 100)}%`}
              </div>
              <div className="flex flex-wrap gap-2">
                {report.improvement.map((imp, i) => (
                  <span key={i} className={`text-xs px-2 py-1 rounded-full font-medium ${VERDICT_STYLE[imp.verdict]}`} title={imp.evidence}>
                    {imp.verdict === 'improved' ? '✓' : imp.verdict === 'regressed' ? '↓' : '–'} {imp.prev_title}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* strengths */}
          {report.strengths && report.strengths.length > 0 && (
            <div className="bg-green-50 rounded-xl border border-green-200 p-4">
              <h3 className="text-sm font-bold text-green-900 mb-2">Strengths</h3>
              {report.strengths.map((s, i) => (
                <div key={i} className="mb-2 last:mb-0">
                  <div className="text-sm font-semibold text-green-800">{s.title}</div>
                  <p className="text-xs text-gray-600 italic">“{s.evidence}”</p>
                </div>
              ))}
            </div>
          )}

          {/* weaknesses */}
          {report.weaknesses && report.weaknesses.length > 0 && (
            <div className="bg-amber-50 rounded-xl border border-amber-200 p-4">
              <h3 className="text-sm font-bold text-amber-900 mb-2">Weaknesses</h3>
              {report.weaknesses.map((w, i) => (
                <div key={i} className="mb-3 last:mb-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">{w.title}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase font-semibold ${SEVERITY_STYLE[w.severity] || ''}`}>{w.severity}</span>
                    <span className="text-[10px] text-gray-400 font-mono">{w.id}</span>
                  </div>
                  <p className="text-xs text-gray-600 italic mt-0.5">“{w.evidence}”</p>
                  <div className="mt-1 text-xs bg-white/70 rounded px-2 py-1 border border-amber-200">
                    <span className="font-semibold text-amber-700">Fix: </span>{w.recommended_fix}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* scripts */}
          {report.custom_scripts && report.custom_scripts.length > 0 && (
            <div className="bg-blue-50 rounded-xl border border-blue-200 p-4">
              <h3 className="text-sm font-bold text-blue-900 mb-2">Custom Scripts</h3>
              {report.custom_scripts.map((s, i) => (
                <div key={i} className="mb-2 last:mb-0 bg-white rounded-lg border border-blue-100 p-3">
                  <div className="text-[11px] font-semibold uppercase text-blue-500 mb-0.5">When they say: {s.objection}</div>
                  <p className="text-sm text-gray-800">“{s.suggested_script}”</p>
                </div>
              ))}
            </div>
          )}

          {/* narrative */}
          {report.narrative && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="text-sm font-bold text-gray-900 mb-1">Coach's Note</h3>
              <p className="text-sm text-gray-700 leading-relaxed">{report.narrative}</p>
            </div>
          )}
        </div>

        {/* sticky publish footer */}
        <div className="sticky bottom-0 bg-white border-t border-gray-200 px-6 py-4">
          {report.status === 'published' ? (
            <div className="flex items-center justify-between">
              <span className="text-sm text-green-700 font-medium">✓ Published — visible to {report.full_name}</span>
              <button
                onClick={() => onPublish('unpublish')}
                disabled={publishing}
                className="text-xs text-gray-500 hover:text-gray-800 disabled:opacity-50"
              >
                {publishing ? 'Working…' : 'Unpublish'}
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">
                {report.status === 'low_data'
                  ? 'Low-data week — publishing is optional.'
                  : 'Not yet visible to the agent.'}
              </span>
              <button
                onClick={() => onPublish('publish')}
                disabled={publishing}
                className="bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg px-5 py-2.5 disabled:opacity-50 shadow-sm"
              >
                {publishing ? 'Publishing…' : '🚀 Publish to Agent'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
