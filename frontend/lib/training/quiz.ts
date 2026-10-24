/**
 * Quiz / exam serving and grading. Questions are shuffled from the bank, MCQ
 * options are permuted per attempt, and answers never leave the server until
 * the attempt is submitted.
 */
import { query } from '@/lib/db';
import { chatJSON, AiUnavailableError } from './ai';

export interface QuestionRow {
  id: number;
  lesson_id: number | null;
  type: 'mcq' | 'multi' | 'true_false' | 'short_answer' | 'order';
  prompt: string;
  options_json: string[];
  answer_json: any;
  explanation: string | null;
  tags: string[];
}

/** What we store per served question: id + display→original option permutation. */
export interface ServedQuestion { id: number; perm: number[] }

export interface PublicQuestion {
  id: number;
  type: QuestionRow['type'];
  prompt: string;
  options: string[];
}

export function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function permutationFor(q: QuestionRow): number[] {
  const n = (q.options_json || []).length;
  const identity = Array.from({ length: n }, (_, i) => i);
  // True/False keeps its order; "order" questions are stored pre-shuffled.
  if (q.type === 'mcq' || q.type === 'multi') return shuffle(identity);
  return identity;
}

/** Pick questions for a lesson attempt. */
export async function drawQuestions(lesson: { id: number; type: string; config: any }): Promise<ServedQuestion[]> {
  let rows: QuestionRow[] = [];
  const config = lesson.config || {};

  if (lesson.type === 'exam') {
    const drawTags: Record<string, number> = config.draw_tags || { product: 15, classification: 8, sales: 10 };
    const used = new Set<number>();
    for (const [tag, count] of Object.entries(drawTags)) {
      const pool = await query<QuestionRow>(
        `SELECT * FROM training_quiz_questions WHERE active AND $1 = ANY(tags)`,
        [tag]
      );
      for (const q of shuffle(pool).filter((q) => !used.has(q.id)).slice(0, Number(count))) {
        used.add(q.id);
        rows.push(q);
      }
    }
  } else {
    rows = await query<QuestionRow>(
      `SELECT * FROM training_quiz_questions WHERE active AND lesson_id = $1`,
      [lesson.id]
    );
    rows = shuffle(rows);
    if (config.draw) rows = rows.slice(0, Number(config.draw));
  }

  return shuffle(rows).map((q) => ({ id: q.id, perm: permutationFor(q) }));
}

export async function loadQuestions(ids: number[]): Promise<Map<number, QuestionRow>> {
  if (ids.length === 0) return new Map();
  const rows = await query<QuestionRow>(`SELECT * FROM training_quiz_questions WHERE id = ANY($1::int[])`, [ids]);
  return new Map(rows.map((r) => [r.id, r]));
}

export function toPublic(q: QuestionRow, perm: number[]): PublicQuestion {
  const options = q.options_json || [];
  return { id: q.id, type: q.type, prompt: q.prompt, options: perm.map((i) => options[i]) };
}

export interface GradedQuestion {
  id: number;
  correct: boolean;
  explanation: string | null;
  correct_answer: string;
  feedback?: string;
}

function describeCorrect(q: QuestionRow): string {
  const o = q.options_json || [];
  const a = q.answer_json || {};
  switch (q.type) {
    case 'mcq':
    case 'true_false':
      return o[a.correct] ?? '';
    case 'multi':
      return (a.correct || []).map((i: number) => o[i]).join(' + ');
    case 'order':
      return (a.order || []).map((i: number) => o[i]).join(' → ');
    case 'short_answer':
      return a.model_answer || (a.keywords || []).join(', ');
  }
}

/**
 * Grade one answer. `answer` uses DISPLAY indices (what the rep saw); the
 * permutation maps them back to stored option indices.
 */
export async function gradeOne(q: QuestionRow, perm: number[], answer: any, userId: number): Promise<GradedQuestion> {
  const a = q.answer_json || {};
  const toOriginal = (displayIdx: number) => perm[displayIdx];
  let correct = false;
  let feedback: string | undefined;

  if (q.type === 'mcq' || q.type === 'true_false') {
    correct = answer !== null && answer !== undefined && toOriginal(Number(answer)) === Number(a.correct);
  } else if (q.type === 'multi') {
    const picked = new Set<number>((Array.isArray(answer) ? answer : []).map((i: any) => toOriginal(Number(i))));
    const want = new Set<number>((a.correct || []).map(Number));
    correct = picked.size === want.size && Array.from(want).every((i) => picked.has(i));
  } else if (q.type === 'order') {
    const picked = (Array.isArray(answer) ? answer : []).map((i: any) => toOriginal(Number(i)));
    const want = (a.order || []).map(Number);
    correct = picked.length === want.length && picked.every((v: number, i: number) => v === want[i]);
  } else if (q.type === 'short_answer') {
    const text = String(answer || '').toLowerCase();
    const keywords: string[] = a.keywords || [];
    const hits = keywords.filter((k) => text.includes(String(k).toLowerCase())).length;
    correct = text.trim().length > 0 && hits >= Number(a.min_matches || 1);
    if (!correct && text.trim().length > 3 && a.model_answer) {
      // Keyword miss: let the AI judge paraphrases when available.
      try {
        const r = await chatJSON<{ correct: boolean; feedback: string }>({
          feature: 'quiz_grade', userId, promptKey: 'short_answer_grade',
          vars: { question: q.prompt, model_answer: a.model_answer, answer: String(answer) },
          maxTokens: 200,
        });
        correct = !!r.data.correct;
        feedback = r.data.feedback;
      } catch (err) {
        if (!(err instanceof AiUnavailableError)) console.error('[training] short answer grade', err);
      }
    }
  }

  return { id: q.id, correct, explanation: q.explanation, correct_answer: describeCorrect(q), feedback };
}
