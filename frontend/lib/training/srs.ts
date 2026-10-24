/**
 * SM-2 style spaced repetition (E.6). No AI needed.
 * "good" walks the ladder 1 → 3 → 7 → 14 → 30 days, then grows by ease.
 */
export type ReviewResult = 'again' | 'hard' | 'good' | 'easy';

export interface CardState {
  ease: number;
  interval_days: number;
  repetitions: number;
}

const LADDER = [1, 3, 7, 14, 30];
const MIN_EASE = 1.3;

export function nextReview(state: CardState, result: ReviewResult, now = new Date()): CardState & { due_at: Date } {
  let { ease, interval_days: interval, repetitions: reps } = state;
  ease = Number(ease) || 2.5;

  switch (result) {
    case 'again':
      reps = 0;
      interval = 0;
      ease = Math.max(MIN_EASE, ease - 0.2);
      break;
    case 'hard':
      interval = Math.max(1, Math.round((interval || 1) * 1.2));
      ease = Math.max(MIN_EASE, ease - 0.15);
      break;
    case 'good':
      interval = reps < LADDER.length ? LADDER[reps] : Math.round(interval * ease);
      reps += 1;
      break;
    case 'easy': {
      const step = Math.min(reps + 1, LADDER.length - 1);
      interval = reps < LADDER.length - 1 ? LADDER[step] : Math.round(interval * ease * 1.3);
      reps += 2;
      ease = ease + 0.15;
      break;
    }
  }

  // "again" comes back in 10 minutes, everything else in whole days.
  const due = new Date(now.getTime() + (interval === 0 ? 10 * 60_000 : interval * 86_400_000));
  return { ease: Math.round(ease * 100) / 100, interval_days: interval, repetitions: reps, due_at: due };
}
