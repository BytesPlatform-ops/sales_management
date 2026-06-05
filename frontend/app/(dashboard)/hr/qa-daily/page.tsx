'use client';

import { useEffect, useState, useCallback } from 'react';

// ---------- types ----------
interface RollupRow {
  agent_id: number;
  full_name: string;
  extension_number: string;
  calls_total: number | null;
  calls_evaluated: number | null;
  avg_engagement: number | null;
  avg_technical: number | null;
  avg_objection: number | null;
  meetings_scheduled: number | null;
  daily_score: number | null;
  summary: string | null;
}

interface EvaluationRow {
  id: number;
  threecx_rec_id: number;
  customer_number: string | null;
  call_started_at: string;
  duration_sec: number;
  call_type: string | null;
  talk_ratio: number | null;
  engagement: number | null;
  technical_knowledge: number | null;
  objection_handling: number | null;
  meeting_scheduled: boolean | null;
  overall_score: number | null;
  reasons: Record<string, string> | null;
  evidence: Array<{ dimension: string; quote: string; speaker: string; rationale: string }> | null;
  not_evaluable: boolean;
  not_evaluable_reason: string | null;
  transcript: string | null;
  flag_verdict: string | null;
  flag_dimension: string | null;
  flag_note: string | null;
}

// ---------- helpers ----------
function yesterdayShift(): string {
  // 9 PM pivot: before 6 AM PKT we're still in yesterday's shift.
  const now = new Date();
  const d = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const hour = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Karachi', hour: 'numeric', hour12: false }).format(now), 10
  );
  const [y, m, day] = d.split('-').map(Number);
  // default the picker to the most recent COMPLETED shift = yesterday's start date
  const offset = hour < 6 ? 2 : 1;
  const t = new Date(y, m - 1, day - offset);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

