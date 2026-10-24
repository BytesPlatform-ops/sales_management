import { NextRequest } from 'next/server';
import { handler, ok, readJson, requireHr, HttpError } from '@/lib/training/http';
import { generateFlashcards, generateQuiz } from '@/lib/training/generate';
import { AiUnavailableError } from '@/lib/training/ai';

export const dynamic = 'force-dynamic';
export const maxDuration = 90;

/**
 * POST /api/training/generate (trainer) { lesson_id, kind: 'flashcards'|'quiz', count? }
 * Returns a preview; the editor saves what the trainer keeps.
 */
export const POST = handler(async (request: NextRequest) => {
  const auth = await requireHr(request);
  const b = await readJson(request);
  if (!b.lesson_id) throw new HttpError(400, 'lesson_id is required');
  try {
    if (b.kind === 'quiz') return ok({ questions: await generateQuiz(auth.userId, Number(b.lesson_id), Number(b.count || 8)) });
    return ok({ cards: await generateFlashcards(auth.userId, Number(b.lesson_id), Number(b.count || 10)) });
  } catch (err) {
    if (err instanceof AiUnavailableError) throw new HttpError(503, err.message);
    throw err;
  }
});
