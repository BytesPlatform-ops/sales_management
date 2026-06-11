'use client';

import { useEffect, useState, useCallback } from 'react';
import { RubricLegend, CoachingBlock } from '@/components/qa/scorecard-ui';

// ---------- types ----------
interface RollupRow {
  agent_id: number;
  full_name: string;
  extension_number: string;
  calls_total: number | null;
  calls_evaluated: number | null;
  meetings_scheduled: number | null;
  daily_score: number | null;
  metrics: Record<string, number> | null;
}

interface Scorecard {
  rubric?: 'cold' | 'discovery';
  attribution_confidence: 'low' | 'medium' | 'high';
  reconstructed_turns: Array<{ speaker: string; text: string }>;
  // shared
  up_front_contract: number | null;
  objection_validation: number | null;
  firm_future_commit: boolean;
  // cold-only
  rapport_tone?: number | null;
  explicit_ask?: boolean;
  // discovery-only
  pain_identification?: number | null;
  cost_of_inaction?: number | null;
  budget_qualification?: number | null;
  timeline_urgency?: number | null;
  feature_to_value?: number | null;
  decision_maker_discovery?: boolean;
  evidence: Array<{ parameter: string; quote: string; attributed_to: string; rationale: string }>;
  summary: string;
}

interface EvaluationRow {
  id: number;
  threecx_rec_id: number;
  customer_number: string | null;
  call_started_at: string;
  duration_sec: number;
  call_type: string | null;
  overall_score: number | string | null;
  meeting_scheduled: boolean | null;
  not_evaluable: boolean;
  not_evaluable_reason: string | null;
  transcript: string | null;
  scorecard: Scorecard | null;
  disposition: string | null;
  attribution_confidence: string | null;
  flag_verdict: string | null;
  flag_note: string | null;
}

