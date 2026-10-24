/**
 * The 100-point scorecard (D.19), shared by AI grading, scripted-roleplay
 * grading and the trainer's manual grading/overrides.
 */
import { queryOne } from '@/lib/db';

export interface Criterion { id: string; criterion: string; max_points: number; description: string; examples?: string }
export interface Rubric {
  id: number; code: string; name: string;
  criteria_json: Criterion[];
  auto_fail_json: { id: string; description: string }[];
  auto_fail_cap: number; pass_score: number; excellent_score: number;
}

export interface ScoredCriterion { id: string; criterion: string; max_points: number; points: number; evidence_quote: string; tip: string }
export interface ScoreCard {
  rubric: string;
  criteria: ScoredCriterion[];
  auto_fail: string[];
  raw_total: number;
  total: number;
  passed: boolean;
  excellent: boolean;
  top_3_tips: string[];
  summary?: string;
  outcome?: string;
  engine: 'ai' | 'script' | 'trainer';
}

export const DEFAULT_RUBRIC_CODE = 'CALL_SCORECARD_100';

export async function loadRubric(idOrCode: number | string = DEFAULT_RUBRIC_CODE): Promise<Rubric> {
  const row = await queryOne<Rubric>(
    typeof idOrCode === 'number' ? `SELECT * FROM training_rubrics WHERE id = $1` : `SELECT * FROM training_rubrics WHERE code = $1`,
    [idOrCode]
  );
  if (!row) throw new Error(`Rubric ${idOrCode} not found`);
  return row;
}

/** Normalise raw per-criterion points into a scorecard (caps, auto-fail cap, pass flags). */
export function buildScoreCard(
  rubric: Rubric,
  input: { criteria: { id: string; points: number; evidence_quote?: string; tip?: string }[]; auto_fail?: string[]; top_3_tips?: string[]; summary?: string; outcome?: string },
  engine: ScoreCard['engine']
): ScoreCard {
  const byId = new Map(input.criteria.map((c) => [c.id, c]));
  const validFails = new Set(rubric.auto_fail_json.map((f) => f.id));
  const criteria: ScoredCriterion[] = rubric.criteria_json.map((c) => {
    const got = byId.get(c.id);
    const points = Math.max(0, Math.min(c.max_points, Math.round(Number(got?.points) || 0)));
    return { id: c.id, criterion: c.criterion, max_points: c.max_points, points, evidence_quote: got?.evidence_quote || '', tip: got?.tip || '' };
  });
  const auto_fail = (input.auto_fail || []).filter((f) => validFails.has(f));
  const raw_total = criteria.reduce((s, c) => s + c.points, 0);
  const total = auto_fail.length ? Math.min(raw_total, rubric.auto_fail_cap) : raw_total;

  // Tips: model's top 3, else the tips for the criteria that lost the most points.
  let tips = (input.top_3_tips || []).filter(Boolean).slice(0, 3);
  if (tips.length < 3) {
    const extra = [...criteria]
      .sort((a, b) => (b.max_points - b.points) - (a.max_points - a.points))
      .map((c) => c.tip || `${c.criterion}: ${rubric.criteria_json.find((r) => r.id === c.id)?.description}`)
      .filter((t) => !tips.includes(t));
    tips = [...tips, ...extra].slice(0, 3);
  }

  return {
    rubric: rubric.code, criteria, auto_fail, raw_total, total,
    passed: total >= rubric.pass_score, excellent: total >= rubric.excellent_score,
    top_3_tips: tips, summary: input.summary, outcome: input.outcome, engine,
  };
}

/**
 * E.5 review-queue rule: a human looks at it when the score is <60 or >90,
 * or when this rep's last AI-vs-human gap was >15.
 */
export function needsHumanReview(total: number, lastGap: number | null): boolean {
  return total < 60 || total > 90 || (lastGap !== null && lastGap > 15);
}