const fmtScore = (n: number | null) => (n == null ? '—' : Number(n).toFixed(1));
const fmtDuration = (s: number) => `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
const fmtTime = (iso: string) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', hour12: true,
  }).format(new Date(iso));

function scoreColor(n: number | string | null): string {
  if (n == null) return 'text-gray-400';
  const v = Number(n);
  if (v >= 7) return 'text-green-600';
  if (v >= 4) return 'text-amber-600';
  return 'text-red-600';
}

const DIMENSION_LABEL: Record<string, string> = {
  engagement: 'Engagement',
  technical_knowledge: 'Technical Knowledge',
  objection_handling: 'Objection Handling',
  meeting_scheduled: 'Meeting Scheduled',
};

// ============================================================
export default function QaDailyPage() {
  const [date, setDate] = useState<string>(yesterdayShift());
  const [rollup, setRollup] = useState<RollupRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // drill-down state
  const [selectedAgent, setSelectedAgent] = useState<RollupRow | null>(null);
  const [evaluations, setEvaluations] = useState<EvaluationRow[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);

  const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

  const loadRollup = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/hr/qa-daily?date=${date}`, { headers: authHeaders() });
      const json = await res.json();
      if (json.status !== 'success') throw new Error(json.message || 'Failed to load');
      setRollup(json.rollup || []);
    } catch (e: any) {
      setError(e.message);
      setRollup([]);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { loadRollup(); }, [loadRollup]);

  const openDrillDown = async (agent: RollupRow) => {
    setSelectedAgent(agent);
    setDrillLoading(true);
    setEvaluations([]);
    try {
      const res = await fetch(`/api/hr/qa-daily?date=${date}&agentId=${agent.agent_id}`, {
        headers: authHeaders(),
      });
      const json = await res.json();
      if (json.status === 'success') setEvaluations(json.evaluations || []);
    } finally {
      setDrillLoading(false);
    }
  };

  const closeDrillDown = () => { setSelectedAgent(null); setEvaluations([]); };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header + date picker */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Daily Call QA</h1>
          <p className="text-sm text-gray-500">AI-graded call scores by agent. Click a row to review the evidence.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-600">Shift date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm border border-red-200">{error}</div>
      )}

      {/* Roll-up table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 uppercase text-[11px] tracking-wide">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Agent</th>
              <th className="text-center px-3 py-3 font-medium">Ext</th>
              <th className="text-center px-3 py-3 font-medium">Calls</th>
              <th className="text-center px-3 py-3 font-medium">Evaluated</th>
              <th className="text-center px-3 py-3 font-medium">Engagement</th>
              <th className="text-center px-3 py-3 font-medium">Technical</th>
              <th className="text-center px-3 py-3 font-medium">Objection</th>
              <th className="text-center px-3 py-3 font-medium">Meetings</th>
              <th className="text-center px-3 py-3 font-medium">Overall</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={9} className="text-center py-10 text-gray-400">Loading…</td></tr>
            ) : rollup.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-10 text-gray-400">No QA scores for this shift date yet.</td></tr>
            ) : (
              rollup.map((r) => (
                <tr
                  key={r.agent_id}
                  onClick={() => openDrillDown(r)}
                  className="hover:bg-blue-50/60 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3 font-medium text-gray-900">{r.full_name}</td>
                  <td className="px-3 py-3 text-center text-gray-500">{r.extension_number}</td>
                  <td className="px-3 py-3 text-center text-gray-700">{r.calls_total ?? '—'}</td>
                  <td className="px-3 py-3 text-center text-gray-700">{r.calls_evaluated ?? '—'}</td>
                  <td className={`px-3 py-3 text-center font-semibold ${scoreColor(r.avg_engagement)}`}>{fmtScore(r.avg_engagement)}</td>
                  <td className={`px-3 py-3 text-center font-semibold ${scoreColor(r.avg_technical)}`}>{fmtScore(r.avg_technical)}</td>
                  <td className={`px-3 py-3 text-center font-semibold ${scoreColor(r.avg_objection)}`}>{fmtScore(r.avg_objection)}</td>
                  <td className="px-3 py-3 text-center text-gray-700">{r.meetings_scheduled ?? 0}</td>
                  <td className={`px-3 py-3 text-center font-bold ${scoreColor(r.daily_score)}`}>{fmtScore(r.daily_score)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Drill-down side sheet */}
      {selectedAgent && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={closeDrillDown} />
          <div className="relative w-full max-w-2xl bg-gray-50 h-full shadow-xl overflow-y-auto">
            {/* sheet header */}
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-900">{selectedAgent.full_name}</h2>
                <p className="text-xs text-gray-500">Ext {selectedAgent.extension_number} · {date} · {evaluations.length} calls</p>
              </div>
              <button onClick={closeDrillDown} className="text-gray-400 hover:text-gray-700 text-xl leading-none">✕</button>
            </div>

            <div className="p-6 space-y-4">
              {drillLoading ? (
                <p className="text-center text-gray-400 py-10">Loading calls…</p>
              ) : evaluations.length === 0 ? (
                <p className="text-center text-gray-400 py-10">No evaluations found.</p>
              ) : (
                evaluations.map((ev) => <CallCard key={ev.id} ev={ev} authHeaders={authHeaders} />)
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ScoreChip({ label, value }: { label: string; value: number | null }) {
  const color =
    value == null ? 'text-gray-400' : value >= 7 ? 'text-green-600' : value >= 4 ? 'text-amber-600' : 'text-red-600';
  return (
    <div className="rounded-lg border border-gray-100 p-2 text-center">
      <div className="text-[10px] uppercase text-gray-400">{label}</div>
      <div className={`text-sm font-bold ${color}`}>{value == null ? '—' : `${value}/10`}</div>
    </div>
  );
}

const VERDICTS = [
  { value: 'too_high', label: 'Score too high' },
  { value: 'too_low', label: 'Score too low' },
  { value: 'incorrect', label: 'Just wrong' },
];
const FLAG_DIMENSIONS = [
  { value: 'overall', label: 'Overall' },
  { value: 'engagement', label: 'Engagement' },
  { value: 'technical_knowledge', label: 'Technical' },
  { value: 'objection_handling', label: 'Objection' },
  { value: 'meeting_scheduled', label: 'Meeting' },
];

function CallCard({
  ev,
  authHeaders,
}: {
  ev: EvaluationRow;
  authHeaders: () => Record<string, string>;
}) {
  const [showTranscript, setShowTranscript] = useState(false);
  const [showFlagForm, setShowFlagForm] = useState(false);
  const [verdict, setVerdict] = useState(ev.flag_verdict || 'too_high');
  const [dimension, setDimension] = useState(ev.flag_dimension || 'overall');
  const [note, setNote] = useState(ev.flag_note || '');
  const [flagged, setFlagged] = useState(!!ev.flag_verdict);
  const [saving, setSaving] = useState(false);

  const submitFlag = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/hr/qa-daily/flag', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ evaluationId: ev.id, verdict, dimension, note }),
      });
      if ((await res.json()).status === 'success') {
        setFlagged(true);
        setShowFlagForm(false);
      }
    } finally {
      setSaving(false);
    }
  };

  const removeFlag = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/hr/qa-daily/flag?evaluationId=${ev.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if ((await res.json()).status === 'success') setFlagged(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`bg-white rounded-xl border shadow-sm overflow-hidden ${flagged ? 'border-amber-300' : 'border-gray-200'}`}>
      {/* call header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="text-sm">
          <span className="font-semibold text-gray-900">{fmtTime(ev.call_started_at)}</span>
          <span className="text-gray-400"> · {ev.customer_number || 'unknown'} · {fmtDuration(ev.duration_sec)}</span>
        </div>
        <div className="flex items-center gap-2">
          {flagged && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold">FLAGGED</span>
          )}
          {ev.talk_ratio != null && (
            <span className="text-[11px] text-gray-400">talk {Math.round(ev.talk_ratio * 100)}%</span>
          )}
        </div>
      </div>

      {ev.not_evaluable ? (
        <div className="px-4 py-4 text-sm text-gray-500 italic">
          Not evaluable — {ev.not_evaluable_reason || 'n/a'}
        </div>
      ) : (
        <div className="p-4 space-y-4">
          {/* score chips */}
          <div className="grid grid-cols-4 gap-2">
            <ScoreChip label="Engage" value={ev.engagement} />
            <ScoreChip label="Technical" value={ev.technical_knowledge} />
            <ScoreChip label="Objection" value={ev.objection_handling} />
            <div className="rounded-lg border border-gray-100 p-2 text-center">
              <div className="text-[10px] uppercase text-gray-400">Meeting</div>
              <div className={`text-sm font-bold ${ev.meeting_scheduled ? 'text-green-600' : 'text-gray-400'}`}>
                {ev.meeting_scheduled ? 'Yes' : 'No'}
              </div>
            </div>
          </div>

          {/* reasons */}
          {ev.reasons && (
            <div className="space-y-1.5">
              {Object.entries(ev.reasons).map(([dim, text]) => (
                <div key={dim} className="text-xs">
                  <span className="font-semibold text-gray-700">{DIMENSION_LABEL[dim] || dim}: </span>
                  <span className="text-gray-600">{text}</span>
                </div>
              ))}
            </div>
          )}

          {/* evidence quotes */}
          {ev.evidence && ev.evidence.length > 0 && (
            <div className="space-y-2 pt-1">
              <div className="text-[10px] uppercase text-gray-400 tracking-wide">Evidence</div>
              {ev.evidence.map((q, i) => (
                <div key={i} className="border-l-2 border-blue-300 bg-blue-50/50 pl-3 pr-2 py-2 rounded-r">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[10px] font-semibold uppercase text-blue-600">{DIMENSION_LABEL[q.dimension] || q.dimension}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${q.speaker === 'agent' ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-200 text-gray-600'}`}>
                      {q.speaker}
                    </span>
                  </div>
                  <p className="text-sm text-gray-800 italic">“{q.quote}”</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">{q.rationale}</p>
                </div>
              ))}
            </div>
          )}

          {/* action bar */}
          <div className="flex items-center gap-3 pt-1 border-t border-gray-100">
            {ev.transcript && (
              <button
                onClick={() => setShowTranscript((s) => !s)}
                className="text-xs text-blue-600 hover:text-blue-800 font-medium mt-3"
              >
                {showTranscript ? 'Hide transcript' : 'View transcript'}
              </button>
            )}
            <button
              onClick={() => (flagged ? removeFlag() : setShowFlagForm((s) => !s))}
              disabled={saving}
              className={`text-xs font-medium mt-3 ${flagged ? 'text-amber-600 hover:text-amber-800' : 'text-gray-500 hover:text-gray-800'}`}
            >
              {flagged ? 'Remove flag' : 'Flag AI error'}
            </button>
          </div>

          {/* transcript expander */}
          {showTranscript && ev.transcript && (
            <pre className="text-xs text-gray-700 bg-gray-50 border border-gray-100 rounded-lg p-3 whitespace-pre-wrap max-h-72 overflow-y-auto">
              {ev.transcript}
            </pre>
          )}

          {/* flag form */}
          {showFlagForm && !flagged && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
              <div className="flex gap-2">
                <select
                  value={dimension}
                  onChange={(e) => setDimension(e.target.value)}
                  className="text-xs border border-gray-300 rounded px-2 py-1 flex-1"
                >
                  {FLAG_DIMENSIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
                <select
                  value={verdict}
                  onChange={(e) => setVerdict(e.target.value)}
                  className="text-xs border border-gray-300 rounded px-2 py-1 flex-1"
                >
                  {VERDICTS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
                </select>
              </div>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What did the AI get wrong? (optional, helps rubric tuning)"
                className="w-full text-xs border border-gray-300 rounded px-2 py-1 h-16 resize-none"
              />
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowFlagForm(false)} className="text-xs text-gray-500 px-2 py-1">Cancel</button>
                <button
                  onClick={submitFlag}
                  disabled={saving}
                  className="text-xs bg-amber-600 text-white rounded px-3 py-1 hover:bg-amber-700 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save flag'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
