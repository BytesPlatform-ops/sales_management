import { NextRequest } from 'next/server';
import { getAuth, handler, ok, HttpError } from '@/lib/training/http';
import { assertLessonUnlocked, evaluateProgress, markLessonComplete } from '@/lib/training/progress';
import { getLesson } from '@/lib/training/attempts';
import { evaluateBadges } from '@/lib/training/badges';

export const dynamic = 'force-dynamic';

const SELF_COMPLETE = ['reading', 'video', 'checklist', 'flashcard_deck', 'scenario'];

/** POST /api/training/lessons/{id}/complete — "mark complete" for reading/video/checklist/deck lessons. */
export const POST = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const auth = await getAuth(request);
  const id = Number(params.id);
  const lesson = await getLesson(id);
  if (!SELF_COMPLETE.includes(lesson.type)) throw new HttpError(400, 'This lesson completes when you pass it');
  const view = await assertLessonUnlocked(auth.userId, id);
  if (!view?.unlocked) throw new HttpError(403, view?.lock_hint || 'This lesson is locked');
  await markLessonComplete(auth.userId, id);
  const certs = await evaluateProgress(auth.userId);
  const badges = await evaluateBadges(auth.userId);
  return ok({ completed: true, new_certifications: certs, new_badges: badges });
});
