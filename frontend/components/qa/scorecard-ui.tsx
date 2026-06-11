'use client';

import { useState } from 'react';

// ============================================================
// Shared QA scorecard UI — used by both HR (/hr/qa-daily) and
// agent (/agent/daily-report) so the rubric display and the
// "How scoring works" transparency panel never drift apart.
// ============================================================

export interface Scorecard {
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
  coaching?: {
    did_well: string;
    key_fix: string;
    say_this_instead: Array<{ moment: string; rewrite: string; why: string }>;
    next_call_focus: string;
  };
}

// ---------- per-rubric dimension config ----------
export const COLD_NUMERIC: Array<[keyof Scorecard, string]> = [
  ['up_front_contract', 'Up-Front Contract'],
  ['rapport_tone', 'Rapport / Tone'],
  ['objection_validation', 'Objection Handling'],
];
export const COLD_BOOL: Array<[keyof Scorecard, string]> = [
  ['explicit_ask', 'Asked for Meeting'],
  ['firm_future_commit', 'Meeting Booked'],
];
export const DISCOVERY_NUMERIC: Array<[keyof Scorecard, string]> = [
  ['up_front_contract', 'Up-Front Contract'],
  ['pain_identification', 'Pain ID'],
  ['cost_of_inaction', 'Cost of Inaction'],
  ['budget_qualification', 'Budget Qual'],
  ['timeline_urgency', 'Timeline / Urgency'],
  ['feature_to_value', 'Feature → Value'],
  ['objection_validation', 'Objection Handling'],
];
export const DISCOVERY_BOOL: Array<[keyof Scorecard, string]> = [
  ['decision_maker_discovery', 'Decision-Maker Disc.'],
  ['firm_future_commit', 'Meeting Booked'],
];

