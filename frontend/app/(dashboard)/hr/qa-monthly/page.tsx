'use client';

import { useEffect, useState, useCallback } from 'react';

interface ScorePoint { week_start: string; avg_score: number | null; }
interface Persistent { id: string; title: string; weeks: number; }
interface MonthlyReport {
  id: number;
  agent_id: number;
  full_name: string;
  extension_number: string;
  month: string;
  weeks_count: number;
  avg_score: number | string | null;
  score_trend: ScorePoint[] | null;
  persistent_weaknesses: Persistent[] | null;
  improvement_rate: number | string | null;
  trajectory: 'improving' | 'flat' | 'declining' | 'low_data';
  narrative: string;
}

// ---------- helpers ----------
const fmtMonth = (m: string) =>
  new Date((m || '').slice(0, 10) + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const scoreColor = (n: number | string | null) => {
  if (n == null) return 'text-gray-400';
  const v = Number(n);
  return v >= 7 ? 'text-green-600' : v >= 4 ? 'text-amber-600' : 'text-red-600';
};
const TRAJ: Record<string, { label: string; style: string; icon: string }> = {
  improving: { label: 'Improving', style: 'bg-green-100 text-green-700', icon: '↗' },
  flat:      { label: 'Flat',      style: 'bg-gray-100 text-gray-600',  icon: '→' },
  declining: { label: 'Declining', style: 'bg-red-100 text-red-700',    icon: '↘' },
  low_data:  { label: 'Low Data',  style: 'bg-gray-200 text-gray-500',  icon: '–' },
};

// ============================================================
export default function QaMonthlyPage() {
  const [months, setMonths] = useState<{ month: string }[]>([]);
  const [month, setMonth] = useState('');
  const [reports, setReports] = useState<MonthlyReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<MonthlyReport | null>(null);

  const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

  const load = useCallback(async (m?: string) => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/hr/qa-monthly${m ? `?month=${m}` : ''}`, { headers: authHeaders() });
      const json = await res.json();
      if (json.status !== 'success') throw new Error(json.message || 'Failed to load');
      setMonths(json.months || []);
      setMonth(json.month || '');
      setReports(json.reports || []);
    } catch (e: any) {
      setError(e.message); setReports([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Monthly Trajectory</h1>
          <p className="text-sm text-gray-500">Long-term agent performance trends for reviews.</p>
        </div>
        {months.length > 0 && (
          <select
            value={month}
            onChange={(e) => { setMonth(e.target.value); load(e.target.value); }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
          >
            {months.map((m) => <option key={m.month} value={m.month}>{fmtMonth(m.month)}</option>)}
          </select>
        )}
      </div>

      {error && <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm border border-red-200">{error}</div>}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 uppercase text-[11px] tracking-wide">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Agent</th>
              <th className="text-center px-3 py-3 font-medium">Ext</th>
              <th className="text-center px-3 py-3 font-medium">Weeks</th>
              <th className="text-center px-3 py-3 font-medium">Avg Score</th>
              <th className="text-center px-3 py-3 font-medium">Improvement</th>
              <th className="text-center px-3 py-3 font-medium">Persistent Issues</th>
              <th className="text-center px-3 py-3 font-medium">Trajectory</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={7} className="text-center py-10 text-gray-400">Loading…</td></tr>
            ) : reports.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-10 text-gray-400">No monthly reports yet.</td></tr>
            ) : (
              reports.map((r) => {
                const traj = TRAJ[r.trajectory] || TRAJ.low_data;
                return (
                  <tr key={r.id} onClick={() => setSelected(r)} className="hover:bg-blue-50/60 cursor-pointer transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900">{r.full_name}</td>
                    <td className="px-3 py-3 text-center text-gray-500">{r.extension_number}</td>
                    <td className="px-3 py-3 text-center text-gray-700">{r.weeks_count}</td>
                    <td className={`px-3 py-3 text-center font-bold ${scoreColor(r.avg_score)}`}>
                      {r.avg_score == null ? '—' : Number(r.avg_score).toFixed(1)}
                    </td>
                    <td className="px-3 py-3 text-center text-gray-700">
                      {r.improvement_rate == null ? '—' : `${Math.round(Number(r.improvement_rate) * 100)}%`}
                    </td>
                    <td className="px-3 py-3 text-center text-gray-700">{(r.persistent_weaknesses || []).length}</td>
                    <td className="px-3 py-3 text-center">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold uppercase ${traj.style}`}>
                        {traj.icon} {traj.label}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* detail side sheet */}
      {selected && <MonthlySheet report={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function MonthlySheet({ report, onClose }: { report: MonthlyReport; onClose: () => void }) {
  const traj = TRAJ[report.trajectory] || TRAJ.low_data;
  const trend = report.score_trend || [];
  const maxScore = 10;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-xl bg-gray-50 h-full shadow-xl overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-gray-900">{report.full_name}</h2>
              <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold uppercase ${traj.style}`}>{traj.icon} {traj.label}</span>
            </div>
            <p className="text-xs text-gray-500">{fmtMonth(report.month)} · {report.weeks_count} weeks · avg {report.avg_score == null ? '—' : Number(report.avg_score).toFixed(1)}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">✕</button>
        </div>

        <div className="p-6 space-y-4">
          {/* score trend bars */}
          {trend.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="text-sm font-bold text-gray-900 mb-3">Weekly score trend</h3>
              <div className="flex items-end gap-3 h-32">
                {trend.map((p, i) => {
                  const v = p.avg_score == null ? 0 : Number(p.avg_score);
                  const h = Math.max(4, (v / maxScore) * 100);
                  const color = v >= 7 ? 'bg-green-400' : v >= 4 ? 'bg-amber-400' : 'bg-red-400';
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center justify-end">
                      <span className="text-[10px] text-gray-500 mb-1">{p.avg_score == null ? '—' : v.toFixed(1)}</span>
                      <div className={`w-full rounded-t ${color}`} style={{ height: `${h}%` }} />
                      <span className="text-[9px] text-gray-400 mt-1">{p.week_start.slice(5)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* persistent weaknesses */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-bold text-gray-900 mb-2">Persistent weaknesses</h3>
            {(report.persistent_weaknesses || []).length === 0 ? (
              <p className="text-xs text-gray-500">None recurred across multiple weeks. 🎉</p>
            ) : (
              <div className="space-y-1.5">
                {report.persistent_weaknesses!.map((p, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="text-gray-800">{p.title} <span className="text-[10px] text-gray-400 font-mono">{p.id}</span></span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-semibold">{p.weeks} weeks</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* narrative */}
          {report.narrative && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="text-sm font-bold text-gray-900 mb-1">Manager summary</h3>
              <p className="text-sm text-gray-700 leading-relaxed">{report.narrative}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