// ---------- v3 dual-rubric display config (cold vs discovery) ----------
const COLD_NUMERIC: Array<[keyof Scorecard, string]> = [
  ['up_front_contract', 'Up-Front Contract'],
  ['rapport_tone', 'Rapport / Tone'],
  ['objection_validation', 'Objection Handling'],
];
const COLD_BOOL: Array<[keyof Scorecard, string]> = [
  ['explicit_ask', 'Asked for Meeting'],
  ['firm_future_commit', 'Meeting Booked'],
];
const DISCOVERY_NUMERIC: Array<[keyof Scorecard, string]> = [
  ['up_front_contract', 'Up-Front Contract'],
  ['pain_identification', 'Pain ID'],
  ['cost_of_inaction', 'Cost of Inaction'],
  ['budget_qualification', 'Budget Qual'],
  ['timeline_urgency', 'Timeline / Urgency'],
  ['feature_to_value', 'Feature → Value'],
  ['objection_validation', 'Objection Handling'],
];
const DISCOVERY_BOOL: Array<[keyof Scorecard, string]> = [
  ['decision_maker_discovery', 'Decision-Maker Disc.'],
  ['firm_future_commit', 'Meeting Booked'],
];

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
const fmtScore = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toFixed(1));
const fmtDuration = (s: number) => `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
const fmtTime = (iso: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(iso));
function scoreColor(n: number | string | null | undefined): string {
  if (n == null) return 'text-gray-400';
  const v = Number(n);
  return v >= 7 ? 'text-green-600' : v >= 4 ? 'text-amber-600' : 'text-red-600';
}
const CONF_STYLE: Record<string, string> = { high: 'bg-green-100 text-green-700', medium: 'bg-amber-100 text-amber-700', low: 'bg-red-100 text-red-700' };

// ============================================================
export default function QaDailyPage() {
  const [date, setDate] = useState<string>(yesterdayShift());
  const [rollup, setRollup] = useState<RollupRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<RollupRow | null>(null);
  const [evaluations, setEvaluations] = useState<EvaluationRow[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);

  const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

  const loadRollup = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/hr/qa-daily?date=${date}`, { headers: authHeaders() });
      const json = await res.json();
      if (json.status !== 'success') throw new Error(json.message || 'Failed to load');
      setRollup(json.rollup || []);
    } catch (e: any) { setError(e.message); setRollup([]); }
    finally { setLoading(false); }
  }, [date]);

  useEffect(() => { loadRollup(); }, [loadRollup]);

  const openDrillDown = async (agent: RollupRow) => {
    setSelectedAgent(agent); setDrillLoading(true); setEvaluations([]);
    try {
      const res = await fetch(`/api/hr/qa-daily?date=${date}&agentId=${agent.agent_id}`, { headers: authHeaders() });
      const json = await res.json();
      if (json.status === 'success') setEvaluations(json.evaluations || []);
    } finally { setDrillLoading(false); }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Daily Call QA <span className="text-xs font-medium text-gray-400 align-middle">rubric v3 · dual</span></h1>
          <p className="text-sm text-gray-500">AI-graded call scores by agent. Cold calls (&lt;3m) and discovery calls (≥3m) use different rubrics. Click a row for the full scorecard.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-600">Shift date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
        </div>
      </div>

      {error && <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm border border-red-200">{error}</div>}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 uppercase text-[11px] tracking-wide">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Agent</th>
              <th className="text-center px-3 py-3 font-medium">Ext</th>
              <th className="text-center px-3 py-3 font-medium">Calls</th>
              <th className="text-center px-3 py-3 font-medium">Graded</th>
              <th className="text-center px-3 py-3 font-medium">Opener</th>
              <th className="text-center px-3 py-3 font-medium">Objection</th>
              <th className="text-center px-3 py-3 font-medium">Meetings</th>
              <th className="text-center px-3 py-3 font-medium">Overall</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={8} className="text-center py-10 text-gray-400">Loading…</td></tr>
            ) : rollup.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-10 text-gray-400">No QA scores for this shift date yet.</td></tr>
            ) : (
              rollup.map((r) => {
                const lowSample = (r.calls_evaluated ?? 0) > 0 && (r.calls_evaluated ?? 0) < 3;
                return (
                <tr key={r.agent_id} onClick={() => openDrillDown(r)} className="hover:bg-blue-50/60 cursor-pointer transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">{r.full_name}</td>
                  <td className="px-3 py-3 text-center text-gray-500">{r.extension_number}</td>
                  <td className="px-3 py-3 text-center text-gray-700">{r.calls_total ?? '—'}</td>
                  <td className="px-3 py-3 text-center text-gray-700">
                    {r.calls_evaluated ?? '—'}
                    {lowSample && <span title="Daily score is based on very few graded calls — treat as low-confidence" className="ml-1 text-[9px] px-1 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold align-middle">low n</span>}
                  </td>
                  <td className={`px-3 py-3 text-center font-semibold ${scoreColor(r.metrics?.up_front_contract)}`}>{fmtScore(r.metrics?.up_front_contract)}</td>
                  <td className={`px-3 py-3 text-center font-semibold ${scoreColor(r.metrics?.objection_validation)}`}>{fmtScore(r.metrics?.objection_validation)}</td>
                  <td className="px-3 py-3 text-center text-gray-700">{r.meetings_scheduled ?? 0}</td>
                  <td className={`px-3 py-3 text-center font-bold ${scoreColor(r.daily_score)}`}>{fmtScore(r.daily_score)}</td>
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ---------- transparency / how-scoring-works panel ---------- */}
      <RubricLegend />

      {selectedAgent && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => setSelectedAgent(null)} />
          <div className="relative w-full max-w-2xl bg-gray-50 h-full shadow-xl overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
              <div>
                <h2 className="text-lg font-bold text-gray-900">{selectedAgent.full_name}</h2>
                <p className="text-xs text-gray-500">Ext {selectedAgent.extension_number} · {date} · {evaluations.length} calls</p>
              </div>
              <button onClick={() => setSelectedAgent(null)} className="text-gray-400 hover:text-gray-700 text-xl leading-none">✕</button>
            </div>
            <div className="p-6 space-y-4">
              {drillLoading ? (
                <p className="text-center text-gray-400 py-10">Loading calls…</p>
              ) : evaluations.length === 0 ? (
                <p className="text-center text-gray-400 py-10">No evaluations found.</p>
              ) : (
                <DrillBody evaluations={evaluations} authHeaders={authHeaders} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- drill-down body: graded calls + collapsed not-evaluable summary ----------
function DrillBody({ evaluations, authHeaders }: { evaluations: EvaluationRow[]; authHeaders: () => Record<string, string> }) {
  const [showSkipped, setShowSkipped] = useState(false);
  const graded = evaluations.filter((e) => !e.not_evaluable);
  const skipped = evaluations.filter((e) => e.not_evaluable);

  // tally skip reasons for the summary line
  const reasons: Record<string, number> = {};
  for (const e of skipped) {
    const r = e.disposition && e.disposition !== 'connected_conversation' ? e.disposition : (e.not_evaluable_reason || 'other');
    reasons[r] = (reasons[r] || 0) + 1;
  }
  const reasonSummary = Object.entries(reasons).sort((a, b) => b[1] - a[1]).map(([r, n]) => `${n} ${r.replace(/_/g, ' ')}`).join(' · ');

  return (
    <>
      {graded.length === 0 && (
        <p className="text-center text-gray-400 py-6 text-sm">No gradeable conversations this shift — all calls were unanswered, voicemail, or too short.</p>
      )}
      {graded.map((ev) => <CallCard key={ev.id} ev={ev} authHeaders={authHeaders} />)}

      {skipped.length > 0 && (
        <div className="mt-2">
          <button
            onClick={() => setShowSkipped((s) => !s)}
            className="w-full text-left text-xs text-gray-500 bg-gray-100 hover:bg-gray-200 rounded-lg px-3 py-2 transition-colors"
          >
            {showSkipped ? '▾' : '▸'} {skipped.length} not-evaluable calls (not scored) — {reasonSummary}
          </button>
          {showSkipped && (
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
      )}
    </>
  );
}

// ---------- score chip ----------
function Chip({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-lg border border-gray-100 p-2 text-center">
      <div className="text-[10px] uppercase text-gray-400 leading-tight">{label}</div>
      <div className={`text-sm font-bold ${scoreColor(value)}`}>{value == null ? '—' : `${value}/10`}</div>
    </div>
  );
}
function BoolChip({ label, value }: { label: string; value: boolean | null }) {
  const txt = value == null ? 'n/a' : value ? 'Yes' : 'No';
  const col = value == null ? 'text-gray-400' : value ? 'text-green-600' : 'text-red-600';
  return (
    <div className="rounded-lg border border-gray-100 p-2 text-center">
      <div className="text-[10px] uppercase text-gray-400 leading-tight">{label}</div>
      <div className={`text-sm font-bold ${col}`}>{txt}</div>
    </div>
  );
}

// ---------- per-call card (v2 scorecard) ----------
function CallCard({ ev, authHeaders }: { ev: EvaluationRow; authHeaders: () => Record<string, string> }) {
  const [showTranscript, setShowTranscript] = useState(false);
  const [showTurns, setShowTurns] = useState(false);
  const [showFlag, setShowFlag] = useState(false);
  const [verdict, setVerdict] = useState(ev.flag_verdict || 'too_high');
  const [note, setNote] = useState(ev.flag_note || '');
  const [flagged, setFlagged] = useState(!!ev.flag_verdict);
  const [saving, setSaving] = useState(false);
  const sc = ev.scorecard;
  // route the card layout by which rubric graded this call (fall back to duration if untagged)
  const isCold = sc ? (sc.rubric ? sc.rubric === 'cold' : ev.duration_sec < 180) : false;
  const numericDims = isCold ? COLD_NUMERIC : DISCOVERY_NUMERIC;
  const boolDims = isCold ? COLD_BOOL : DISCOVERY_BOOL;

  const submitFlag = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/hr/qa-daily/flag', {
        method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ evaluationId: ev.id, verdict, dimension: 'overall', note }),
      });
      if ((await res.json()).status === 'success') { setFlagged(true); setShowFlag(false); }
    } finally { setSaving(false); }
  };
  const removeFlag = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/hr/qa-daily/flag?evaluationId=${ev.id}`, { method: 'DELETE', headers: authHeaders() });
      if ((await res.json()).status === 'success') setFlagged(false);
    } finally { setSaving(false); }
  };

  return (
    <div className={`bg-white rounded-xl border shadow-sm overflow-hidden ${flagged ? 'border-amber-300' : 'border-gray-200'}`}>
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="text-sm">
          <span className="font-semibold text-gray-900">{fmtTime(ev.call_started_at)}</span>
          <span className="text-gray-400"> · {ev.customer_number || 'unknown'} · {fmtDuration(ev.duration_sec)}</span>
        </div>
        <div className="flex items-center gap-2">
          {flagged && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold">FLAGGED</span>}
          {!ev.not_evaluable && sc && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${scoreColor(ev.overall_score)}`}>{fmtScore(ev.overall_score)}/10</span>
          )}
        </div>
      </div>

      {ev.not_evaluable ? (
        <div className="px-4 py-4 text-sm text-gray-500 italic">
          Not evaluable — {ev.disposition || ev.not_evaluable_reason || 'n/a'}
        </div>
      ) : !sc ? (
        <div className="px-4 py-4 text-sm text-gray-500 italic">No scorecard (legacy evaluation).</div>
      ) : (
        <div className="p-4 space-y-4">
          {/* attribution confidence + rubric banner */}
          <div className="flex items-center gap-2 text-xs flex-wrap">
            <span className={`px-1.5 py-0.5 rounded font-semibold uppercase ${isCold ? 'bg-sky-100 text-sky-700' : 'bg-violet-100 text-violet-700'}`}>
              {isCold ? 'Cold call' : 'Discovery'}
            </span>
            <span className="text-gray-400">Speaker attribution:</span>
            <span className={`px-1.5 py-0.5 rounded font-semibold uppercase ${CONF_STYLE[sc.attribution_confidence] || ''}`}>{sc.attribution_confidence}</span>
          </div>

          {/* numeric dimensions (per-rubric) */}
          <div className="grid grid-cols-3 gap-2">
            {numericDims.map(([k, label]) => <Chip key={k} label={label} value={(sc[k] as number | null) ?? null} />)}
          </div>
          {/* boolean outcomes (per-rubric) */}
          <div className="grid grid-cols-2 gap-2">
            {boolDims.map(([k, label]) => <BoolChip key={k} label={label} value={(sc[k] as boolean | null) ?? null} />)}
          </div>

          {/* evidence */}
          {sc.evidence?.length > 0 && (
            <div className="space-y-2 pt-1">
              <div className="text-[10px] uppercase text-gray-400 tracking-wide">Evidence</div>
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
          <CoachingBlock coaching={(sc as any).coaching} />

          {/* actions */}
          <div className="flex items-center gap-3 pt-1 border-t border-gray-100">
            {sc.reconstructed_turns?.length > 0 && (
              <button onClick={() => setShowTurns((s) => !s)} className="text-xs text-blue-600 hover:text-blue-800 font-medium mt-3">
                {showTurns ? 'Hide attributed dialogue' : 'View attributed dialogue'}
              </button>
            )}
            {ev.transcript && (
              <button onClick={() => setShowTranscript((s) => !s)} className="text-xs text-blue-600 hover:text-blue-800 font-medium mt-3">
                {showTranscript ? 'Hide raw transcript' : 'Raw transcript'}
              </button>
            )}
            <button onClick={() => (flagged ? removeFlag() : setShowFlag((s) => !s))} disabled={saving} className={`text-xs font-medium mt-3 ${flagged ? 'text-amber-600 hover:text-amber-800' : 'text-gray-500 hover:text-gray-800'}`}>
              {flagged ? 'Remove flag' : 'Flag AI error'}
            </button>
          </div>

          {/* reconstructed dialogue */}
          {showTurns && sc.reconstructed_turns?.length > 0 && (
            <div className="text-xs bg-gray-50 border border-gray-100 rounded-lg p-3 max-h-72 overflow-y-auto space-y-1">
              {sc.reconstructed_turns.map((t, i) => (
                <div key={i}>
                  <span className={`font-semibold ${t.speaker === 'agent' ? 'text-indigo-600' : t.speaker === 'prospect' ? 'text-gray-700' : 'text-yellow-600'}`}>[{t.speaker}]</span>{' '}
                  <span className="text-gray-700">{t.text}</span>
                </div>
              ))}
            </div>
          )}
          {showTranscript && ev.transcript && (
            <pre className="text-xs text-gray-700 bg-gray-50 border border-gray-100 rounded-lg p-3 whitespace-pre-wrap max-h-72 overflow-y-auto">{ev.transcript}</pre>
          )}

          {/* flag form */}
          {showFlag && !flagged && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
              <select value={verdict} onChange={(e) => setVerdict(e.target.value)} className="text-xs border border-gray-300 rounded px-2 py-1 w-full">
                <option value="too_high">Overall score too high</option>
                <option value="too_low">Overall score too low</option>
                <option value="incorrect">Misread the call / wrong</option>
              </select>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did the AI get wrong? (helps rubric tuning)" className="w-full text-xs border border-gray-300 rounded px-2 py-1 h-16 resize-none" />
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowFlag(false)} className="text-xs text-gray-500 px-2 py-1">Cancel</button>
                <button onClick={submitFlag} disabled={saving} className="text-xs bg-amber-600 text-white rounded px-3 py-1 hover:bg-amber-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save flag'}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