// ---------- formatting helpers ----------
export const fmtScore = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toFixed(1));
export const fmtDuration = (s: number) => `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
export const fmtTime = (iso: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(iso));
export function scoreColor(n: number | string | null | undefined): string {
  if (n == null) return 'text-gray-400';
  const v = Number(n);
  return v >= 7 ? 'text-green-600' : v >= 4 ? 'text-amber-600' : 'text-red-600';
}
export const CONF_STYLE: Record<string, string> = {
  high: 'bg-green-100 text-green-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-red-100 text-red-700',
};

// ---------- score chips ----------
export function Chip({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-lg border border-gray-100 p-2 text-center">
      <div className="text-[10px] uppercase text-gray-400 leading-tight">{label}</div>
      <div className={`text-sm font-bold ${scoreColor(value)}`}>{value == null ? '—' : `${value}/10`}</div>
    </div>
  );
}
export function BoolChip({ label, value }: { label: string; value: boolean | null }) {
  const txt = value == null ? 'n/a' : value ? 'Yes' : 'No';
  const col = value == null ? 'text-gray-400' : value ? 'text-green-600' : 'text-red-600';
  return (
    <div className="rounded-lg border border-gray-100 p-2 text-center">
      <div className="text-[10px] uppercase text-gray-400 leading-tight">{label}</div>
      <div className={`text-sm font-bold ${col}`}>{txt}</div>
    </div>
  );
}

// ============================================================
// Coach's notes — per-call actionable feedback (did well / key fix /
// say-this-instead rewrites / next-call focus). Shared by HR + agent views.
// ============================================================
export function CoachingBlock({ coaching }: { coaching?: Scorecard['coaching'] }) {
  if (!coaching) return null;
  const rewrites = coaching.say_this_instead || [];
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 space-y-3">
      <div className="text-[10px] uppercase tracking-wide text-emerald-700 font-semibold">Coach&apos;s notes</div>

      {coaching.did_well && (
        <div className="text-sm">
          <span className="font-semibold text-emerald-700">✓ Did well: </span>
          <span className="text-gray-700">{coaching.did_well}</span>
        </div>
      )}
      {coaching.key_fix && (
        <div className="text-sm">
          <span className="font-semibold text-amber-700">▲ Biggest fix: </span>
          <span className="text-gray-700">{coaching.key_fix}</span>
        </div>
      )}

      {rewrites.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Say this instead</div>
          {rewrites.map((r, i) => (
            <div key={i} className="rounded-lg bg-white border border-gray-100 p-2.5 space-y-1">
              <p className="text-xs text-gray-500"><span className="text-red-400 font-medium">You said:</span> <span className="italic">“{r.moment}”</span></p>
              <p className="text-sm text-gray-800"><span className="text-emerald-600 font-medium">Try:</span> <span className="font-medium">“{r.rewrite}”</span></p>
              <p className="text-[11px] text-gray-500">{r.why}</p>
            </div>
          ))}
        </div>
      )}

      {coaching.next_call_focus && (
        <div className="text-sm bg-emerald-100/60 rounded-lg px-3 py-2">
          <span className="font-semibold text-emerald-800">🎯 Next call: </span>
          <span className="text-gray-700">{coaching.next_call_focus}</span>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Transparency panel: explains both scorecards + every parameter
// ============================================================
const COLD_PARAMS: Array<[string, string]> = [
  ['Up-Front Contract (Opener)', 'Did the agent state a clear reason for the call and earn permission to keep talking?'],
  ['Rapport / Tone', 'Courtesy, confidence, energy and professionalism — does the agent sound credible and easy to talk to?'],
  ['Objection Handling', 'When the prospect pushed back or brushed off, did the agent acknowledge it before pivoting?'],
  ['Asked for Meeting', 'Did the agent directly ask for a next step or meeting? (Yes / No)'],
  ['Meeting Booked', 'Did the call end with a concrete meeting at a specific time? (Yes / No)'],
];
const DISCOVERY_PARAMS: Array<[string, string]> = [
  ['Up-Front Contract', 'Did the agent set an agenda and get the prospect to agree to it at the start?'],
  ['Pain ID', 'Did the agent uncover a specific, ideally quantified business problem?'],
  ['Cost of Inaction', 'Did the agent explore what it costs the prospect to NOT solve the problem?'],
  ['Budget Qual', 'Did the agent establish budget range or spending authority?'],
  ['Timeline / Urgency', 'Did the agent establish a decision or implementation timeframe?'],
  ['Feature → Value', "Did the agent map their product to the prospect's stated pain — or just feature-dump?"],
  ['Objection Handling', 'When the prospect raised a concern, did the agent acknowledge it before pivoting?'],
  ['Decision-Maker Disc.', 'Did the agent map the buying process / who else decides? (Yes / No)'],
  ['Meeting Booked', 'Did the call end with a concrete next step at a specific date/time? (Yes / No)'],
];

function ParamList({ params }: { params: Array<[string, string]> }) {
  return (
    <ul className="space-y-2.5">
      {params.map(([name, desc]) => (
        <li key={name} className="text-sm">
          <span className="font-semibold text-gray-800">{name}</span>
          <span className="text-gray-500"> — {desc}</span>
        </li>
      ))}
    </ul>
  );
}

export function RubricLegend() {
  const [open, setOpen] = useState(true);
  return (
    <div className="mt-6 bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-gray-50 transition-colors"
      >
        <div>
          <h2 className="text-sm font-bold text-gray-900">How scoring works <span className="font-medium text-gray-400">· for transparency</span></h2>
          <p className="text-xs text-gray-500">What every column and scorecard parameter means.</p>
        </div>
        <span className="text-gray-400 text-lg leading-none">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="px-5 pb-5 pt-1 border-t border-gray-100 space-y-6">
          {/* the funnel: calls vs graded */}
          <div className="text-sm text-gray-600 bg-gray-50 rounded-lg p-4 space-y-1.5">
            <p><span className="font-semibold text-gray-800">Calls</span> = every number dialed (effort). <span className="font-semibold text-gray-800">Graded</span> = the calls that became a real conversation and could be scored.</p>
            <p>Most dials never connect — no-answer, voicemail, gatekeeper, or an instant hang-up under ~50 seconds. Those are marked <span className="font-medium">not-evaluable</span> and left out of the score, so a low “Graded” count is normal for cold outbound and is <span className="font-medium">not</span> counted against the agent.</p>
          </div>

          {/* two rubrics side by side */}
          <div className="grid md:grid-cols-2 gap-5">
            <div className="rounded-xl border border-sky-200 bg-sky-50/40 p-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-sky-100 text-sky-700">Cold call</span>
                <span className="text-xs text-gray-500">under 3 minutes</span>
              </div>
              <p className="text-xs text-gray-500 mb-3">A short call has one job: <span className="font-medium text-gray-700">earn a meeting</span>. We don’t expect deep discovery here.</p>
              <ParamList params={COLD_PARAMS} />
            </div>

            <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-violet-100 text-violet-700">Discovery</span>
                <span className="text-xs text-gray-500">3 minutes or longer</span>
              </div>
              <p className="text-xs text-gray-500 mb-3">A full consultative conversation, held to a higher standard: <span className="font-medium text-gray-700">uncover pain, qualify, build the case</span>.</p>
              <ParamList params={DISCOVERY_PARAMS} />
            </div>
          </div>

          {/* score band legend */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Reading the 0–10 scores</h3>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="px-2 py-1 rounded bg-red-50 text-red-600 font-medium">0–2 · absent / not attempted</span>
              <span className="px-2 py-1 rounded bg-amber-50 text-amber-600 font-medium">3–5 · attempted but weak</span>
              <span className="px-2 py-1 rounded bg-green-50 text-green-600 font-medium">6–7 · solid &amp; competent</span>
              <span className="px-2 py-1 rounded bg-green-100 text-green-700 font-medium">8–10 · strong / expert</span>
              <span className="px-2 py-1 rounded bg-gray-100 text-gray-500 font-medium">“—” · no opportunity arose, so it’s skipped (never counted against the agent)</span>
            </div>
          </div>

          {/* overall explanation, no formula */}
          <div className="text-sm text-gray-600 bg-gray-50 rounded-lg p-4 space-y-1.5">
            <p><span className="font-semibold text-gray-800">Overall</span> combines the areas that actually applied on the call (anything marked “—” is left out, so it neither helps nor hurts).</p>
            <p>Because the goal of a call is to advance the deal, the Overall is <span className="font-medium">boosted when the agent asks for a meeting, and boosted more when one is actually booked</span> — so a call that lands the next step always outranks an equally-polished call that didn’t.</p>
            <p className="text-xs text-gray-400">Each parameter is graded by AI from the transcript; the Overall is then calculated by the system (not the AI) so it stays consistent.</p>
          </div>
        </div>
      )}
    </div>
  );
}
