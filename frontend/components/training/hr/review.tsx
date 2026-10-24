'use client';

import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { Btn, Pill, inputCls, scoreTone, ScoreCardData } from '@/components/training/ui';

export interface QueueRow {
  kind: 'roleplay' | 'call'; id: number; user_id: number | null; full_name: string; title: string; purpose: string | null;
  engine: string | null; final_score: number | null; ai_total: number | null; status: string; human_reviewed: boolean;
  at: string; exam_kind: string | null; last_gap: number | null;
}

export function queuePath(sort: string, status: string) {
  return `/reviews?sort=${sort}&status=${status}`;
}

export interface RubricRow {
  id: number; code: string; name: string;
  criteria_json: { id: string; criterion: string; max_points: number; description: string; examples?: string }[];
  auto_fail_json: { id: string; description: string }[];
  auto_fail_cap: number; pass_score: number; excellent_score: number;
}

export interface GradeSubmit { criteria: { id: string; points: number }[]; auto_fail: string[]; comment: string }

/**
 * The trainer's grading form, built from the rubric (CALL_SCORECARD_100).
 * Prefilled from the AI card when there is one; shows the live total including
 * the auto-fail cap.
 */
export function RubricGradeForm({ rubric, initial, ai, initialComment, onSubmit, onConfirm, busy, submitLabel = 'Save my grade' }: {
  rubric: RubricRow; initial?: ScoreCardData | null; ai?: ScoreCardData | null; initialComment?: string | null;
  onSubmit: (g: GradeSubmit) => void; onConfirm?: (comment: string) => void; busy?: boolean; submitLabel?: string;
}) {
  const seed = useMemo(() => {
    const byId = new Map((initial?.criteria || []).map((c) => [c.id, c.points]));
    return Object.fromEntries(rubric.criteria_json.map((c) => [c.id, byId.has(c.id) ? Number(byId.get(c.id)) : 0]));
  }, [rubric, initial]);
  const [points, setPoints] = useState<Record<string, number>>(seed);
  const [fails, setFails] = useState<string[]>(initial?.auto_fail || []);
  const [comment, setComment] = useState(initialComment || '');
  useEffect(() => { setPoints(seed); setFails(initial?.auto_fail || []); }, [seed, initial]);
  useEffect(() => { setComment(initialComment || ''); }, [initialComment]);

  const raw = rubric.criteria_json.reduce((s, c) => s + (points[c.id] || 0), 0);
  const total = fails.length ? Math.min(raw, rubric.auto_fail_cap) : raw;
  const changed = rubric.criteria_json.some((c) => (points[c.id] || 0) !== seed[c.id]) || fails.join() !== (initial?.auto_fail || []).join();
  const setP = (id: string, max: number, v: string) => {
    const n = Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
    setPoints((p) => ({ ...p, [id]: n }));
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ criteria: rubric.criteria_json.map((c) => ({ id: c.id, points: points[c.id] || 0 })), auto_fail: fails, comment }); }}>
      <div className="sticky top-0 z-10 -mx-5 mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-gray-100 bg-white/95 px-5 py-3 backdrop-blur">
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-400">Your total</div>
          <div className={cn('text-3xl font-extrabold tabular-nums', scoreTone(total))} aria-live="polite">{total}<span className="text-base text-gray-400 font-semibold">/100</span></div>
          {fails.length > 0 && raw > rubric.auto_fail_cap && <div className="text-xs text-red-600">{raw} points, capped at {rubric.auto_fail_cap} by an automatic fail</div>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {total >= rubric.excellent_score ? <Pill tone="green">Excellent (≥{rubric.excellent_score})</Pill> : total >= rubric.pass_score ? <Pill tone="blue">Pass (≥{rubric.pass_score})</Pill> : <Pill tone="amber">Below {rubric.pass_score}</Pill>}
          {ai && <Pill tone="gray">{ai.engine === 'script' ? 'Script' : 'AI'} said {ai.total}</Pill>}
        </div>
      </div>

      <div className="space-y-4">
        {rubric.criteria_json.map((c, i) => {
          const v = points[c.id] || 0;
          const aiV = ai?.criteria.find((x) => x.id === c.id)?.points;
          return (
            <div key={c.id} className="rounded-xl border border-gray-200 p-3">
              <div className="flex items-start justify-between gap-3">
                <label htmlFor={`crit-${c.id}`} className="min-w-0">
                  <span className="text-sm font-semibold text-gray-800">{i + 1}. {c.criterion}</span>
                  <span className="block text-xs text-gray-500">{c.description}</span>
                  {c.examples && <span className="block text-xs italic text-gray-400 mt-0.5">e.g. {c.examples}</span>}
                </label>
                <div className="flex items-center gap-1 shrink-0">
                  <input id={`crit-${c.id}`} type="number" inputMode="numeric" min={0} max={c.max_points} value={v}
                    onChange={(e) => setP(c.id, c.max_points, e.target.value)}
                    className={cn(inputCls, 'w-16 text-right tabular-nums px-2')} aria-describedby={`max-${c.id}`} />
                  <span id={`max-${c.id}`} className="text-sm text-gray-400 tabular-nums">/{c.max_points}</span>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <input type="range" min={0} max={c.max_points} value={v} onChange={(e) => setP(c.id, c.max_points, e.target.value)} className="flex-1 accent-primary-600" aria-label={`${c.criterion} points`} />
                {aiV !== undefined && aiV !== v && <span className="text-xs text-gray-400 whitespace-nowrap">{ai?.engine === 'script' ? 'Script' : 'AI'}: {aiV}</span>}
              </div>
            </div>
          );
        })}
      </div>

      <fieldset className="mt-5 rounded-xl border border-red-200 bg-red-50/50 p-3">
        <legend className="px-1 text-sm font-semibold text-red-800">Automatic fails (cap the score at {rubric.auto_fail_cap})</legend>
        <div className="space-y-2">
          {rubric.auto_fail_json.map((f) => (
            <label key={f.id} className="flex items-start gap-2 text-sm text-gray-700">
              <input type="checkbox" className="mt-0.5 rounded border-gray-300 text-red-600 focus:ring-red-500" checked={fails.includes(f.id)}
                onChange={(e) => setFails((s) => e.target.checked ? [...s, f.id] : s.filter((x) => x !== f.id))} />
              {f.description}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="mt-5 block">
        <span className="text-sm font-medium text-gray-700">Comment for the rep</span>
        <textarea rows={3} className={cn(inputCls, 'mt-1')} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="What to keep doing, and the one thing to change next time." />
      </label>

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {onConfirm && ai && (
          <Btn variant="secondary" disabled={busy || changed} onClick={() => onConfirm(comment)}>
            Confirm {ai?.engine === 'script' ? 'scripted' : 'AI'} score ({ai?.total})
          </Btn>
        )}
        <Btn type="submit" disabled={busy}>{busy ? 'Saving…' : submitLabel}</Btn>
      </div>
      {onConfirm && ai && changed && <p className="mt-1 text-right text-xs text-gray-400">You changed points, so this will save as your grade.</p>}
    </form>
  );
}
